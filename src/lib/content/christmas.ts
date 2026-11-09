/**
 * La temática de Navidad de las piezas de redes (la historia y la
 * publicación del feed, lib/content/offer-template): un listón rojo de lado a
 * lado con un moño y la etiqueta "Idea de regalo" con el rango de precio
 * ("Menos de $50 mil", "$50 a $100 mil"...), el gorro del Viejito Pascuero
 * sobre el logo y nieve suave en los bordes. En la historia, además, el
 * Viejito Pascuero se asoma abajo a la derecha y un arbolito con un bastón de
 * dulce adorna la esquina de abajo a la izquierda; el centro, donde va el
 * sticker del enlace, queda libre. Los dibujos están en christmas-art.
 * La foto, el precio, el descuento y la hora del precio van igual que siempre.
 *
 * CÓMO SE ENCIENDE: cambiando CHRISTMAS_WINDOW (abajo) por las fechas en que
 * tiene que salir, por ejemplo { from: '2026-11-10', until: '2026-12-25' },
 * y publicando. Las dos fechas son días de Chile y cuentan las dos. Con null
 * está apagada.
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

/** Encendida: el dueño aprobó las muestras el 09-11-2026 ("enciéndelas hoy"). */
export const CHRISTMAS_WINDOW: ChristmasWindow | null = { from: '2026-11-09', until: '2026-12-25' };

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
