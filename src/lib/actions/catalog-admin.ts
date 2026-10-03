'use server';

/**
 * Acciones del admin sobre el catálogo publicado.
 *
 * Existen porque el correo diario avisaba de productos con problemas, pero
 * desde el admin no había cómo resolverlos: guardar un link nuevo no
 * republicaba nada, había que esperar hasta 24 horas a que el cron lo
 * notara. Ahora cada acción consulta Mercado Libre en el momento y deja el
 * producto publicado —o explica por qué no— antes de responder.
 */

import { revalidatePath } from 'next/cache';
import { getSupabaseAdmin } from '@/lib/supabase/server';
import { getMlToken } from '@/lib/ml-enrichment';
import { inspectAffiliateLink } from '@/lib/affiliate-link';
import { linkVerdict, resolveLinkTarget, type LinkVerdict } from '@/lib/link-check';
import {
  PRICED_COLUMNS,
  applyPricing,
  priceProducts,
  summarizePricing,
  type PricedProduct,
  type PricingResult,
} from '@/lib/pricing';
import { rememberAffiliateParams, writeAffiliateSettings } from '@/lib/settings';

type Fail = { ok: false; error: string };

function refreshSite() {
  // Precios y disponibilidad se ven en casi todas las páginas públicas.
  revalidatePath('/', 'layout');
}

export type LinkCheck = { ok: true; verdict: LinkVerdict; featuredProductId: string | null } | Fail;

/** Botón "Verificar": dice si el link lleva a esta ficha, sin guardar nada. */
export async function checkAffiliateLink(url: string, mlProductId: string | null): Promise<LinkCheck> {
  if (!url.trim()) return { ok: false, error: 'Falta el link' };
  if (!mlProductId) return { ok: false, error: 'Este producto no tiene ficha de Mercado Libre asociada' };

  const inspected = await inspectAffiliateLink(url);
  if (!inspected.ok) return { ok: false, error: inspected.error };

  return {
    ok: true,
    verdict: await linkVerdict(inspected.info, mlProductId, await getMlToken()),
    featuredProductId: inspected.info.featuredProductId,
  };
}

export type RecheckResult =
  | {
      ok: true;
      summary: ReturnType<typeof summarizePricing>;
      results: { id: string; result: PricingResult }[];
    }
  | Fail;

/**
 * Vuelve a consultar ML ahora mismo. Sin ids, revisa todos los productos
 * fuera del sitio (botón "Revisar todos ahora" de la vista de problemas).
 */
export async function recheckProducts(ids?: string[]): Promise<RecheckResult> {
  const admin = getSupabaseAdmin();
  if (!admin) return { ok: false, error: 'Supabase admin no configurado' };

  let query = admin
    .from('products')
    .select(PRICED_COLUMNS)
    .not('ml_product_id', 'is', null)
    .eq('is_hidden', false);
  query = ids && ids.length > 0 ? query.in('id', ids) : query.eq('is_active', false);

  const { data, error } = await query;
  if (error) return { ok: false, error: error.message };

  const products = (data ?? []) as unknown as PricedProduct[];
  if (products.length === 0) {
    return { ok: true, summary: summarizePricing([]), results: [] };
  }

  const token = await getMlToken();
  if (!token) return { ok: false, error: 'No se pudo conectar con Mercado Libre. Intenta de nuevo en un rato.' };

  const outcomes = await priceProducts(products, token, {
    verifyLink: (p) => resolveLinkTarget(p.affiliate_url, p.ml_product_id, token),
  });
  await applyPricing(admin, outcomes);
  refreshSite();

  return {
    ok: true,
    summary: summarizePricing(outcomes),
    results: outcomes.map((o) => ({ id: o.id, result: o.result })),
  };
}

export type RepublishResult =
  | {
      ok: true;
      result: PricingResult | 'pendiente';
      /** False si no se pudo comprobar a qué ficha lleva el link (ver LinkVerdict). */
      verified: boolean;
    }
  | Fail;

/**
 * Guarda un link nuevo y deja el producto publicado en el mismo paso.
 *
 * Antes de guardar se comprueba que el link lleve a esta ficha: un link a
 * otro producto no se acepta, porque el comprador terminaría viendo algo
 * distinto a lo publicado.
 */
export async function republishWithLink(productId: string, url: string): Promise<RepublishResult> {
  const trimmed = url.trim();
  if (!trimmed) return { ok: false, error: 'Falta el link de afiliado' };

  const admin = getSupabaseAdmin();
  if (!admin) return { ok: false, error: 'Supabase admin no configurado' };

  const { data, error } = await admin
    .from('products')
    .select(PRICED_COLUMNS)
    .eq('id', productId)
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: 'Ese producto ya no existe' };
  const product = data as unknown as PricedProduct;

  const inspected = await inspectAffiliateLink(trimmed);
  if (!inspected.ok) return { ok: false, error: `No se pudo abrir el link: ${inspected.error}` };

  const token = await getMlToken();
  const { featuredProductId, itemId, mattWord, mattTool } = inspected.info;
  const verdict = await linkVerdict(inspected.info, product.ml_product_id, token);

  // Solo se rechaza con evidencia: si el perfil no muestra el producto (o ML
  // le respondió otra página al servidor), el link se guarda igual. Quien lo
  // pegó lo generó desde la ficha, y bloquearlo dejaría el producto sin
  // forma de volver al sitio.
  if (verdict === 'otra_ficha') {
    return {
      ok: false,
      error: `Este link lleva a otra ficha (${featuredProductId}), no a la de este producto. Genéralo desde la ficha correcta en Mercado Libre.`,
    };
  }
  const verified = verdict === 'coincide';

  const linkFields = {
    affiliate_url: trimmed,
    ml_item_id: itemId,
    // Sin verificar queda en null, igual que un link que nunca se revisó:
    // así no hereda el "lleva a otra ficha" del link anterior.
    link_target_product_id: verified ? product.ml_product_id : null,
    link_checked_at: verified ? new Date().toISOString() : null,
  };
  const { error: saveError } = await admin.from('products').update(linkFields).eq('id', productId);
  if (saveError) return { ok: false, error: saveError.message };

  await rememberAffiliateParams(admin, mattWord, mattTool);

  if (!token) {
    refreshSite();
    return { ok: true, result: 'pendiente', verified };
  }

  const [outcome] = await priceProducts([{ ...product, ...linkFields }], token);
  await applyPricing(admin, [outcome]);
  refreshSite();
  return { ok: true, result: outcome.result, verified };
}

/** Configuración de afiliado editada desde /admin/configuracion. */
export async function saveAffiliateConfig(input: {
  word: string;
  tool: string;
  directLinks: boolean;
}): Promise<{ ok: true } | Fail> {
  const word = input.word.trim();
  const tool = input.tool.trim();

  if (input.directLinks && (!word || !tool)) {
    return { ok: false, error: 'Para usar links directos hacen falta matt_word y matt_tool.' };
  }
  if (word && !/^[A-Za-z0-9_.-]{2,64}$/.test(word)) {
    return { ok: false, error: 'matt_word solo puede tener letras, números, punto, guion y guion bajo.' };
  }
  if (tool && !/^\d{3,20}$/.test(tool)) {
    return { ok: false, error: 'matt_tool debe ser un número.' };
  }

  const admin = getSupabaseAdmin();
  if (!admin) return { ok: false, error: 'Supabase admin no configurado' };

  const saved = await writeAffiliateSettings(admin, {
    word: word || null,
    tool: tool || null,
    directLinks: input.directLinks,
  });
  if (!saved.ok) return saved;

  refreshSite();
  return { ok: true };
}
