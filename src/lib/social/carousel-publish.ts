import {
  CAROUSEL_MAX_ITEMS,
  checkCarouselPath,
  type CarouselItem,
  type CarouselSet,
} from './carousel-url';

/**
 * Qué carrusel se publica en Instagram y Facebook desde el admin
 * (app/admin/historias/carrusel/meta-actions). Puro, sin base ni red.
 *
 * El navegador manda las direcciones de las láminas que el dueño está viendo.
 * Cada una va firmada por el sitio (lib/social/carousel-url), así que el
 * servidor sabe con certeza qué productos, precios y bajas lleva cada
 * imagen, sin volver a armar el carrusel. Volver a armarlo no serviría: una
 * vez marcado como publicado ya no se arma, y Facebook puede ir después que
 * Instagram.
 */

export const META_NETWORKS = ['instagram', 'facebook'] as const;
export type MetaNetwork = (typeof META_NETWORKS)[number];

export interface VerifiedCarousel {
  set: CarouselSet;
  /** En orden de lámina (rank 1, 2, …). */
  items: CarouselItem[];
  /** Las direcciones tal como llegaron, en orden: portada, productos y cierre. */
  paths: string[];
}

const PATH_RE = /^\/social\/carrusel\/([^/?#]+)\/([^/?#]+)$/;

function sameSet(a: CarouselSet, b: CarouselSet): boolean {
  return a.kind === b.kind && a.day === b.day && a.expiresAt === b.expiresAt && a.ids.join('.') === b.ids.join('.');
}

export function verifyCarouselSlides(
  raw: unknown,
  key: Buffer,
  nowSeconds: number
): { ok: true; carousel: VerifiedCarousel } | { ok: false; error: string } {
  const invalid = { ok: false as const, error: 'El carrusel no es válido. Toca Actualizar.' };
  if (!Array.isArray(raw) || raw.length < 3 || raw.length > CAROUSEL_MAX_ITEMS + 2) return invalid;
  const paths: string[] = [];
  let set: CarouselSet | null = null;
  const items: CarouselItem[] = [];
  for (let i = 0; i < raw.length; i++) {
    const path = raw[i];
    if (typeof path !== 'string') return invalid;
    const match = PATH_RE.exec(path);
    if (!match) return invalid;
    const check = checkCarouselPath(match[1], match[2], key, nowSeconds);
    if (!check.ok) {
      return check.reason === 'vencida'
        ? { ok: false, error: 'Las imágenes de este carrusel ya vencieron. Toca Actualizar.' }
        : invalid;
    }
    const slide = check.slide;
    if (set && !sameSet(set, slide.set)) return invalid;
    set = slide.set;
    const expected = i === 0 ? 'portada' : i === raw.length - 1 ? 'cierre' : 'producto';
    if (slide.type !== expected) return invalid;
    if (slide.type === 'producto') {
      if (slide.item.rank !== i) return invalid;
      items.push(slide.item);
    }
    paths.push(path);
  }
  if (!set || items.length !== set.ids.length) return invalid;
  return { ok: true, carousel: { set, items, paths } };
}

/** Con qué se anota en la actividad: el mismo carrusel da siempre lo mismo. */
export function carouselPublishTarget(set: Pick<CarouselSet, 'kind' | 'day' | 'ids'>): string {
  return `carrusel:${set.kind}:${set.day}:${set.ids.join('.')}`;
}

export function parseNetworks(raw: unknown): MetaNetwork[] | null {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > META_NETWORKS.length) return null;
  const out: MetaNetwork[] = [];
  for (const n of raw) {
    if (typeof n !== 'string' || !(META_NETWORKS as readonly string[]).includes(n) || out.includes(n as MetaNetwork)) return null;
    out.push(n as MetaNetwork);
  }
  return out;
}

/** Un evento 'publicar_meta' de la actividad (solo lo que importa aquí). */
export interface PublishEvent {
  at: string;
  after: unknown;
}

/** Cuánto bloquea un intento sin respuesta final, para que dos toques no publiquen dos veces. */
export const IN_FLIGHT_MS = 10 * 60_000;

export type PublishState =
  | { kind: 'nuevo' }
  | { kind: 'publicado'; permalink: string | null }
  | { kind: 'en-curso'; uncertain: boolean };

/**
 * Si el carrusel ya salió en esa red, según la actividad (del más nuevo al
 * más viejo). "publicando" o "incierto" de hace menos de IN_FLIGHT_MS
 * bloquean; un "error" deja intentar de nuevo.
 */
export function publishState(events: PublishEvent[], network: MetaNetwork, nowMs: number): PublishState {
  const sorted = [...events].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
  for (const event of sorted) {
    const after = (event.after ?? {}) as { red?: unknown; estado?: unknown; permalink?: unknown };
    if (after.red !== network) continue;
    if (after.estado === 'publicado') {
      return { kind: 'publicado', permalink: typeof after.permalink === 'string' ? after.permalink : null };
    }
    if (after.estado === 'publicando' || after.estado === 'incierto') {
      const age = nowMs - new Date(event.at).getTime();
      if (Number.isFinite(age) && age < IN_FLIGHT_MS) return { kind: 'en-curso', uncertain: after.estado === 'incierto' };
    }
    return { kind: 'nuevo' };
  }
  return { kind: 'nuevo' };
}
