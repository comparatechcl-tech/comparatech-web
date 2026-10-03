/**
 * Badges de specs de la tarjeta de producto.
 *
 * Antes se mostraban los tres primeros valores cortos de las specs tal como
 * llegaban de Mercado Libre, y las tarjetas terminaban diciendo "No",
 * "BLIK-AIR500", "5V" o "Multicolor": datos que no ayudan a comparar. Ahora
 * se toman de una lista de specs que sí sirven para decidir, en orden de
 * importancia, y con el texto adaptado para leerse sin la etiqueta ("12 GB
 * RAM" en vez de "12 GB").
 *
 * Las claves casi no se repiten entre categorías (un celular no tiene
 * "Formato del audífono"), así que basta una sola lista.
 */

type Rule = [key: string, label: (value: string) => string | null];

const MAX_BADGES = 3;
const MAX_LENGTH = 22;

const when = (pattern: RegExp, format: (v: string) => string = (v) => v) => (v: string) =>
  pattern.test(v) ? format(v) : null;

const ifYes = (text: string) => (v: string) => (v === 'Sí' ? text : null);

/** "256 GB" → 256, "1 TB" → 1024; null si no es una capacidad. */
function gigabytes(v: string): number | null {
  const m = /^(\d+)\s?(GB|TB)$/.exec(v);
  if (!m) return null;
  return m[2] === 'TB' ? Number(m[1]) * 1024 : Number(m[1]);
}

const CHARGE_SPEED: Record<string, string> = {
  'super rápida': 'Carga súper rápida',
  'súper rápida': 'Carga súper rápida',
  rápida: 'Carga rápida',
  'carga rápida': 'Carga rápida',
  turbo: 'Carga turbo',
};

const RULES: Rule[] = [
  // Celulares
  // Algunos vendedores invierten RAM y almacenamiento ("12 GB" de memoria
  // interna y "256 GB" de RAM). Un valor fuera de rango se descarta: es
  // preferible un badge menos que uno falso.
  ['Memoria interna', (v) => ((gigabytes(v) ?? 0) >= 16 ? v : null)],
  [
    'Memoria RAM',
    (v) => {
      const gb = gigabytes(v);
      return gb !== null && gb <= 24 ? `${v} RAM` : null;
    },
  ],
  ['Red móvil', (v) => (v.includes('5G') ? '5G' : v.includes('4G') ? '4G' : null)],

  // Audio
  ['Formato del audífono', when(/^[\p{L}-]{3,12}$/u)],
  ['Es inalámbrico', (v) => (v === 'Sí' ? 'Inalámbrico' : v === 'No' ? 'Con cable' : null)],
  ['Potencia de salida (RMS)', when(/^\d+(\.\d+)?\s?W$/)],
  ['Autonomía máxima de la batería', when(/^\d+(\.\d+)?\s?h$/, (v) => `${v} de batería`)],
  ['Duración de la batería del audífono', when(/^\d+(\.\d+)?\s?h$/, (v) => `${v} de batería`)],
  ['Clasificación IP', when(/^IP[X\d]\d$/i, (v) => v.toUpperCase())],
  ['Con micrófono', ifYes('Con micrófono')],

  // Relojes y bandas
  ['Tamaño de la pantalla', when(/^\d+(\.\d+)?\s?"$/, (v) => `Pantalla ${v.replace(/\s+"/, '"')}`)],
  ['Es resistente al agua', ifYes('Resistente al agua')],

  // Cargadores y baterías
  ['Tipo de velocidad de carga', (v) => CHARGE_SPEED[v.trim().toLowerCase()] ?? null],
  ['Tipo de conector', when(/^(USB-C|USB\/USB-C|Lightning|Micro USB)$/i)],

  // Sillas
  ['Material del tapizado', when(/^[\p{L} ]{3,20}$/u)],
  ['Altura del respaldo', when(/^\d+(\.\d+)?\s?cm$/, (v) => `Respaldo ${v}`)],

  // Almacenamiento
  ['Capacidad', when(/^\d+\s?(GB|TB)$/)],
  ['Formato de la tarjeta', when(/^[\p{L}\d ]{2,12}$/u)],
  ['Velocidad de lectura', when(/^\d+\s?MB\/s$/, (v) => `Lectura ${v}`)],

  // Filamentos
  ['Material', when(/^[A-Z]{2,6}\+?$/)],
  ['Diámetro del filamento', when(/^\d+(\.\d+)?\s?mm$/)],

  // Al final porque casi todos los celulares lo son
  ['Es Dual SIM', ifYes('Dual SIM')],
];

export function specBadges(specs: Record<string, string | number> | null | undefined): string[] {
  if (!specs) return [];

  const badges: string[] = [];
  for (const [key, label] of RULES) {
    const raw = specs[key];
    if (raw === undefined || raw === null) continue;

    const text = label(String(raw).trim());
    if (!text || text.length > MAX_LENGTH || badges.includes(text)) continue;

    badges.push(text);
    if (badges.length === MAX_BADGES) break;
  }
  return badges;
}
