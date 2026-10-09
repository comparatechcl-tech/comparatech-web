/**
 * Orden, filtros por tipo y textos de las páginas de categoría.
 *
 * Sin I/O a propósito: se prueba con datos fijos y la página solo arma la
 * vista. Los textos salen de los datos del catálogo, no de una plantilla
 * escrita a mano: así no quedan desactualizados cuando cambian los precios.
 */
import type { Product } from '@/lib/types';
import { formatCLP } from '@/lib/format';
import { stripDiacritics } from '@/lib/text';
import { discountPercent, MIN_DEAL_DISCOUNT } from '@/lib/queries/products';

// Los valores van en ?orden= y no se cambian (hay links publicados); el
// rótulo dice lo que el orden hace de verdad: 'relevancia' es lo agregado
// más recientemente y 'vendidos' son las ventas totales del vendedor, no
// las del producto.
export const SORT_OPTIONS = [
  { value: 'relevancia', label: 'Más recientes' },
  { value: 'descuento', label: 'Mayor descuento' },
  { value: 'precio', label: 'Menor precio' },
  { value: 'vendidos', label: 'Vendedor con más ventas' },
] as const;

export type SortOrder = (typeof SORT_OPTIONS)[number]['value'];

/** ?orden= desconocido o vacío cae a relevancia, nunca a un error. */
export function parseSortOrder(value: string | string[] | undefined): SortOrder {
  const v = Array.isArray(value) ? value[0] : value;
  return SORT_OPTIONS.some((o) => o.value === v) ? (v as SortOrder) : 'relevancia';
}

/**
 * Ordena sin mutar. 'relevancia' es el orden en que llega el catálogo (lo
 * más nuevo primero), el mismo que tenía la página antes de los chips.
 * Los empates conservan ese orden.
 */
export function sortProducts(products: Product[], order: SortOrder): Product[] {
  const list = [...products];
  switch (order) {
    case 'descuento':
      return list.sort((a, b) => discountPercent(b) - discountPercent(a) || a.price - b.price);
    case 'precio':
      return list.sort((a, b) => a.price - b.price);
    case 'vendidos':
      return list.sort((a, b) => (b.seller_sales_count ?? 0) - (a.seller_sales_count ?? 0));
    default:
      return list;
  }
}

/**
 * Cuántos productos muestra una categoría de entrada, y cuántos suma cada
 * "ver más". La búsqueda (/buscar) usa la misma tanda.
 */
export const CATEGORY_PAGE = 48;

/**
 * ?pagina= dice cuántas tandas se muestran, no cuál: la 2 trae las dos
 * primeras. Así "ver más" agrega productos debajo de los que ya se estaban
 * viendo, y cualquier valor es la misma lista de la dirección sin
 * parámetros, solo más larga. Un valor raro cae a 1, y uno más grande que la
 * categoría, a la categoría completa.
 */
export function parsePageCount(value: string | string[] | undefined, total: number): number {
  const v = Array.isArray(value) ? value[0] : value;
  if (!v || !/^\d{1,4}$/.test(v)) return 1;
  const last = Math.max(1, Math.ceil(total / CATEGORY_PAGE));
  return Math.min(Math.max(1, Number(v)), last);
}

/**
 * Nombre en castellano de cada tipo de producto de Mercado Libre. Un
 * dominio que no está acá se agrupa como 'Otros': es preferible a mostrar
 * "MLC-WIRELESS_ANTENNAS_AND_ADAPTERS" en un chip.
 */
const DOMAIN_LABELS: Record<string, string> = {
  // Audio
  'MLC-HEADPHONES': 'Audífonos',
  'MLC-SPEAKERS': 'Parlantes',
  'MLC-HOME_THEATERS': 'Home theater',
  'MLC-MICROPHONES': 'Micrófonos',
  'MLC-SMART_SPEAKERS': 'Parlantes inteligentes',
  'MLC-AM_FM_SW_RADIOS': 'Radios',
  // Celulares
  'MLC-CELLPHONES': 'Celulares',
  'MLC-TELEPHONES': 'Teléfonos fijos',
  'MLC-VEHICLE_CELLPHONE_AND_GPS_MOUNTS': 'Soportes para auto',
  // Computación
  'MLC-NOTEBOOKS': 'Notebooks',
  'MLC-COMPUTER_MONITORS': 'Monitores',
  'MLC-LAPTOP_KEYBOARDS': 'Teclados',
  'MLC-PC_KEYBOARDS': 'Teclados',
  'MLC-COMPUTER_MICE': 'Mouse',
  'MLC-3D_PRINTERS': 'Impresoras 3D',
  'MLC-3D_PRINTER_FILAMENTS': 'Filamentos 3D',
  'MLC-MEMORY_CARDS': 'Tarjetas de memoria',
  'MLC-TABLETS': 'Tablets',
  'MLC-HARD_DRIVES_AND_SSDS': 'Discos y SSD',
  'MLC-PENDRIVES': 'Pendrives',
  'MLC-ROUTERS_AND_WIRELESS_SYSTEMS': 'Routers',
  'MLC-PRINTERS': 'Impresoras',
  'MLC-PRINTER_INKS': 'Tintas',
  'MLC-WEBCAMS': 'Cámaras web',
  'MLC-RAM_MEMORY_MODULES': 'Memorias RAM',
  'MLC-USB_HUBS': 'Hubs USB',
  // Electrónica
  'MLC-SMARTWATCHES': 'Smartwatch',
  'MLC-TELEVISIONS': 'Televisores',
  'MLC-MOBILE_DEVICE_CHARGERS': 'Cargadores',
  'MLC-WIRELESS_ANTENNAS_AND_ADAPTERS': 'Antenas y adaptadores',
  'MLC-STREAMING_MEDIA_DEVICES': 'Streaming',
  'MLC-PROJECTORS': 'Proyectores',
  'MLC-DRONES': 'Drones',
  'MLC-DIGITAL_CAMERAS': 'Cámaras',
  'MLC-VIDEO_CAMERAS': 'Cámaras',
  'MLC-SURVEILLANCE_CAMERAS': 'Cámaras de seguridad',
  'MLC-E_READERS': 'Lectores de e-books',
  'MLC-SMARTWATCH_AND_WATCH_BANDS': 'Correas',
  // Gaming
  'MLC-GAME_CONSOLES': 'Consolas',
  'MLC-GAMEPADS_AND_JOYSTICKS': 'Controles',
  'MLC-VIDEO_GAMES': 'Juegos',
  // Hogar
  'MLC-OFFICE_CHAIRS': 'Sillas',
  'MLC-HOME_OFFICE_DESKS': 'Escritorios',
  'MLC-LIGHT_BULBS': 'Ampolletas',
  'MLC-LED_STRIPS': 'Tiras LED',
  // Electrodomésticos
  'MLC-MICROWAVES': 'Microondas',
  'MLC-REFRIGERATORS': 'Refrigeradores',
  'MLC-WASHING_MACHINES': 'Lavadoras',
  'MLC-VACUUM_AND_STEAM_CLEANERS': 'Aspiradoras',
  'MLC-ELECTRIC_JUGS': 'Hervidores',
  'MLC-FANS': 'Ventiladores',
  'MLC-ELECTRIC_HOME_HEATERS': 'Estufas',
};

export const OTHER_TYPE_LABEL = 'Otros';

export function domainLabel(domainId: string | null | undefined): string {
  return (domainId && DOMAIN_LABELS[domainId]) || OTHER_TYPE_LABEL;
}

/** 'Audífonos' → 'audifonos': lo que va en ?tipo=. */
export function typeSlug(label: string): string {
  return stripDiacritics(label.toLowerCase())
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export interface TypeChip {
  slug: string;
  label: string;
  count: number;
}

/**
 * Chips de tipo, de más a menos productos, con 'Otros' siempre al final.
 * Vacío si todo es de un solo tipo: un chip único no filtra nada.
 */
export function typeChips(products: Product[]): TypeChip[] {
  const chips = new Map<string, TypeChip>();
  for (const p of products) {
    const label = domainLabel(p.ml_domain_id);
    const slug = typeSlug(label);
    const chip = chips.get(slug) ?? { slug, label, count: 0 };
    chip.count += 1;
    chips.set(slug, chip);
  }
  if (chips.size < 2) return [];
  return [...chips.values()].sort(
    (a, b) =>
      Number(a.label === OTHER_TYPE_LABEL) - Number(b.label === OTHER_TYPE_LABEL) ||
      b.count - a.count ||
      a.label.localeCompare(b.label, 'es')
  );
}

/** Productos del tipo pedido. Un ?tipo= que no existe no filtra nada. */
export function filterByType(products: Product[], tipo: string | undefined): Product[] {
  if (!tipo) return products;
  const filtered = products.filter((p) => typeSlug(domainLabel(p.ml_domain_id)) === tipo);
  return filtered.length > 0 ? filtered : products;
}

/** "A", "A y B", "A, B y C". */
function joinSpanish(items: string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} y ${items[items.length - 1]}`;
}

/** Las marcas con más productos, en el orden de la marca más frecuente. */
export function topBrands(products: Product[], limit = 3): string[] {
  const counts = new Map<string, { name: string; count: number }>();
  for (const p of products) {
    const name = p.brand?.trim();
    if (!name) continue;
    const key = name.toLowerCase();
    const entry = counts.get(key) ?? { name, count: 0 };
    entry.count += 1;
    counts.set(key, entry);
  }
  return [...counts.values()]
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'es'))
    .slice(0, limit)
    .map((b) => b.name);
}

export interface CategorySummary {
  count: number;
  minPrice: number;
  maxPrice: number;
  brands: string[];
  /** Productos con MIN_DEAL_DISCOUNT % o más de descuento. */
  dealCount: number;
}

export function summarizeCategory(products: Product[]): CategorySummary {
  const prices = products.map((p) => p.price).filter((n) => Number.isFinite(n) && n > 0);
  return {
    count: products.length,
    minPrice: prices.length ? Math.min(...prices) : 0,
    maxPrice: prices.length ? Math.max(...prices) : 0,
    brands: topBrands(products),
    dealCount: products.filter((p) => discountPercent(p) >= MIN_DEAL_DISCOUNT).length,
  };
}

/**
 * Introducción de la categoría, 2 a 3 frases con datos reales. Le dice a
 * quien llega desde Google qué va a encontrar (y a Google, de qué trata la
 * página) sin inventar nada: el descuento es el que informa Mercado Libre.
 */
export function categoryIntro(summary: CategorySummary): string {
  const { count, minPrice, maxPrice, brands, dealCount } = summary;
  if (count === 0) return '';

  const what = count === 1 ? '1 producto' : `${count} productos`;
  const from = brands.length > 0 ? ` de ${joinSpanish(brands)}` : '';
  const range =
    minPrice === maxPrice
      ? `; a ${formatCLP(minPrice)}`
      : `; desde ${formatCLP(minPrice)} hasta ${formatCLP(maxPrice)}`;

  const deals =
    dealCount === 0
      ? `Hoy ninguno tiene ${MIN_DEAL_DISCOUNT}% o más de descuento informado por Mercado Libre.`
      : dealCount === 1
        ? `Hoy 1 tiene ${MIN_DEAL_DISCOUNT}% o más de descuento informado por Mercado Libre.`
        : `Hoy ${dealCount} tienen ${MIN_DEAL_DISCOUNT}% o más de descuento informado por Mercado Libre.`;

  return `Comparamos ${what}${from}${range}. ${deals}`;
}

/** Meta description: conteo y rango de precios, que es lo que se busca. */
export function categoryMetaDescription(name: string, summary: CategorySummary): string {
  const { count, minPrice, maxPrice } = summary;
  const range =
    minPrice === maxPrice
      ? `a ${formatCLP(minPrice)}`
      : `desde ${formatCLP(minPrice)} hasta ${formatCLP(maxPrice)}`;
  return `Compara ${count} ${count === 1 ? 'producto' : 'productos'} de ${name.toLowerCase()} en Chile, ${range}. Precios de Mercado Libre revisados varias veces al día.`;
}

/**
 * ItemList de schema.org de la categoría, ya serializado.
 *
 * Lleva las fichas de la primera tanda, que son las que muestra la página
 * sin parámetros (la canónica); `numberOfItems` dice cuántas tiene la
 * categoría entera, que es como schema.org describe una lista que no cabe
 * en una página. Con todas las fichas, el bloque crecía con el catálogo.
 *
 * Se escapa '<' para que un nombre con "</script>" no pueda cerrar la
 * etiqueta en que se inserta.
 */
export function itemListJsonLd(products: Product[], siteUrl: string, name: string): string {
  const data = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name,
    numberOfItems: products.length,
    itemListElement: products.slice(0, CATEGORY_PAGE).map((p, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      url: `${siteUrl}/producto/${p.slug}`,
      name: p.name,
    })),
  };
  return JSON.stringify(data).replace(/</g, '\\u003c');
}
