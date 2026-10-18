/**
 * El nombre del producto en redes: historias, publicaciones, videos,
 * YouTube y Telegram.
 *
 * El nombre de Mercado Libre a veces parte con un código o con una medida
 * ("FA607NUQ-RL060W AMD Ryzen 7…", "55\" Crystal UHD U8500H…", "1d/2d/qr
 * Omnidireccional Lector…") y en una historia no dice qué es. El dueño pidió
 * (18-10-2026) que en esos casos el nombre diga tipo, marca y modelo:
 * "Notebook Asus Gaming A16 AMD Ryzen 7 16GB 512GB". El modelo sale de las
 * especificaciones de Mercado Libre ("Modelo"), solo si se lee como nombre.
 *
 * Un nombre que ya parte con una palabra ("Parlante JBL…", "Tv Box…") o con
 * la marca ("TP-Link Router…") se deja como está: la regla solo arregla lo
 * que no se entiende. Tampoco los que parten con una cantidad ("2 Pack
 * Radios…", "10 Tubos Led…"), que se leen bien.
 *
 * Sin I/O ni imports del servidor: lo usan el admin, las piezas y el cron.
 */
import { domainLabel } from '@/lib/product-types';
import { normalizeName, reelProductName, shortProductName } from '@/lib/text';

/** El largo de siempre de un nombre corto en redes. */
export const SOCIAL_NAME_MAX = 55;

/**
 * El tipo en singular, para empezar el nombre. Los tipos que no están (los
 * ambiguos, como "Ampolletas", que también reúne tubos LED, o "Streaming")
 * no se anteponen: mejor el nombre tal cual que un tipo equivocado.
 */
const TYPE_SINGULAR: Record<string, string> = {
  Audífonos: 'Audífonos',
  Parlantes: 'Parlante',
  'Home theater': 'Home theater',
  Micrófonos: 'Micrófono',
  'Parlantes inteligentes': 'Parlante inteligente',
  Radios: 'Radio',
  Celulares: 'Celular',
  'Teléfonos fijos': 'Teléfono',
  'Soportes para auto': 'Soporte para auto',
  Notebooks: 'Notebook',
  Monitores: 'Monitor',
  Teclados: 'Teclado',
  Mouse: 'Mouse',
  'Impresoras 3D': 'Impresora 3D',
  'Filamentos 3D': 'Filamento 3D',
  'Tarjetas de memoria': 'Tarjeta de memoria',
  Tablets: 'Tablet',
  'Discos y SSD': 'Disco',
  Pendrives: 'Pendrive',
  Routers: 'Router',
  Impresoras: 'Impresora',
  Tintas: 'Tinta',
  'Cámaras web': 'Cámara web',
  'Memorias RAM': 'Memoria RAM',
  'Hubs USB': 'Hub USB',
  'UPS y estabilizadores': 'UPS',
  'Capturadoras de video': 'Capturadora de video',
  'Pasta térmica': 'Pasta térmica',
  'Carcasas para discos': 'Carcasa para disco',
  'Cables de red': 'Cable de red',
  'Switches de red': 'Switch de red',
  'Tarjetas de red': 'Tarjeta de red',
  'Lectores de código de barras': 'Lector de código de barras',
  Smartwatch: 'Smartwatch',
  Televisores: 'Smart TV',
  Cargadores: 'Cargador',
  Proyectores: 'Proyector',
  Drones: 'Drone',
  Cámaras: 'Cámara',
  'Cámaras de seguridad': 'Cámara de seguridad',
  'Lectores de e-books': 'Lector de e-books',
  Correas: 'Correa',
  'Cargadores de smartwatch': 'Cargador de smartwatch',
  Localizadores: 'Localizador',
  'Soportes para TV': 'Soporte para TV',
  'Antenas de TV': 'Antena de TV',
  'Controles remotos': 'Control remoto',
  'Walkie talkies': 'Walkie talkie',
  'Cargadores de pilas': 'Cargador de pilas',
  'Luces para foto y video': 'Luz para foto y video',
  Trípodes: 'Trípode',
  Timbres: 'Timbre',
  Consolas: 'Consola',
  Controles: 'Control',
  Juegos: 'Juego',
  Sillas: 'Silla',
  Escritorios: 'Escritorio',
  'Tiras LED': 'Tira LED',
  'Racks de TV': 'Rack de TV',
  'Lámparas de escritorio': 'Lámpara de escritorio',
  Microondas: 'Microondas',
  Refrigeradores: 'Refrigerador',
  Congeladores: 'Congelador',
  Lavadoras: 'Lavadora',
  Aspiradoras: 'Aspiradora',
  Hervidores: 'Hervidor',
  Ventiladores: 'Ventilador',
  Estufas: 'Estufa',
  Hornos: 'Horno',
  Encimeras: 'Encimera',
  Cocinas: 'Cocina',
  Campanas: 'Campana',
  'Dispensadores de agua': 'Dispensador de agua',
  'Calefonts y termos': 'Calefont',
  'Afeitadoras y cortapelos': 'Afeitadora',
};

/** Marcas que Mercado Libre acepta y que no son una marca. */
const GENERIC_BRANDS = new Set(['generica', 'generico', 'generic', 'oem', 'sin marca', 'otra marca', 'otras marcas']);
/** "Modelo" de Mercado Libre que no dice nada. */
const GENERIC_MODELS = new Set(['general', 'standard', 'estandar', 'generico', 'generica', 'basico', 'basica']);

export interface NamedProduct {
  name: string;
  brand?: string | null;
  ml_domain_id?: string | null;
  specs?: Record<string, unknown> | null;
}

const fold = (text: string) => normalizeName(text);

/** ¿Se lee como palabra? Letras, con guion o barra entre ellas: "Parlante", "Tv", "E-reader", "Lavadora/secadora". */
function isWord(token: string): boolean {
  return /^\p{L}+(?:[-/]\p{L}+)*[,.:;]?$/u.test(token) && (token.match(/\p{L}/gu) ?? []).length >= 2;
}

/** ¿Parte con un código de modelo ("FA607NUQ-RL060W")? */
export function startsWithCode(name: string): boolean {
  const first = name.trim().split(/\s+/)[0] || '';
  return first.length >= 6 && /[a-z]/i.test(first) && /\d{2,}/.test(first);
}

/** ¿Parte con una cantidad que se lee bien ("2 Pack…", "10 Tubos…")? */
function startsWithCount(tokens: string[]): boolean {
  if (!/^\d+$/.test(tokens[0] ?? '')) return false;
  const next = fold(tokens[1] ?? '');
  return ['pack', 'kit', 'set', 'combo'].includes(next) || /^[a-z]{3,}s$/.test(next);
}

/** La marca como se muestra: sin las genéricas ni las mal cargadas; "ASUS" pasa a "Asus" (las de tres letras quedan: LG, JBL). */
function displayBrand(brand: string | null | undefined): string | null {
  const raw = brand?.trim();
  if (!raw) return null;
  const key = fold(raw);
  if (!key || GENERIC_BRANDS.has(key) || key.split(' ').length > 3 || raw.length > 20) return null;
  if (raw === raw.toUpperCase() && /^[A-Z]{4,}$/.test(raw)) return raw.charAt(0) + raw.slice(1).toLowerCase();
  return raw;
}

/** El "Modelo" de Mercado Libre, si se lee como nombre ("Gaming A16"; no "UN55U8500H" ni "General"). */
function readableModel(specs: Record<string, unknown> | null | undefined, name: string): string | null {
  const model = specs?.Modelo;
  if (typeof model !== 'string') return null;
  const text = model.trim().replace(/\s+/g, ' ');
  if (!text || text.length > 25 || GENERIC_MODELS.has(fold(text))) return null;
  if (!/\p{L}{4,}/u.test(text) || ` ${fold(name)} `.includes(` ${fold(text)} `)) return null;
  return text;
}

/** Saca la primera vez que aparece la frase (palabra por palabra, sin tildes ni mayúsculas). */
function withoutPhrase(tokens: string[], phrase: string): string[] {
  const words = fold(phrase).split(' ');
  for (let i = 0; i + words.length <= tokens.length; i++) {
    if (words.every((w, j) => fold(tokens[i + j]) === w)) return [...tokens.slice(0, i), ...tokens.slice(i + words.length)];
  }
  return tokens;
}

/**
 * El nombre para redes, de `max` caracteres o menos. `withBrand: false`
 * cuando la pieza ya muestra la marca aparte (la historia la lleva arriba
 * del nombre).
 */
export function socialProductName(
  product: NamedProduct,
  { max = SOCIAL_NAME_MAX, withBrand = true }: { max?: number; withBrand?: boolean } = {},
): string {
  // Lo de siempre en redes: sin color, sin "Distribuidor Autorizado" y sin
  // códigos largos de fábrica en el medio. Basura al comienzo ("!!! ", un "Y" suelto) fuera.
  const base = reelProductName(product.name, 400)
    .replace(/^[^\p{L}\p{N}"']+/u, '')
    .replace(/^(?:y|e|o|de|con|para)\s+/i, '');
  const tokens = base.split(' ').filter(Boolean);
  const first = tokens[0] ?? '';
  const brand = displayBrand(product.brand);

  const readable =
    isWord(first) || (brand !== null && fold(first).replace(/ /g, '').includes(fold(brand).replace(/ /g, ''))) || startsWithCount(tokens);
  const type = TYPE_SINGULAR[domainLabel(product.ml_domain_id)];
  if (readable || !type) return shortProductName(base || product.name, max);

  let rest = tokens;
  let model: string | null = null;
  if (startsWithCode(first)) {
    rest = tokens.slice(1);
    model = readableModel(product.specs, base);
  }
  // Lo que va adelante no se repite más atrás ("…Vision AI Smart TV").
  rest = withoutPhrase(rest, type);
  if (brand) rest = withoutPhrase(rest, brand);
  const parts = [type, withBrand ? brand : null, model, ...rest].filter((p): p is string => Boolean(p));
  return shortProductName(parts.join(' '), max);
}

/** ¿El nombre parte con un código y la regla no lo puede arreglar (sin tipo conocido)? Para avisarle al dueño. */
export function nameNeedsHelp(product: NamedProduct): boolean {
  if (!startsWithCode(product.name)) return false;
  return socialProductName(product).split(' ')[0] === product.name.trim().split(/\s+/)[0];
}
