/**
 * Qué pegó el dueño en "Agregar desde Mercado Libre" (/admin/candidatos/agregar): links
 * de fichas de catálogo, de publicaciones de un vendedor, links cortos o
 * códigos sueltos, solos o metidos en un texto ("Mira este producto: …").
 *
 * El sitio trabaja con fichas de catálogo (/p/MLC…): el precio es el del
 * ganador de la caja de compra de la ficha. Una publicación suelta
 * (articulo.mercadolibre.cl/MLC-…) no dice a qué ficha pertenece: /items
 * responde 403 a la app desde antes del 14-10-2026. Y un link corto
 * (meli.la, mercadolibre.com/sec) no se abre: cada apertura cuenta como un
 * clic de afiliado.
 *
 * Sin imports a propósito: se prueba solo.
 */

export type MlInput =
  /** Ficha de catálogo (…/p/MLC123). */
  | { kind: 'ficha'; id: string; raw: string }
  /** Un código suelto (MLC123): puede ser una ficha o una publicación; se sabe al consultarlo. */
  | { kind: 'codigo'; id: string; raw: string }
  /**
   * Publicación de un vendedor (articulo.mercadolibre.cl/MLC-123-titulo-_JM o
   * …/titulo/up/MLCU123). `words` es el título que trae la dirección, para
   * buscar la ficha parecida.
   */
  | { kind: 'publicacion'; id: string; words: string; raw: string }
  /** Link corto (meli.la, mercadolibre.com/sec/…): abrirlo contaría como clic de afiliado. */
  | { kind: 'corto'; raw: string }
  /** No es de Mercado Libre Chile, o no se entiende a qué producto lleva. */
  | { kind: 'otro'; raw: string };

const URL_RE = /https?:\/\/[^\s<>"'()[\]{}]+/gi;
/** Códigos sueltos: MLC123456 o MLC-123456 (como aparecen en las publicaciones). */
const CODE_RE = /\bMLC-?\d{5,15}\b/gi;
const CATALOG_PATH_RE = /\/p\/(MLC\d{5,15})(?:[/?#]|$)/i;
const ITEM_PATH_RE = /\/(MLC)-?(\d{5,15})(?:-([^/?#]*))?/i;
const USER_PRODUCT_RE = /\/up\/(MLCU\d{5,15})(?:[/?#]|$)/i;

/** Lo que un link puede traer pegado al final cuando viene dentro de una frase. */
function trimPunctuation(url: string): string {
  return url.replace(/[.,;:!?…]+$/, '');
}

/** "parlante-jbl-charge-5-_JM" → "parlante jbl charge 5". */
function slugWords(slug: string | undefined): string {
  if (!slug) return '';
  let text = slug;
  try {
    text = decodeURIComponent(slug);
  } catch {
    // Un % suelto: se usa tal cual.
  }
  return text
    .replace(/_JM$/i, '')
    .replace(/[-_+]+/g, ' ')
    .replace(/[^\p{L}\p{N} ]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .slice(0, 10)
    .join(' ');
}

function isShortLink(url: URL): boolean {
  const host = url.hostname.toLowerCase();
  if (host === 'meli.la') return url.pathname.length > 1;
  return (host === 'mercadolibre.com' || host === 'www.mercadolibre.com') && url.pathname.startsWith('/sec/');
}

function isChileHost(host: string): boolean {
  const h = host.toLowerCase();
  return h === 'mercadolibre.cl' || h.endsWith('.mercadolibre.cl');
}

function fromUrl(raw: string): MlInput {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { kind: 'otro', raw };
  }
  if (isShortLink(url)) return { kind: 'corto', raw };
  if (!isChileHost(url.hostname)) return { kind: 'otro', raw };

  const catalog = CATALOG_PATH_RE.exec(url.pathname);
  if (catalog) return { kind: 'ficha', id: catalog[1].toUpperCase(), raw };

  const userProduct = USER_PRODUCT_RE.exec(url.pathname);
  if (userProduct) {
    const before = url.pathname.slice(0, userProduct.index).split('/').filter(Boolean).pop();
    return { kind: 'publicacion', id: userProduct[1].toUpperCase(), words: slugWords(before), raw };
  }

  const item = ITEM_PATH_RE.exec(url.pathname);
  if (item) return { kind: 'publicacion', id: `MLC${item[2]}`, words: slugWords(item[3]), raw };

  return { kind: 'otro', raw };
}

/**
 * El link de afiliado para compartir una publicación que el sitio no puede
 * agregar (no se sabe a qué ficha pertenece): la misma dirección, con
 * matt_word y matt_tool, como hace el generador de links de Mercado Libre con
 * cualquier producto. Se queda solo `pdp_filters` (elige la publicación de
 * ese vendedor dentro de /up/…); se van el seguimiento de quien compartió
 * (otro matt_tool, ua, sid) y lo que va después de #. null si no es un link
 * de un producto de Mercado Libre Chile, o si faltan matt_word o matt_tool.
 */
export function shareAffiliateUrl(raw: string, params: { word: string | null; tool: string | null }): string | null {
  if (!params.word || !params.tool) return null;
  let url: URL;
  try {
    url = new URL(trimPunctuation(raw));
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (isShortLink(url) || !isChileHost(url.hostname)) return null;
  if (!USER_PRODUCT_RE.test(url.pathname) && !ITEM_PATH_RE.test(url.pathname) && !CATALOG_PATH_RE.test(url.pathname)) return null;
  const clean = new URL(`https://${url.hostname.toLowerCase()}${url.pathname}`);
  const filters = url.searchParams.get('pdp_filters');
  if (filters) clean.searchParams.set('pdp_filters', filters);
  clean.searchParams.set('matt_word', params.word);
  clean.searchParams.set('matt_tool', params.tool);
  return clean.toString();
}

function keyOf(input: MlInput): string {
  return 'id' in input ? input.id : input.raw;
}

/**
 * Lo pegado, en el orden en que aparece y sin repetir: primero se leen los
 * links y después los códigos sueltos que quedan en el resto del texto.
 */
export function parseMlInput(text: string): MlInput[] {
  const found: MlInput[] = [];
  const rest = text.replace(URL_RE, (match) => {
    found.push(fromUrl(trimPunctuation(match)));
    return ' ';
  });
  for (const match of rest.match(CODE_RE) ?? []) {
    const id = match.toUpperCase().replace('-', '');
    // Con guion es el formato de las publicaciones (MLC-123): una ficha nunca lo lleva.
    found.push(match.includes('-') ? { kind: 'publicacion', id, words: '', raw: match } : { kind: 'codigo', id, raw: match });
  }

  const seen = new Set<string>();
  return found.filter((input) => {
    const key = keyOf(input);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
