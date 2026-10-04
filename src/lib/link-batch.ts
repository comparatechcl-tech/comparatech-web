import { inspectAffiliateLink, type AffiliateLinkInfo } from '@/lib/affiliate-link';
import { mapWithConcurrency } from '@/lib/ml-catalog';

export { MAX_BATCH } from '@/lib/batch-result';

/**
 * Carga de links de afiliado en bloque.
 *
 * Mercado Libre no tiene una API para generar links de afiliado: solo el
 * generador de la Central de Afiliados, que sí acepta varias URLs a la vez.
 * El admin le entrega esas URLs listas para pegar, y acá se recibe de vuelta
 * lo que devolvió el generador —copiado como venga— y se asigna cada link a
 * su producto.
 *
 * Cada link se abre para ver qué ficha destaca el perfil de afiliado, así
 * que el orden en que se peguen no importa. Si la ficha no se puede leer, se
 * asigna por posición, porque el generador devuelve los links en el mismo
 * orden de las URLs; eso solo se hace cuando la cantidad calza exacto.
 */

const LINK_RE = /https?:\/\/(?:meli\.la|(?:www\.)?mercadolibre\.com\/sec)\/[A-Za-z0-9]+/g;

/** Links de afiliado dentro de un texto pegado, sin repetir y en orden. */
export function extractAffiliateLinks(text: string): string[] {
  return Array.from(new Set(text.match(LINK_RE) ?? []));
}

export interface BatchTarget {
  id: string;
  mlProductId: string;
}

export interface BatchAssignment {
  targetId: string;
  url: string;
  info: AffiliateLinkInfo | null;
  /** true: el perfil destaca la ficha correcta. false: asignado por posición. */
  verified: boolean;
}

export interface BatchMatch {
  assigned: BatchAssignment[];
  /** Links que destacan una ficha que no está en la tanda. */
  wrong: { url: string; featuredProductId: string }[];
  /** Links que no se pudieron asignar (repetidos, o sin ficha y sin orden que calce). */
  unmatched: string[];
  linksFound: number;
}

export async function matchLinksToTargets(text: string, targets: BatchTarget[]): Promise<BatchMatch> {
  const links = extractAffiliateLinks(text);
  const inspected = await mapWithConcurrency(links, 5, async (url) => {
    const res = await inspectAffiliateLink(url);
    return res.ok ? res.info : null;
  });

  const byProduct = new Map(targets.map((t) => [t.mlProductId, t]));
  const taken = new Set<string>();
  const assigned: BatchAssignment[] = [];
  const wrong: BatchMatch['wrong'] = [];
  const unmatched: string[] = [];
  const unreadable: number[] = [];

  links.forEach((url, i) => {
    const info = inspected[i];
    const featured = info?.featuredProductId;
    if (!featured) {
      unreadable.push(i);
      return;
    }
    const target = byProduct.get(featured);
    if (!target) wrong.push({ url, featuredProductId: featured });
    else if (taken.has(target.id)) unmatched.push(url);
    else {
      taken.add(target.id);
      assigned.push({ targetId: target.id, url, info, verified: true });
    }
  });

  // Por posición, solo si hay exactamente un link por producto: con uno de
  // más o de menos, el orden ya no dice nada.
  const byPosition = links.length === targets.length;
  for (const i of unreadable) {
    const target = targets[i];
    if (byPosition && !taken.has(target.id)) {
      taken.add(target.id);
      assigned.push({ targetId: target.id, url: links[i], info: inspected[i], verified: false });
    } else {
      unmatched.push(links[i]);
    }
  }

  return { assigned, wrong, unmatched, linksFound: links.length };
}
