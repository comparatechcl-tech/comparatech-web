/**
 * Cupones de Mercado Libre que manda el canal de afiliados, para publicarlos
 * desde /admin/historias/cupones: el dueño pega el aviso, revisa los datos y
 * el sitio arma la imagen (feed e historia) y el texto de cada red.
 *
 * Puro y sin Node: lo usa también el navegador para leer el aviso pegado.
 * Las direcciones firmadas de las imágenes están en lib/social/coupons-url.
 *
 * Un cupón no lleva link de compra: el código se ingresa al pagar en Mercado
 * Libre. Por eso la historia puede salir sola por la API, sin sticker.
 */

export const COUPON_MAX = 4;
export const COUPON_NOTE_MAX = 40;

export type CouponKind = 'monto' | 'porcentaje';
export type MinWord = 'desde' | 'sobre';

export interface Coupon {
  /** El código tal como se ingresa al pagar: mayúsculas y números. */
  code: string;
  kind: CouponKind;
  /** Pesos de descuento (monto) o el porcentaje (porcentaje). */
  value: number;
  /** Tope en pesos de un cupón de porcentaje; 0 si no tiene. */
  cap: number;
  /** Compra mínima en pesos; 0 si no tiene. */
  min: number;
  /** "desde $X" o "sobre $X", como lo diga el aviso. */
  minWord: MinWord;
  /** Aclaración corta opcional ("compras internacionales"). */
  note: string;
}

const CODE_RE = /^[A-Z0-9]{3,20}$/;
const MAX_PESOS = 99_999_999;
const NOTE_RE = /^[0-9A-Za-zÁÉÍÓÚÜÑáéíóúüñ $%.,:;()/+-]*$/;
/** Lo que la voz de la marca no dice (CLAUDE.md), tampoco en la aclaración de un cupón. */
const FORBIDDEN_RE =
  /solo hoy|s[oó]lo por hoy|imperdible|mejor precio|m[aá]s barat|recomendad|verificad|precio de lista|precio normal|rebajad|antes \$|publicidad|comisi[oó]n/i;

const isPesos = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0 && n <= MAX_PESOS;

/** Por qué un cupón no sirve, o null si está bien. Los mensajes son para el dueño. */
export function couponProblem(c: Coupon): string | null {
  const name = c.code || 'Un cupón';
  if (!CODE_RE.test(c.code)) return `${name}: el código va con letras mayúsculas y números, sin espacios (de 3 a 20).`;
  if (c.kind !== 'monto' && c.kind !== 'porcentaje') return `${name}: falta si es en pesos o en porcentaje.`;
  if (c.kind === 'monto' && (!isPesos(c.value) || c.value < 100)) return `${name}: falta cuántos pesos de descuento da.`;
  if (c.kind === 'porcentaje' && (!Number.isInteger(c.value) || c.value < 1 || c.value > 90)) {
    return `${name}: el porcentaje va entre 1 y 90.`;
  }
  if (!isPesos(c.cap) || (c.kind === 'monto' && c.cap !== 0)) return `${name}: el tope solo va en cupones de porcentaje.`;
  if (!isPesos(c.min)) return `${name}: la compra mínima no es válida.`;
  if (c.kind === 'monto' && c.min > 0 && c.min <= c.value) return `${name}: la compra mínima tiene que ser mayor que el descuento.`;
  if (c.minWord !== 'desde' && c.minWord !== 'sobre') return `${name}: la compra mínima va "desde" o "sobre".`;
  if (typeof c.note !== 'string' || c.note.length > COUPON_NOTE_MAX) return `${name}: la aclaración va de hasta ${COUPON_NOTE_MAX} letras.`;
  if (c.note !== c.note.trim() || /\s{2}/.test(c.note) || !NOTE_RE.test(c.note)) {
    return `${name}: la aclaración lleva solo letras, números y signos simples (sin emojis).`;
  }
  if (FORBIDDEN_RE.test(c.note)) return `${name}: la aclaración usa una frase que la marca no dice.`;
  return null;
}

/** Revisa la lista entera: entre 1 y COUPON_MAX cupones, sin códigos repetidos. */
export function couponsProblem(coupons: Coupon[]): string | null {
  if (coupons.length < 1) return 'Agrega al menos un cupón.';
  if (coupons.length > COUPON_MAX) return `Caben hasta ${COUPON_MAX} cupones en la imagen.`;
  const seen = new Set<string>();
  for (const c of coupons) {
    const problem = couponProblem(c);
    if (problem) return problem;
    if (seen.has(c.code)) return `${c.code} está dos veces.`;
    seen.add(c.code);
  }
  return null;
}

/**
 * Lo que llega del navegador, como Coupon limpio (o null si no tiene la
 * forma). No revisa los valores: eso lo hace couponsProblem.
 */
export function toCoupons(raw: unknown): Coupon[] | null {
  if (!Array.isArray(raw) || raw.length > COUPON_MAX) return null;
  const out: Coupon[] = [];
  for (const r of raw) {
    if (!r || typeof r !== 'object') return null;
    const o = r as Record<string, unknown>;
    if (typeof o.code !== 'string' || typeof o.note !== 'string') return null;
    if (typeof o.value !== 'number' || typeof o.cap !== 'number' || typeof o.min !== 'number') return null;
    if (o.kind !== 'monto' && o.kind !== 'porcentaje') return null;
    if (o.minWord !== 'desde' && o.minWord !== 'sobre') return null;
    out.push({
      code: o.code.trim().toUpperCase(),
      kind: o.kind,
      value: o.value,
      cap: o.kind === 'monto' ? 0 : o.cap,
      min: o.min,
      minWord: o.minWord,
      note: o.note.trim().replace(/\s+/g, ' '),
    });
  }
  return out;
}

function pesos(value: number): string {
  return `$${String(Math.round(value)).replace(/\B(?=(\d{3})+(?!\d))/g, '.')}`;
}

/** "$45.000 de descuento" o "10% de descuento, tope $20.000". */
export function couponDiscountText(c: Coupon): string {
  if (c.kind === 'monto') return `${pesos(c.value)} de descuento`;
  return c.cap > 0 ? `${c.value}% de descuento, tope ${pesos(c.cap)}` : `${c.value}% de descuento`;
}

/** "en compras desde $90.000 · compras internacionales", o '' si no hay nada que decir. */
export function couponConditionText(c: Coupon): string {
  const parts: string[] = [];
  if (c.min > 0) parts.push(`en compras ${c.minWord} ${pesos(c.min)}`);
  if (c.note) parts.push(c.note);
  return parts.join(' · ');
}

const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

/** "26 de octubre" de un día AAAAMMDD. */
export function couponDayLabel(day: number): string {
  return `${day % 100} de ${MONTHS[(Math.floor(day / 100) % 100) - 1]}`;
}

export const COUPON_FOOTER = 'Aplican a productos seleccionados por Mercado Libre. El código se ingresa al pagar.';

/** El texto de cada red, igual al de los cupones del 26-10-2026. Facebook lleva el link; Instagram, "link en el perfil". */
export function couponCaptions(coupons: Coupon[], day: number, siteUrl: string): { instagram: string; facebook: string } {
  const lines = coupons.map((c) => {
    const condition = couponConditionText(c);
    return `${c.code}: ${couponDiscountText(c)}${condition ? ` ${condition}` : ''}`;
  });
  const head = `🎟️ Cupones de Mercado Libre para hoy, ${couponDayLabel(day)}:\n\n${lines.join('\n')}\n\nAplican a productos seleccionados por Mercado Libre: el descuento aparece al pagar si tu producto entra.`;
  const tags = '#mercadolibre #cupones #chile #tecnologia';
  const base = siteUrl.replace(/\/+$/, '');
  return {
    instagram: `${head}\n\nOfertas de tecnología con precio revisado: link en el perfil.\n\n${tags}`,
    facebook: `${head}\n\nOfertas de tecnología con precio revisado: ${base}/ofertas?src=facebook-cupones\n\n${tags}`,
  };
}

// ---------------------------------------------------------------------------
// Leer el aviso pegado del canal. Es una ayuda: el dueño revisa lo que salió
// antes de armar la imagen.

/** Palabras en mayúsculas que aparecen en los avisos y no son códigos. */
const NOT_CODES = new Set([
  'OFF', 'USA', 'MELI', 'FULL', 'HOY', 'CUPON', 'CUPONES', 'CODIGO', 'CODIGOS', 'MERCADO', 'LIBRE', 'CHILE', 'ENVIO', 'GRATIS',
  'DESCUENTO', 'DESCUENTOS', 'TOPE', 'MINIMO', 'COMPRA', 'COMPRAS', 'DESDE', 'SOBRE', 'HASTA', 'NUEVO', 'NUEVOS', 'LINK', 'AQUI',
  'IMPORTANTE', 'OJO', 'ATENCION', 'PRODUCTOS', 'SELECCIONADOS', 'VALIDO', 'VIGENTE', 'CLP', 'PESOS', 'BLACK', 'FRIDAY', 'CYBER',
]);

/** Fin de línea, o punto seguido de mayúscula, número o $ ("$500.000. GALAXIA20"; no "dcto. en"). */
const SENTENCE_RE = /\n|[.!?;](?=\s+[A-Z0-9$])/;
const HAS_AMOUNT_RE = /\$\s?\d|\d\s?%|\d\s?(mil|k)\b/i;

const strip = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');

/** "45.000", "45000", "45 mil", "45k" → pesos. */
function readPesos(num: string, unit: string | undefined): number {
  const n = Number(num.replace(/\./g, '').replace(',', '.'));
  if (!Number.isFinite(n)) return 0;
  return Math.round(unit ? n * 1000 : n);
}

/**
 * Los cupones que se reconocen en el texto pegado, en orden. Un código es una
 * palabra en mayúsculas con algún número (ORBITA45), o de 6 letras o más que
 * no sea una palabra común. Lo que dice cada uno se lee del pedazo de texto
 * que va desde su código hasta el siguiente.
 */
export function parseCouponText(text: string): Coupon[] {
  const src = strip(String(text ?? '')).slice(0, 4000);
  const codeRe = /(^|[^A-Za-z0-9])([A-Z][A-Z0-9]{2,19})(?![A-Za-z0-9])/g;
  const found: { code: string; at: number; end: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = codeRe.exec(src)) !== null) {
    const code = m[2];
    if (NOT_CODES.has(code)) continue;
    if (!/\d/.test(code) && code.length < 6) continue;
    if (found.some((f) => f.code === code)) continue;
    const at = m.index + m[1].length;
    found.push({ code, at, end: at + code.length });
  }

  const out: Coupon[] = [];
  for (let i = 0; i < found.length && out.length < COUPON_MAX; i++) {
    const f = found[i];
    // Lo normal: el código y después lo que da ("ORBITA45: $45.000 sobre $500.000"),
    // hasta la frase que trae el primer monto: lo que sigue puede ser de otro cupón.
    const after = src.slice(f.end, i + 1 < found.length ? found[i + 1].at : src.length).slice(0, 300);
    let terms = '';
    for (const part of after.split(SENTENCE_RE)) {
      terms += ` ${part}`;
      if (HAS_AMOUNT_RE.test(part)) break;
    }
    let coupon = readTerms(f.code, terms);
    // Si no, la frase justo antes del código ("10% en compras internacionales, código USA10").
    if (!coupon.value) {
      const before = src.slice(i > 0 ? found[i - 1].end : 0, f.at).split(SENTENCE_RE);
      coupon = readTerms(f.code, (before[before.length - 1] ?? '').slice(-300));
    }
    // Sin ningún número cerca no es un cupón: es una palabra en mayúsculas del aviso.
    if (coupon.value) out.push(coupon);
  }
  return out;
}

function readTerms(code: string, segment: string): Coupon {
  const lower = segment.toLowerCase();
  const coupon: Coupon = { code, kind: 'monto', value: 0, cap: 0, min: 0, minWord: 'desde', note: '' };

  const pct = /(\d{1,2})\s?%/.exec(segment);
  // Montos: con $ adelante, o con "mil"/"k" detrás.
  const amountRe = /\$\s?(\d{1,3}(?:\.\d{3})+|\d+)(\s?(?:mil|k)\b)?|(\d{1,3})\s?(mil|k)\b/gi;
  const amounts: { value: number; before: string; at: number }[] = [];
  let a: RegExpExecArray | null;
  while ((a = amountRe.exec(segment)) !== null) {
    const value = a[1] !== undefined ? readPesos(a[1], a[2]?.trim()) : readPesos(a[3], a[4]);
    amounts.push({ value, before: lower.slice(Math.max(0, a.index - 28), a.index), at: a.index });
  }

  // Es de porcentaje si el % va antes que cualquier monto.
  if (pct && (!amounts.length || pct.index < amounts[0].at)) {
    coupon.kind = 'porcentaje';
    coupon.value = Number(pct[1]);
  }
  for (const amount of amounts) {
    if (/tope|maximo|max\.?\s*$|hasta\s*$/.test(amount.before) && coupon.kind === 'porcentaje' && !coupon.cap) {
      coupon.cap = amount.value;
    } else if (/desde|sobre|minim|mayor|superior|mas de|compras?\s*(de\s*)?$/.test(amount.before) && !coupon.min) {
      coupon.min = amount.value;
      coupon.minWord = /sobre|mayor|superior|mas de/.test(amount.before) ? 'sobre' : 'desde';
    } else if (coupon.kind === 'monto' && !coupon.value) {
      coupon.value = amount.value;
    } else if (coupon.kind === 'porcentaje' && !coupon.cap) {
      coupon.cap = amount.value;
    } else if (!coupon.min) {
      coupon.min = amount.value;
    }
  }
  if (/internacional/.test(lower)) coupon.note = 'compras internacionales';
  return coupon;
}

/** Con qué se anota en la actividad: los mismos cupones el mismo día dan siempre lo mismo. */
export function couponPublishTarget(day: number, coupons: Pick<Coupon, 'code'>[]): string {
  return `cupones:${day}:${coupons.map((c) => c.code).join('.')}`;
}

/** Dónde se publican los cupones: el feed de Instagram, una historia de Instagram y la página de Facebook. */
export const COUPON_TARGETS = ['instagram', 'historia', 'facebook'] as const;
export type CouponTarget = (typeof COUPON_TARGETS)[number];
export const COUPON_TARGET_LABEL: Record<CouponTarget, string> = {
  instagram: 'Instagram (feed)',
  historia: 'Historia de Instagram',
  facebook: 'Facebook',
};

export function parseCouponTargets(raw: unknown): CouponTarget[] | null {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > COUPON_TARGETS.length) return null;
  const out: CouponTarget[] = [];
  for (const t of raw) {
    if (typeof t !== 'string' || !(COUPON_TARGETS as readonly string[]).includes(t) || out.includes(t as CouponTarget)) return null;
    out.push(t as CouponTarget);
  }
  // Siempre en el mismo orden, elija como elija el navegador.
  return COUPON_TARGETS.filter((t) => out.includes(t));
}
