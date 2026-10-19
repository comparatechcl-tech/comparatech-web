/**
 * Comparaciones "X vs Y" entre modelos con página (SEO etapa 2, punto 6):
 * /comparar/iphone-17-vs-iphone-17-pro. Pocas y elegidas a mano, con las
 * búsquedas reales de Chile ("iphone 17 vs 17 pro", "s26 vs s26 ultra"),
 * nunca todas las combinaciones. Muestran el precio de hoy de cada uno, el
 * más bajo que registramos y las diferencias de la ficha técnica de Mercado
 * Libre (lib/model-specs). No dicen cuál conviene.
 *
 * Sin I/O: se prueba con datos fijos.
 */
import { formatCLP } from '@/lib/format';
import { SEO_TITLE_MAX } from '@/lib/seo-title';
import { getModel, type ModelDef } from '@/lib/models';
import { MODEL_SPECS } from '@/lib/model-specs';

export interface Comparison {
  /** Los slugs de los dos modelos (lib/models), en el orden de la dirección. */
  a: string;
  b: string;
}

/** El orden es el de la lista que aprobó el dueño. */
export const COMPARISONS: Comparison[] = [
  { a: 'iphone-17', b: 'iphone-17-pro' },
  { a: 'iphone-17-pro', b: 'iphone-17-pro-max' },
  { a: 'iphone-17-pro-max', b: 'galaxy-s26-ultra' },
  { a: 'galaxy-s26', b: 'galaxy-s26-ultra' },
  { a: 'iphone-17', b: 'galaxy-s26' },
  { a: 'iphone-17-pro-max', b: 'iphone-18-pro-max' },
  { a: 'iphone-17-pro', b: 'iphone-18-pro' },
  { a: 'iphone-15', b: 'iphone-17' },
];

export function comparisonSlug(c: Comparison): string {
  return `${c.a}-vs-${c.b}`;
}

export function comparisonPath(c: Comparison): string {
  return `/comparar/${comparisonSlug(c)}`;
}

/** La comparación de una dirección, con sus dos modelos. */
export function getComparison(slug: string): { comparison: Comparison; a: ModelDef; b: ModelDef } | undefined {
  const comparison = COMPARISONS.find((c) => comparisonSlug(c) === slug);
  const a = comparison && getModel(comparison.a);
  const b = comparison && getModel(comparison.b);
  return comparison && a && b ? { comparison, a, b } : undefined;
}

/** Las comparaciones en que aparece un modelo, para enlazarlas desde su página. */
export function comparisonsOf(modelSlug: string): Comparison[] {
  return COMPARISONS.filter((c) => c.a === modelSlug || c.b === modelSlug);
}

/** El nombre corto para los títulos: "Galaxy S26 Ultra" y no "Samsung Galaxy S26 Ultra". */
export function shortModelName(model: ModelDef): string {
  const prefix = `${model.brand} `;
  return model.name.startsWith(prefix) ? model.name.slice(prefix.length) : model.name;
}

/**
 * El <title>, en el formato que aprobó el dueño ("{X} vs {Y}: precio en Chile
 * y diferencias"). Si no cabe en lo que muestra Google, se acorta: primero
 * sin "en Chile", después solo los nombres.
 */
export function comparisonTitle(a: ModelDef, b: ModelDef): string {
  const names = `${shortModelName(a)} vs ${shortModelName(b)}`;
  for (const title of [`${names}: precio en Chile y diferencias`, `${names}: precio y diferencias`]) {
    if (title.length <= SEO_TITLE_MAX) return title;
  }
  return names;
}

/**
 * Lo primero que dice la página: desde cuánto está cada uno hoy y cuánto
 * más cuesta uno que el otro. Solo precios: no dice cuál conviene.
 */
export function priceGapText(a: ModelDef, b: ModelDef, fromA: number | null, fromB: number | null): string {
  const na = shortModelName(a);
  const nb = shortModelName(b);
  if (fromA === null && fromB === null) return `Hoy ni ${na} ni ${nb} tienen versiones a la venta con vendedor de reputación verde en Mercado Libre.`;
  if (fromA === null) return `Hoy ${nb} está desde ${formatCLP(fromB!)} en Mercado Libre; ${na} no tiene versiones a la venta con vendedor de reputación verde.`;
  if (fromB === null) return `Hoy ${na} está desde ${formatCLP(fromA)} en Mercado Libre; ${nb} no tiene versiones a la venta con vendedor de reputación verde.`;
  const gap = Math.abs(fromA - fromB);
  const versus = `Hoy ${na} está desde ${formatCLP(fromA)} y ${nb} desde ${formatCLP(fromB)} en Mercado Libre`;
  if (gap === 0) return `${versus}: cuestan lo mismo.`;
  return `${versus}: ${fromA > fromB ? na : nb} cuesta ${formatCLP(gap)} más.`;
}

/** "6.3 \"" → "6,3\""; "5 Ah" → "5.000 mAh". Lo demás, como lo escribe Mercado Libre. */
function tidy(value: string): string {
  const ah = /^(\d+(?:[.,]\d+)?)\s*Ah$/i.exec(value.trim());
  if (ah) return `${Math.round(parseFloat(ah[1].replace(',', '.')) * 1000).toLocaleString('es-CL')} mAh`;
  return value.replace(/(\d)\.(\d)/g, '$1,$2').replace(/\s+"/g, '"').trim();
}

type Attrs = Record<string, string>;

/** Las filas de la tabla: cada una arma su valor con uno o más datos de la ficha. */
const SPEC_ROWS: { label: string; value: (attrs: Attrs) => string | null }[] = [
  {
    label: 'Pantalla',
    value: (x) =>
      x.DISPLAY_SIZE
        ? [tidy(x.DISPLAY_SIZE), x.DISPLAY_TECHNOLOGY, x.DISPLAY_REFRESH_RATE].filter(Boolean).join(', ')
        : null,
  },
  // Mercado Libre a veces escribe la marca y el modelo con una barra: "Qualcomm | SM8850".
  { label: 'Procesador', value: (x) => (x.PROCESSOR_MODEL ? x.PROCESSOR_MODEL.replace(/\s*\|\s*/g, ' ') : null) },
  { label: 'Memoria RAM', value: (x) => x.RAM ?? null },
  {
    label: 'Cámaras traseras',
    value: (x) =>
      x.REAR_CAMERAS_NUMBER && x.MAIN_REAR_CAMERA_RESOLUTION
        ? `${x.REAR_CAMERAS_NUMBER} (principal de ${x.MAIN_REAR_CAMERA_RESOLUTION})`
        : (x.REAR_CAMERAS_NUMBER ?? (x.MAIN_REAR_CAMERA_RESOLUTION ? `Principal de ${x.MAIN_REAR_CAMERA_RESOLUTION}` : null)),
  },
  { label: 'Zoom óptico', value: (x) => x.OPTICAL_ZOOM ?? null },
  { label: 'Cámara frontal', value: (x) => x.MAIN_FRONT_CAMERA_RESOLUTION ?? null },
  { label: 'Batería', value: (x) => (x.BATTERY_CAPACITY ? tidy(x.BATTERY_CAPACITY) : null) },
  { label: 'Carga inalámbrica', value: (x) => x.WITH_WIRELESS_CHARGING ?? null },
  { label: 'Resistencia al agua y al polvo', value: (x) => x.IP_RATING ?? null },
  { label: 'Peso', value: (x) => (x.WEIGHT ? tidy(x.WEIGHT) : null) },
  { label: 'Lápiz incluido', value: (x) => (x.INCLUDES_PENCIL === 'Sí' ? 'Sí' : x.INCLUDES_PENCIL ? 'No' : null) },
  { label: 'Año de lanzamiento', value: (x) => x.RELEASE_YEAR ?? null },
];

export interface SpecRow {
  label: string;
  a: string | null;
  b: string | null;
}

/**
 * Las diferencias de la ficha técnica, fila por fila. Va una fila si alguno
 * de los dos tiene el dato (el otro dice "sin dato"); el lápiz, solo si
 * alguno lo trae.
 */
export function specRows(a: ModelDef, b: ModelDef): SpecRow[] {
  const xa = MODEL_SPECS[a.slug]?.attrs ?? {};
  const xb = MODEL_SPECS[b.slug]?.attrs ?? {};
  return SPEC_ROWS.map((row) => ({ label: row.label, a: row.value(xa), b: row.value(xb) })).filter(
    (row) => (row.a !== null || row.b !== null) && !(row.label === 'Lápiz incluido' && row.a !== 'Sí' && row.b !== 'Sí'),
  );
}
