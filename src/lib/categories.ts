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
 * vuelven solos a ser analizados. Cada dominio necesita además su nombre en
 * castellano en lib/product-types: sin él, sus productos se muestran como
 * 'Otros' en los filtros de la categoría y en el comparador.
 */
const DOMAIN_TO_CATEGORY: Record<string, string> = {
  // Audio
  'MLC-HEADPHONES': 'audio',
  'MLC-SPEAKERS': 'audio',
  'MLC-HOME_THEATERS': 'audio',
  'MLC-MICROPHONES': 'audio',
  'MLC-SMART_SPEAKERS': 'audio',
  'MLC-AM_FM_SW_RADIOS': 'audio',

  // Celulares
  'MLC-CELLPHONES': 'celulares',
  'MLC-TELEPHONES': 'celulares',
  'MLC-VEHICLE_CELLPHONE_AND_GPS_MOUNTS': 'celulares',

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
  'MLC-DATA_CABLES_AND_ADAPTERS': 'computacion',
  'MLC-PRINTERS': 'computacion',
  'MLC-PRINTER_INKS': 'computacion',
  'MLC-WEBCAMS': 'computacion',
  'MLC-RAM_MEMORY_MODULES': 'computacion',
  'MLC-PC_THERMAL_COMPOUND_PASTES': 'computacion',
  'MLC-DESKTOP_COMPUTER_COOLERS_AND_FANS': 'computacion',
  'MLC-HARD_DRIVES_AND_SSDS_ENCLOSURES': 'computacion',
  'MLC-NETWORK_CABLES': 'computacion',
  'MLC-NETWORK_SWITCHES': 'computacion',
  'MLC-NETWORK_CARDS': 'computacion',
  'MLC-BAR_CODE_SCANNERS': 'computacion',

  // Electrónica
  'MLC-SMARTWATCHES': 'electronica',
  'MLC-TELEVISIONS': 'electronica',
  'MLC-MOBILE_DEVICE_CHARGERS': 'electronica',
  'MLC-WIRELESS_ANTENNAS_AND_ADAPTERS': 'electronica',
  'MLC-STREAMING_MEDIA_DEVICES': 'electronica',
  'MLC-PROJECTORS': 'electronica',
  'MLC-DRONES': 'electronica',
  'MLC-VIDEO_CAMERAS': 'electronica',
  'MLC-DIGITAL_CAMERAS': 'electronica',
  'MLC-SURVEILLANCE_CAMERAS': 'electronica',
  'MLC-E_READERS': 'electronica',
  'MLC-OBJECT_FINDERS': 'electronica',
  'MLC-SMARTWATCH_AND_WATCH_BANDS': 'electronica',
  'MLC-SMARTWATCH_CHARGERS': 'electronica',
  'MLC-AUDIO_AND_VIDEO_CABLES_AND_ADAPTERS': 'electronica',
  'MLC-TV_AND_MONITOR_STANDS_AND_WALL_HANGERS': 'electronica',
  'MLC-TV_ANTENNAS': 'electronica',
  'MLC-TV_REMOTE_CONTROLS': 'electronica',
  'MLC-WALKIE_TALKIES': 'electronica',
  'MLC-CELL_BATTERIES': 'electronica',
  'MLC-BATTERY_AND_CELL_BATTERIES_CHARGERS': 'electronica',
  'MLC-CONTINUOUS_LIGHTING': 'electronica',
  'MLC-CAMERA_TRIPODS': 'electronica',
  'MLC-DOORBELLS': 'electronica',

  // Gaming
  'MLC-GAME_CONSOLES': 'gaming',
  'MLC-GAMEPADS_AND_JOYSTICKS': 'gaming',
  'MLC-VIDEO_GAMES': 'gaming',

  // Hogar: lo que acompaña a la tecnología en la casa. Lo decorativo, la
  // ropa de cama o el aseo quedan fuera a propósito: no es de lo que trata
  // el sitio.
  //
  // Hogar y Muebles (MLC1574) paga 11% de comisión y Tecnología 7% (ver
  // lib/commission): a igual precio, cada venta deja bastante más. Evidencia
  // de la raíz, verificada con GET /categories/{id} (octubre 2026), a partir
  // de la categoría que devuelve domain_discovery para cada dominio:
  //   OFFICE_CHAIRS      MLC440271 Sillas de Oficina → MLC1574 > Muebles para el Hogar
  //   HOME_OFFICE_DESKS  MLC174439 Escritorios       → MLC1574 > Muebles para el Hogar
  //   TV_STORAGE_UNITS   MLC160851 Racks             → MLC1574 > Muebles para el Hogar
  //   LIGHT_BULBS        MLC163740 Ampolletas        → MLC1574 > Iluminación para el Hogar
  //                      (incluye las ampolletas inteligentes wifi)
  //   LED_STRIPS         MLC163822 Cintas LED        → MLC1574 > Iluminación para el Hogar
  'MLC-OFFICE_CHAIRS': 'hogar',
  'MLC-HOME_OFFICE_DESKS': 'hogar',
  'MLC-TV_STORAGE_UNITS': 'hogar',
  'MLC-LIGHT_BULBS': 'hogar',
  'MLC-LED_STRIPS': 'hogar',
  'MLC-EMERGENCY_LIGHTS': 'hogar',
  // Lámparas de escritorio, incluidas las LED y las barras de luz para
  // monitor. MLC163820 Lámparas de Mesa → MLC1574 > Iluminación para el
  // Hogar > Lámparas. Ojo: el mismo dominio también cubre MLC175553
  // "Lamparas Portátiles", que cuelga de Computación (MLC1648, 7%); la
  // comisión de cada candidato se calcula con la raíz real de su ganador,
  // así que esos se estiman a la tasa que corresponde.
  'MLC-TABLE_AND_DESK_LAMPS': 'hogar',
  // No se agregaron, aunque su raíz es MLC1574: lámparas de pie
  // (MLC-FLOOR_LAMPS, MLC1585) y de techo/pared: son decoración, no
  // tecnología. Tampoco MLC-LED_STAGE_LIGHTS: su raíz es Electrónica
  // (MLC1000), no Hogar.

  // Electrodomésticos
  'MLC-MICROWAVES': 'electrodomesticos',
  'MLC-REFRIGERATORS': 'electrodomesticos',
  'MLC-FREEZERS': 'electrodomesticos',
  'MLC-WASHING_MACHINES': 'electrodomesticos',
  'MLC-VACUUM_AND_STEAM_CLEANERS': 'electrodomesticos',
  'MLC-ELECTRIC_JUGS': 'electrodomesticos',
  'MLC-OVENS': 'electrodomesticos',
  'MLC-COOKTOPS': 'electrodomesticos',
  'MLC-RANGES': 'electrodomesticos',
  'MLC-KITCHEN_RANGE_HOODS': 'electrodomesticos',
  'MLC-WATER_DISPENSERS': 'electrodomesticos',
  'MLC-WATER_HEATERS': 'electrodomesticos',
  'MLC-FANS': 'electrodomesticos',
  'MLC-ELECTRIC_HOME_HEATERS': 'electrodomesticos',
  'MLC-HAIR_CLIPPERS_ELECTRIC_SHAVERS_AND_HAIR_TRIMMERS': 'electrodomesticos',
};

/** Categoría del sitio para un dominio de ML, o null si no está mapeado. */
export function categoryFromDomain(domainId: string | null | undefined): string | null {
  if (!domainId) return null;
  return DOMAIN_TO_CATEGORY[domainId] ?? null;
}

/** Los dominios de ML que el sitio acepta. */
export function getAcceptedDomains(): string[] {
  return Object.keys(DOMAIN_TO_CATEGORY);
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
