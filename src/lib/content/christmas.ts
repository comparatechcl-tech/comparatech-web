/**
 * La temática de Navidad de las piezas de redes (la historia y la
 * publicación del feed, lib/content/offer-template): un listón rojo de lado a
 * lado con un moño y la etiqueta "Idea de regalo" con el rango de precio
 * ("Menos de $50 mil", "$50 a $100 mil"...), y nieve suave en los bordes.
 * La foto, el precio, el descuento y la hora del precio van igual que siempre.
 *
 * CÓMO SE ENCIENDE: cambiando CHRISTMAS_WINDOW (abajo) por las fechas en que
 * tiene que salir, por ejemplo { from: '2026-11-10', until: '2026-12-25' },
 * y publicando. Las dos fechas son días de Chile y cuentan las dos. Con null
 * (como queda hasta que el dueño apruebe las muestras) está apagada.
 *
 * Se decide al dibujar cada pieza (lib/social/piece-url y el kit del admin),
 * no al firmar su dirección: una historia programada el 24 que se publica
 * el 26 ya sale sin Navidad.
 */

export type OfferTheme = 'navidad';

/** Desde y hasta qué día (AAAA-MM-DD, en Chile, los dos incluidos) las piezas salen con la temática. */
export interface ChristmasWindow {
  from: string;
  until: string;
}

/** Apagada: se enciende solo después de que el dueño apruebe las muestras. */
export const CHRISTMAS_WINDOW: ChristmasWindow | null = null;

const DAY_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

/** ¿Es una ventana bien escrita? Dos fechas AAAA-MM-DD y la primera no después de la segunda. */
export function isValidChristmasWindow(window: ChristmasWindow): boolean {
  return DAY_RE.test(window.from) && DAY_RE.test(window.until) && window.from <= window.until;
}

/** El día en Chile de un instante, como AAAA-MM-DD. */
export function chileDay(at: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
}

/**
 * La temática de las piezas en ese momento: 'navidad' si el día (en Chile)
 * cae dentro de la ventana, o null. Una ventana mal escrita la deja apagada.
 */
export function offerThemeAt(at: Date = new Date(), window: ChristmasWindow | null = CHRISTMAS_WINDOW): OfferTheme | null {
  if (!window || !isValidChristmasWindow(window) || Number.isNaN(at.getTime())) return null;
  const day = chileDay(at);
  return day >= window.from && day <= window.until ? 'navidad' : null;
}

export type GiftBudget = 'Menos de $50 mil' | '$50 a $100 mil' | '$100 a $300 mil' | 'Más de $300 mil';

/**
 * El rango de presupuesto de un regalo, según el precio. Siempre cierto:
 * "Menos de $50 mil" es menos de $50.000 (un precio de $50.000 justo ya va
 * en "$50 a $100 mil"), los rangos incluyen sus dos puntas ($100.000 va en
 * "$50 a $100 mil" y $300.000 en "$100 a $300 mil") y "Más de $300 mil"
 * empieza en $300.001. Sin un precio válido no hay rango.
 */
export function giftBudgetBand(price: number): GiftBudget | null {
  if (!Number.isFinite(price) || price <= 0) return null;
  if (price < 50_000) return 'Menos de $50 mil';
  if (price <= 100_000) return '$50 a $100 mil';
  if (price <= 300_000) return '$100 a $300 mil';
  return 'Más de $300 mil';
}

/** Un copo de la nieve de la pieza: centro, radio y opacidad. */
export interface Snowflake {
  x: number;
  y: number;
  r: number;
  a: number;
}

/** Números al azar que salen siempre iguales: la misma pieza se dibuja siempre igual. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * La nieve de una pieza de `height` px de alto: copos chicos y tenues arriba
 * de la cabecera, en los márgenes a los lados de la tarjeta y, en la
 * historia, en las esquinas de abajo. Nunca sobre la cabecera, el nombre,
 * la tarjeta ni el centro del lugar del sticker del enlace.
 */
export function snowFor(height: number, { top, cardBottom, sticker }: { top: number; cardBottom: number; sticker: boolean }): Snowflake[] {
  const rnd = seeded(height * 31 + 7);
  const flakes: Snowflake[] = [];
  const add = (count: number, x0: number, x1: number, y0: number, y1: number, alpha: [number, number]) => {
    for (let i = 0; i < count; i++) {
      const big = rnd() < 0.2;
      flakes.push({
        x: Math.round(x0 + rnd() * (x1 - x0)),
        y: Math.round(y0 + rnd() * (y1 - y0)),
        r: big ? 4 + Math.round(rnd() * 2) : 2 + Math.round(rnd() * 1.5),
        a: Math.round((alpha[0] + rnd() * (alpha[1] - alpha[0])) * 100) / 100,
      });
    }
  };
  // Arriba de la cabecera (en la historia, la franja que tapa Instagram: ahí solo se ve como ambiente). En el
  // feed esa franja es angosta: van menos copos, para que no se vea cargada.
  const topCount = Math.round(28 * Math.min(1, (top - 28) / 230));
  if (topCount > 0) add(topCount, 10, 1070, 10, top - 18, [0.14, 0.42]);
  // Los márgenes a los lados de la tarjeta.
  add(9, 8, 58, top + 90, cardBottom - 20, [0.12, 0.32]);
  add(9, 1022, 1072, top + 90, cardBottom - 20, [0.12, 0.32]);
  // Abajo, en las esquinas: el centro queda libre para el sticker del enlace.
  if (sticker) {
    add(7, 14, 150, cardBottom + 30, cardBottom + 200, [0.1, 0.22]);
    add(7, 930, 1066, cardBottom + 30, cardBottom + 200, [0.1, 0.22]);
  }
  return flakes;
}

// El moño (264x198, se dibuja a 132x99). Lo genera scripts/piezas/navidad.mjs, con el mismo dibujo del reel "navidad".
export const CHRISTMAS_BOW_PNG = 'data:image/png;base64,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';
