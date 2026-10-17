/**
 * Qué quiere decir cada aviso "Ojo: …" de las tarjetas de /admin/historias
 * y /admin/videos, y qué hacer con él, en palabras simples.
 *
 * Los avisos los arma interestScore (lib/social/interest) y llegan unidos con
 * "; ", con " (y N más)" al final si no cupieron todos. Acá se separan y se
 * reconoce cada uno por su texto exacto: si interest.ts cambia una frase, el
 * test de este archivo lo nota (arma cada aviso con interestScore y exige que
 * se reconozca).
 *
 * Sin imports a propósito: lo usan componentes de cliente.
 */

export type WarningKind = 'precio' | 'vendedor' | 'oferta' | 'otro';

export interface WarningHelp {
  kind: WarningKind;
  /** Qué significa, en una o dos frases. */
  meaning: string;
  /** Qué hacer antes de subirla. */
  whatToDo: string;
}

/** Para la lista completa ("¿Qué significa cada aviso?"): cómo se ve el aviso y su explicación. */
export interface WarningGlossaryEntry extends WarningHelp {
  /** El aviso como aparece en la tarjeta, con N o $X donde va la cifra. */
  example: string;
}

const CHECK_ML = 'Revisa el precio con el botón "Ver en Mercado Libre" justo antes de subirla, y súbela al tiro.';

/**
 * El aviso de un historial que no se pudo leer (HISTORY_UNREAD_WARNING en
 * lib/social/interest, que este archivo no importa: lo usan componentes de
 * cliente). En Videos nunca aparece: un video sin historial no se muestra.
 */
export const HISTORY_UNREAD_EXAMPLE = 'hoy no se pudo leer su historial de precios';

/** Minúsculas y sin tildes: el texto se reconoce aunque llegue con otra tilde o mayúscula. */
function fold(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

interface Rule {
  kind: WarningKind;
  example: string;
  /** Contra el texto sin tildes y en minúsculas. */
  pattern: RegExp;
  /** `value` es lo que captura el patrón (la cifra), o null en la lista completa. */
  help: (value: string | null) => { meaning: string; whatToDo: string };
}

const RULES: Rule[] = [
  {
    kind: 'precio',
    example: 'hace poco estuvo a $X',
    pattern: /^hace poco estuvo a (\$[\d.]+)$/,
    help: (price) => ({
      meaning: price
        ? `En los últimos 30 días el sitio lo vio a ${price}, más bajo que hoy.`
        : 'En los últimos 30 días el sitio lo vio a un precio más bajo que el de hoy (el aviso dice cuánto).',
      whatToDo:
        'Se puede subir, pero quien lo vio a ese precio puede sentir que no es oferta. Si hay otras sin este aviso, súbelas primero.',
    }),
  },
  {
    kind: 'precio',
    example: 'otro vendedor lo ofrece a menos',
    pattern: /^otro vendedor lo ofrece a menos$/,
    help: () => ({
      meaning: 'En la misma ficha de Mercado Libre hay otro vendedor con un precio más bajo que el que muestra la tarjeta.',
      whatToDo: 'Toca "Ver en Mercado Libre": si arriba aparece otro precio, no la subas y toca Actualizar.',
    }),
  },
  {
    kind: 'vendedor',
    example: 'vendedor con pocas ventas (N)',
    pattern: /^vendedor con pocas ventas \((\d+)\)$/,
    help: (sales) => ({
      meaning: sales
        ? `El vendedor que aparece primero lleva ${plural(Number(sales), 'venta', 'ventas')} y no es tienda oficial.`
        : 'El vendedor que aparece primero lleva menos de 100 ventas y no es tienda oficial.',
      whatToDo: 'Se puede subir, pero es más seguro elegir ofertas de vendedores con más ventas.',
    }),
  },
  {
    kind: 'precio',
    example: HISTORY_UNREAD_EXAMPLE,
    pattern: /^hoy no se pudo leer su historial de precios$/,
    help: () => ({
      meaning:
        'El sitio no pudo leer ahora el historial de precios de este producto, así que no sabe si estuvo más bajo hace poco. Es una falla pasajera del sitio, no del producto.',
      whatToDo: 'Toca Actualizar en unos minutos antes de subirla.',
    }),
  },
  {
    kind: 'precio',
    example: 'cambió de precio y no sabemos cuánto costaba antes',
    pattern: /^cambio de precio y no sabemos cuanto costaba antes$/,
    help: () => ({
      meaning: 'El precio cambió hace poco y el sitio no alcanzó a anotar cuánto costaba hasta ese cambio.',
      whatToDo: 'Mira el precio con el botón "Ver en Mercado Libre" antes de subirla.',
    }),
  },
  {
    kind: 'precio',
    example: 'el precio cambió N veces en dos días',
    pattern: /^el precio cambio (\d+) veces en dos dias$/,
    help: (times) => ({
      meaning: times
        ? `El precio se movió ${times} veces en los últimos dos días: puede volver a cambiar en cualquier momento.`
        : 'El precio se movió varias veces en los últimos dos días: puede volver a cambiar en cualquier momento.',
      whatToDo: CHECK_ML,
    }),
  },
  {
    kind: 'precio',
    example: 'el precio va y vuelve entre los mismos valores',
    pattern: /^el precio va y vuelve entre los mismos valores$/,
    help: () => ({
      meaning:
        'El precio sube y baja entre los mismos valores, por ejemplo porque dos vendedores se turnan el primer lugar. El de hoy ya rigió hace poco.',
      whatToDo: CHECK_ML,
    }),
  },
  {
    kind: 'precio',
    example: 'N vendedores en la ficha: el precio puede cambiar',
    pattern: /^(\d+) vendedores en la ficha: el precio puede cambiar$/,
    help: (sellers) => ({
      meaning: `Hay ${sellers ? `${sellers} vendedores` : 'varios vendedores'} en la misma ficha de Mercado Libre: el que aparece primero, y con él el precio, puede cambiar en cualquier momento.`,
      whatToDo: CHECK_ML,
    }),
  },
  {
    kind: 'otro',
    example: 'no es nuevo',
    pattern: /^no es nuevo$/,
    help: () => ({
      meaning: 'El nombre dice que no es nuevo: reacondicionado, usado, caja abierta o algo parecido.',
      whatToDo: 'Si la subes, que se note que no es nuevo.',
    }),
  },
  {
    kind: 'oferta',
    example: 'sin oferta que mostrar',
    pattern: /^sin oferta que mostrar$/,
    help: () => ({
      meaning: 'Casi no tiene descuento, y el sitio no ha visto que el precio baje.',
      whatToDo: 'Mejor elige otra: esta no se ve como oferta.',
    }),
  },
  {
    kind: 'oferta',
    example: 'descuento del vendedor con poco respaldo',
    pattern: /^descuento del vendedor con poco respaldo$/,
    help: () => ({
      meaning:
        'Muestra 30% de descuento o más, pero esa cifra la pone el vendedor y el sitio no ha visto el producto a ese precio sin descuento.',
      whatToDo: 'Se puede subir. Si hay otras con una baja que el sitio sí vio, súbelas primero.',
    }),
  },
  {
    kind: 'oferta',
    example: 'la oferta es chica',
    pattern: /^la oferta es chica$/,
    help: () => ({
      meaning: 'El descuento es chico y el sitio no ha visto que el precio baje: como oferta, llama poco la atención.',
      whatToDo: 'Se puede subir. Si hay otras con más descuento, súbelas primero.',
    }),
  },
  {
    kind: 'otro',
    example: 'el nombre parte con un código',
    pattern: /^el nombre parte con un codigo$/,
    help: () => ({
      meaning: 'El nombre del producto empieza con un código de modelo, así que se entiende menos qué es.',
      whatToDo: 'Se puede subir. Si quieres, en el texto cuenta qué producto es.',
    }),
  },
];

const MORE_RE = /^(.*?)\s*\(y (\d+) m[aá]s\)$/i;
const UNKNOWN_TO_DO = 'Toca "Ver en Mercado Libre" y revisa la oferta antes de subirla.';

function moreHelp(n: number): WarningHelp {
  return {
    kind: 'otro',
    meaning: n === 1 ? 'Hay 1 aviso más que no cabe en la tarjeta.' : `Hay ${n} avisos más que no caben en la tarjeta.`,
    whatToDo: 'Toca "Ver en Mercado Libre" y revisa la oferta con calma antes de subirla.',
  };
}

function explainOne(text: string): WarningHelp {
  const folded = fold(text);
  for (const rule of RULES) {
    const match = rule.pattern.exec(folded);
    if (!match) continue;
    // La cifra se toma del texto original: el plegado no toca dígitos, "$" ni puntos.
    const value = match[1] !== undefined ? match[1] : null;
    return { kind: rule.kind, ...rule.help(value) };
  }
  return { kind: 'otro', meaning: text, whatToDo: UNKNOWN_TO_DO };
}

/**
 * Cada aviso de un "Ojo: …", con qué significa y qué hacer. Acepta el texto
 * con o sin "Ojo:" adelante y con o sin punto final. Un aviso que no conoce
 * sale como 'otro', con su texto tal cual. Vacío si no hay aviso.
 */
export function explainWarning(warning: string): WarningHelp[] {
  if (typeof warning !== 'string') return [];
  let text = warning.trim();
  if (/^ojo\s*:/i.test(text)) text = text.replace(/^ojo\s*:\s*/i, '');
  text = text.replace(/\.+$/, '').trim();
  if (!text) return [];

  const parts = text
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  const result: WarningHelp[] = [];
  let more = 0;
  parts.forEach((part, i) => {
    let own = part;
    // " (y N más)" va pegado al último: dice cuántos no cupieron.
    if (i === parts.length - 1) {
      const match = MORE_RE.exec(part);
      if (match) {
        more = Number(match[2]);
        own = match[1].trim();
      }
    }
    if (own) result.push(explainOne(own));
  });
  if (more > 0) result.push(moreHelp(more));
  return result;
}

/**
 * Todos los avisos que puede traer una tarjeta, con su explicación: para la
 * lista plegada "¿Qué significa cada aviso?". En el orden en que interest.ts
 * los pone (del más grave al menos grave).
 */
export const WARNING_GLOSSARY: readonly WarningGlossaryEntry[] = RULES.map((rule) => ({
  example: rule.example,
  kind: rule.kind,
  ...rule.help(null),
}));
