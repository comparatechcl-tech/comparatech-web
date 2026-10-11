import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { resolveOutboundUrl } from '@/lib/outbound';
import { readAffiliateSettings, type AffiliateSettings } from '@/lib/settings';
import { shortProductName } from '@/lib/text';
import { readConfirmedDrops } from '@/lib/social/drops';
import { NETWORK_RULES, postedOnNetworks } from '@/lib/social/networks';
import { piecePath, snapshotOf } from '@/lib/social/piece-url';
import {
  pickByRules,
  readFreshSocialProducts,
  type PickRules,
  type SocialProduct,
  type TelegramPick,
} from '@/lib/social/telegram';

/**
 * Historias de Instagram que se suben a mano desde el teléfono.
 *
 * El único link que se puede tocar en una historia es el sticker "Enlace",
 * y ningún programador de publicaciones lo puede poner: hay que subir la
 * historia desde la app. Lo que sí se puede dejar listo es todo lo demás:
 * qué ofertas mostrar, la imagen con el precio del momento y el link de
 * afiliado para pegar en el sticker (ver /admin/historias).
 */

export const STORY_RULES: PickRules & { repeatAfterDays: number } = {
  ...NETWORK_RULES,
  /** Se suben a mano y no gastan la cuota de Metricool: caben más que en el plan de publicaciones. */
  maxPosts: 8,
};

export interface StoryItem {
  id: string;
  slug: string;
  name: string;
  brand: string | null;
  price: number;
  /** Precio de lista, solo si es mayor que el precio. */
  listPrice: number | null;
  discount: number;
  /** Baja confirmada por el historial (en %), para lo que no llega al descuento. */
  drop: number | null;
  checkedAt: string | null;
  /** Ruta firmada de la pieza 9:16, sin dominio: sirve en producción y en local. */
  image: string;
  /** El mismo destino que el botón de compra del sitio. */
  link: string;
  fileName: string;
}

/** Lo que hace falta para subir la historia de un producto. null si no se pudo firmar la imagen. Puro. */
export function buildStoryItem(
  pick: TelegramPick<SocialProduct>,
  opts: { now: Date; settings: AffiliateSettings; key: Buffer }
): StoryItem | null {
  const p = pick.product;
  const image = piecePath(snapshotOf(p, 'story', opts.now), opts.key);
  if (!image) return null;

  const safeSlug = p.slug.toLowerCase().replace(/[^a-z0-9-]+/g, '').slice(0, 80) || 'producto';
  return {
    id: p.id,
    slug: p.slug,
    name: shortProductName(p.name),
    brand: p.brand,
    price: p.price,
    listPrice: pick.discount > 0 ? p.original_price : null,
    discount: pick.discount,
    drop: pick.drop === null ? null : Math.round(pick.drop),
    checkedAt: p.price_checked_at,
    image,
    link: resolveOutboundUrl(p, opts.settings),
    fileName: `comparatech-${safeSlug}-historia.jpg`,
  };
}

/**
 * Las ofertas de este momento para subir como historia: las mismas reglas
 * del plan de publicaciones (descuento sobre el precio de lista o baja
 * confirmada, precio recién revisado, nada repetido en 14 días), pero más
 * productos. Solo lee.
 */
export async function readStoryPicks(admin: SupabaseClient, now: Date, key: Buffer): Promise<StoryItem[]> {
  const freshSince = new Date(now.getTime() - STORY_RULES.maxPriceAgeMs).toISOString();
  const read = await readFreshSocialProducts(admin, freshSince);
  if (read.error) throw new Error(`No se pudo leer el catálogo: ${read.error}`);

  const since = new Date(now.getTime() - STORY_RULES.repeatAfterDays * 86_400_000);
  const [posted, drops, settings] = await Promise.all([
    postedOnNetworks(admin, since),
    readConfirmedDrops(read.rows, now, STORY_RULES.minDiscount),
    readAffiliateSettings(admin),
  ]);

  return pickByRules(read.rows, { now, recentlyPosted: posted ?? new Set(), drops }, STORY_RULES)
    .map((pick) => buildStoryItem(pick, { now, settings, key }))
    .filter((item): item is StoryItem => item !== null);
}
