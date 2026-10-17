import { chileDateTime, formatPrice } from '@/lib/content/captions';
import { REEL_PASSES_UTC, chileTime, nextReelPass } from '@/lib/social/content-timing';
import type { VideoNetwork } from '@/lib/social/videos';

/**
 * Lo que /admin/videos dice con palabras y que necesitan a la vez la página
 * (de servidor) y la lista (de cliente). Va aparte porque la página no puede
 * tomar valores de un módulo 'use client', y lib/social/videos es solo de
 * servidor. Puro y sin nada del navegador.
 */

/**
 * Las redes, en el orden en que se muestran. Un Record y no una lista: si el
 * contrato suma una red, esto deja de compilar en vez de quedar sin botón.
 */
export const NETWORK_LABELS: Record<VideoNetwork, string> = {
  instagram: 'Instagram',
  tiktok: 'TikTok',
  youtube: 'YouTube',
  facebook: 'Facebook',
};
export const NETWORK_KEYS = Object.keys(NETWORK_LABELS) as VideoNetwork[];

/** "Instagram", "Instagram y TikTok", "Instagram, TikTok y YouTube", en el orden de la tarjeta. Puro. */
export function networkList(networks: readonly VideoNetwork[]): string {
  const names = NETWORK_KEYS.filter((network) => networks.indexOf(network) >= 0).map((network) => NETWORK_LABELS[network]);
  if (names.length === 0) return 'una red';
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(', ')} y ${names[names.length - 1]}`;
}

/** Un video ya marcado cuyo precio ya no es el que se marcó (VideoBoard.changedAfterPosting). */
export interface ChangedAfterPosting {
  /** null: el producto ya no está en la base. */
  name: string | null;
  networks: VideoNetwork[];
  postedPrice: number;
  /** null: el producto ya no está a la venta. */
  price: number | null;
}

/** El aviso rojo de un video subido cuyo precio cambió después. Puro. */
export function changedAfterPostingText(item: ChangedAfterPosting): string {
  const what = item.name ?? 'un producto que ya no está en el sitio';
  const where = `Subiste ${what} en ${networkList(item.networks)} a ${formatPrice(item.postedPrice)}`;
  return item.price === null
    ? `${where} y ya no está a la venta: bórralo o archívalo en esa red.`
    : `${where} y ahora está más caro, a ${formatPrice(item.price)}: bórralo o archívalo en esa red.`;
}

/**
 * La línea de arriba: cuándo llegan videos nuevos y qué hace falta para que
 * entren productos nuevos. La hora sale del horario de GitHub (en UTC) pasado
 * a hora de Chile, así que el cambio de hora se ajusta solo. Puro.
 */
export function nextPassText(now: Date): string {
  const next = nextReelPass(now);
  const time = chileTime(next);
  const today = chileDateTime(now)?.date;
  const day = chileDateTime(next)?.date;
  const when = time ? `programada a las ${time}${day && today && day !== today ? ' de mañana' : ''}` : 'en unas horas';
  return (
    `Los videos se arman solos ${REEL_PASSES_UTC.length} veces al día, unas cada 3 horas de día. ` +
    `Próxima pasada: ${when}, aunque GitHub suele atrasarla entre 1 y 4 horas. ` +
    'Para que entren productos nuevos, marca en qué redes subiste los de hoy: lo marcado deja su lugar al siguiente.'
  );
}

/**
 * Los videos que dejaron de mostrarse porque el producto cambió. Sin prometer
 * que se rehacen: uno ya marcado en alguna red no vuelve a armarse en
 * `repeatAfterDays` días, y uno que salió del sitio no vuelve. Puro.
 */
export function staleText(stale: number, repeatAfterDays: number): string {
  const count = stale === 1 ? '1 video ya no se muestra' : `${stale} videos ya no se muestran`;
  return (
    `${count} porque el producto cambió (de precio, de oferta o salió del sitio). ` +
    'Si no lo habías marcado en ninguna red y sigue entre los sugeridos, se arma uno nuevo en una próxima pasada; ' +
    `si ya lo marcaste en alguna, no se vuelve a armar en ${repeatAfterDays} días.`
  );
}
