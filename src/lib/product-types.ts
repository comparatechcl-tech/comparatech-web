/**
 * Tipos de producto: el nombre en castellano de cada dominio de Mercado
 * Libre y su forma para una dirección (?tipo=).
 *
 * Sin imports del servidor: lo usan las páginas de categoría y el
 * comparador, que es un componente de cliente.
 */
import { stripDiacritics } from '@/lib/text';

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
