import { CategoryInfo } from '@/lib/types';

/**
 * Registro de categorías del sitio, en el orden en que se muestran.
 *
 * Estar acá no significa aparecer en el sitio: el menú, las tarjetas del
 * home, el footer y el sitemap muestran solo las categorías que tienen
 * productos publicados (ver getPopulatedCategories). Antes eran listas fijas
 * y el resultado era "Electrónica" destacada en el home sin un solo producto
 * adentro, mientras tres pares de audífonos vivían en "Celulares".
 *
 * Así, una categoría vacía desaparece sola y vuelve sola cuando llega su
 * primer producto — no hay que tocar código para sumar contenido.
 */
export const CATEGORIES: CategoryInfo[] = [
  { slug: 'celulares', name: 'Celulares' },
  { slug: 'computacion', name: 'Computación' },
  { slug: 'audio', name: 'Audio' },
  { slug: 'gaming', name: 'Gaming' },
  { slug: 'electronica', name: 'Electrónica' },
  { slug: 'hogar', name: 'Hogar' },
  { slug: 'electrodomesticos', name: 'Electrodomésticos' },
];

/**
 * Dominio de Mercado Libre → categoría del sitio.
 *
 * El `domain_id` que devuelve /products/{id} identifica el tipo exacto de
 * producto ("MLC-HEADPHONES"), a diferencia de la categoría que manda Make,
 * que viene del bloque de destacados y es demasiado gruesa: por eso los
 * audífonos entraban como "celulares" y una silla gamer como "computación".
 *
 * Hace de lista blanca de la prospección: lo que no está acá no llega a la
 * cola de revisión. Los identificadores salen del domain_discovery de ML o
 * del reporte de dominios descartados que devuelve el cron de prospección.
 * Al sumar uno, los productos que se habían descartado por ese dominio
 * vuelven solos a ser analizados.
 */
const DOMAIN_TO_CATEGORY: Record<string, string> = {
  // Audio
  'MLC-HEADPHONES': 'audio',
  'MLC-SPEAKERS': 'audio',
  'MLC-HOME_THEATERS': 'audio',

  // Celulares
  'MLC-CELLPHONES': 'celulares',

  // Computación
  'MLC-NOTEBOOKS': 'computacion',
  'MLC-COMPUTER_MONITORS': 'computacion',
  'MLC-LAPTOP_KEYBOARDS': 'computacion',
  'MLC-COMPUTER_MICE': 'computacion',
  'MLC-3D_PRINTERS': 'computacion',
  'MLC-3D_PRINTER_FILAMENTS': 'computacion',
  'MLC-MEMORY_CARDS': 'computacion',
  'MLC-TABLETS': 'computacion',
  // Teclados de escritorio: hasta ahora solo estaban los de notebook, así
  // que todos los teclados gamer se descartaban.
  'MLC-PC_KEYBOARDS': 'computacion',
  'MLC-HARD_DRIVES_AND_SSDS': 'computacion',
  'MLC-PENDRIVES': 'computacion',
  'MLC-ROUTERS_AND_WIRELESS_SYSTEMS': 'computacion',
  'MLC-VIDEO_CAPTURE_DEVICES': 'computacion',
  'MLC-STABILIZERS_AND_UPS': 'computacion',
  'MLC-USB_HUBS': 'computacion',

  // Electrónica
  'MLC-SMARTWATCHES': 'electronica',
  'MLC-TELEVISIONS': 'electronica',
  'MLC-MOBILE_DEVICE_CHARGERS': 'electronica',
  'MLC-WIRELESS_ANTENNAS_AND_ADAPTERS': 'electronica',
  'MLC-STREAMING_MEDIA_DEVICES': 'electronica',
  'MLC-PROJECTORS': 'electronica',
  'MLC-DRONES': 'electronica',
  'MLC-VIDEO_CAMERAS': 'electronica',

  // Gaming
  'MLC-GAME_CONSOLES': 'gaming',
  'MLC-GAMEPADS_AND_JOYSTICKS': 'gaming',

  // Hogar
  'MLC-OFFICE_CHAIRS': 'hogar',
  'MLC-HOME_OFFICE_DESKS': 'hogar',

  // Electrodomésticos
  'MLC-MICROWAVES': 'electrodomesticos',
  'MLC-REFRIGERATORS': 'electrodomesticos',
  'MLC-WASHING_MACHINES': 'electrodomesticos',
  'MLC-VACUUM_AND_STEAM_CLEANERS': 'electrodomesticos',
  'MLC-ELECTRIC_JUGS': 'electrodomesticos',
};

/** Categoría del sitio para un dominio de ML, o null si no está mapeado. */
export function categoryFromDomain(domainId: string | null | undefined): string | null {
  if (!domainId) return null;
  return DOMAIN_TO_CATEGORY[domainId] ?? null;
}

export function getAllCategories(): CategoryInfo[] {
  return CATEGORIES;
}

export function getCategoryInfo(slug: string): CategoryInfo | undefined {
  return CATEGORIES.find((c) => c.slug === slug);
}

/**
 * Las categorías que hoy tienen algo que mostrar, en el orden del registro.
 * Una categoría con productos pero fuera del registro igual aparece, con su
 * slug capitalizado como nombre, para que un tipo de producto nuevo nunca
 * quede invisible.
 */
export function getPopulatedCategories(
  products: { category: string }[]
): CategoryInfo[] {
  const counts = new Set(products.map((p) => p.category));

  const known = CATEGORIES.filter((c) => counts.has(c.slug));
  const knownSlugs = new Set(CATEGORIES.map((c) => c.slug));
  const unknown = [...counts]
    .filter((slug) => slug && !knownSlugs.has(slug))
    .sort()
    .map((slug) => ({ slug, name: slug.charAt(0).toUpperCase() + slug.slice(1) }));

  return [...known, ...unknown];
}
