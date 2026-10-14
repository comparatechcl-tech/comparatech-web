import 'server-only';
import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { chileDateKey, shiftDateKey } from '@/lib/clicks';
import { buildVideoTexts, captionDiscount, mlPhotoJpg, type VideoTexts } from '@/lib/content/captions';
import { resolveOutboundUrl } from '@/lib/outbound';
import { readAffiliateSettings } from '@/lib/settings';
import { isMissingSchemaError } from '@/lib/supabase/errors';
import { reelProductName } from '@/lib/text';
import { addInterestSignals, countUnreadHistory, readInterestEvidence, readSocialEvidence } from '@/lib/social/drops';
import { interestScore, type InterestEvidence } from '@/lib/social/interest';
import { NETWORK_RULES, VIDEO_MARK } from '@/lib/social/networks';
import {
  evidenceDrop,
  isOnSale,
  pickByRules,
  readFreshSocialProducts,
  selectSocialProducts,
  type PickRules,
  type SocialProduct,
  type TelegramPick,
} from '@/lib/social/telegram';

/**
 * Videos cortos de oferta (reels) que se suben a mano desde /admin/videos.
 *
 * Con las cuentas partiendo de cero, el video corto es lo único que las
 * plataformas le muestran a quien todavía no sigue la cuenta. El video no lo
 * arma el sitio: un generador que corre fuera le pide a
 * /api/social/videos/plan qué productos van hoy, arma cada MP4 con su portada
 * y los deja en el almacén. El sitio hace el resto:
 *
 *  - elige (readVideoPicks): la misma puerta de entrada y el mismo puntaje de
 *    interés que las demás redes, con las señales de más vendidos y de clics;
 *  - guarda: bucket público "reels" de Supabase Storage. El nombre de cada
 *    archivo lleva el día, el producto, el PRECIO con que se armó y una
 *    HUELLA de lo demás que el video lleva escrito (precio de lista,
 *    descuento, baja, envío gratis…), así un video que ya no dice lo mismo
 *    que el sitio se reconoce sin abrirlo;
 *  - muestra (readVideoBoard): lo que está listo para subir, con el texto de
 *    cada red, y a qué redes ya se subió. Solo los videos cuyo nombre es el
 *    que saldría ahora mismo para ese producto.
 *
 * Los videos llevan su propia cuenta de "ya subido", aparte del plan de
 * publicaciones y de las historias: una fila en social_posts por red, con
 * VIDEO_MARK en `caption`.
 */

export { VIDEO_MARK };
export type { VideoTexts };

export const VIDEO_NETWORKS = ['instagram', 'tiktok', 'youtube', 'facebook'] as const;
export type VideoNetwork = (typeof VIDEO_NETWORKS)[number];

export const VIDEO_RULES: PickRules & { repeatAfterDays: number } = {
  // Lo mismo que el plan de publicaciones: 20% por debajo del precio de lista
  // o una baja confirmada, precio revisado hace 6 horas o menos, y nada que
  // traiga un aviso en el puntaje. El video se arma sin que nadie mire el
  // producto, y una vez subido no se puede corregir.
  ...NETWORK_RULES,
  /** Se suben a mano, uno por uno y a cuatro redes: más que esto al día no se alcanza a subir. */
  maxPosts: 4,
};

/** Cuántos videos puede pedir el generador de una vez. */
export const VIDEO_PLAN_MAX = 6;

/** Cuántos videos se muestran para subir: más que esto en una pantalla de teléfono es una lista, no una tarea. */
export const VIDEO_BOARD_MAX = 8;

/**
 * Las plantillas que el generador sabe armar (scripts/reels/plantillas): una
 * que no esté allá no se arma, así que se agregan en los dos lados. Solo
 * letras minúsculas y números: el nombre viaja dentro del nombre del archivo.
 *
 * "estudio" ya da dos formatos según la foto del producto (alta o cuadrada,
 * como un celular; apaisada, como un televisor). Con una segunda plantilla,
 * assignVideoTemplates las reparte sola entre los videos del día.
 */
export const VIDEO_TEMPLATES = ['estudio'] as const;

/** ¿Es una plantilla que el generador arma hoy? Un video de una que se retiró ya no es el que saldría ahora. */
function isCurrentTemplate(template: string): boolean {
  return (VIDEO_TEMPLATES as readonly string[]).includes(template);
}

/** El bucket público de Supabase Storage donde quedan los videos y sus portadas. */
export const VIDEO_BUCKET = 'reels';

const DAY_MS = 86_400_000;

// ---------------------------------------------------------------------------
// Nombre de los archivos.

/** Lo que dice el nombre de un video guardado. */
export interface VideoObject {
  /** Día (hora de Chile) en que se armó, AAAA-MM-DD. */
  date: string;
  productId: string;
  /** Precio que muestra el video, en pesos. */
  price: number;
  template: string;
  /** Huella de lo demás que el video dice (videoFingerprint): 8 caracteres en hexadecimal. */
  fingerprint: string;
}

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const UUID_RE = new RegExp(`^${UUID}$`);
const TEMPLATE_RE = /^[a-z0-9]{1,24}$/;
const FINGERPRINT_RE = /^[0-9a-f]{8}$/;
// Sin ceros a la izquierda: cada precio tiene una sola forma de escribirse.
const OBJECT_RE = new RegExp(`^(\\d{4}-\\d{2}-\\d{2})/(${UUID})-([1-9]\\d{0,9})-([a-z0-9]{1,24})-([0-9a-f]{8})$`);
/** posted_price es un entero de 32 bits en la base. */
const MAX_PRICE = 2_147_483_647;

function isDateKey(key: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return false;
  const [y, m, d] = key.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  // Una fecha imposible (2026-02-31) se correría de mes.
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

/**
 * "AAAA-MM-DD/<id>-<precio>-<plantilla>-<huella>": el nombre de un video en
 * el almacén, sin extensión (el video es .mp4 y su portada .jpg). null si
 * algún dato no sirve para un nombre. Puro.
 *
 * La huella la calcula solo el sitio (videoFingerprint). El generador usa el
 * nombre tal como le llega y no la recalcula.
 */
export function videoObjectName(video: VideoObject): string | null {
  if (!isDateKey(video.date) || !UUID_RE.test(video.productId) || !TEMPLATE_RE.test(video.template)) return null;
  if (!Number.isSafeInteger(video.price) || video.price <= 0 || video.price > MAX_PRICE) return null;
  if (typeof video.fingerprint !== 'string' || !FINGERPRINT_RE.test(video.fingerprint)) return null;
  return `${video.date}/${video.productId}-${video.price}-${video.template}-${video.fingerprint}`;
}

/**
 * Lee un nombre armado por videoObjectName. Todo lo que no calce exacto se
 * rechaza (null): en el bucket puede haber cualquier cosa, y de un nombre mal
 * leído saldría un video con el precio de otro. Un nombre sin huella (los de
 * antes de que existiera) tampoco se lee: no se sabe qué dice ese video. Puro.
 */
export function parseVideoObjectName(name: string): VideoObject | null {
  const match = typeof name === 'string' ? OBJECT_RE.exec(name) : null;
  if (!match) return null;
  const price = Number(match[3]);
  if (price > MAX_PRICE || !isDateKey(match[1])) return null;
  return { date: match[1], productId: match[2], price, template: match[4], fingerprint: match[5] };
}

// ---------------------------------------------------------------------------
// Lo que el video dice.

/**
 * Lo que el video lleva escrito además del precio, con los mismos nombres y
 * valores con que la ruta del plan se lo entrega al generador (por eso van en
 * español: son los campos de esa respuesta).
 *
 * Es la única fuente de esos datos: la ruta entrega este objeto y la huella
 * del nombre del archivo se calcula sobre él. Así lo que se dibuja y lo que
 * se revisa después no pueden separarse.
 */
export interface VideoClaims {
  /** El nombre que el video lleva escrito (reelProductName): sin códigos de fábrica. */
  nombre_corto: string;
  marca: string | null;
  /** Precio de lista, solo si es mayor que el precio. */
  precio_lista: number | null;
  /** Descuento sobre el precio de lista, en % entero. 0 si no hay. */
  descuento: number;
  /** Baja comprobada con el historial propio, en % entero. null si no hay. */
  baja_historial: number | null;
  envio_gratis: boolean;
  full: boolean;
}

/**
 * Lo que diría HOY el video de un producto. `drop` es la baja que confirma
 * el historial, en % (evidenceDrop), o null. Puro.
 */
export function videoClaims(
  product: Pick<SocialProduct, 'name' | 'brand' | 'price' | 'original_price' | 'offer_info'>,
  drop: number | null
): VideoClaims {
  const discount = captionDiscount(product);
  return {
    // El nombre que va escrito en el video: sin los códigos de fábrica, que en
    // pantalla no le dicen nada a nadie (reelProductName). Los textos que se
    // pegan en cada red siguen con el nombre corto de siempre.
    nombre_corto: reelProductName(product.name),
    marca: product.brand || null,
    precio_lista: discount > 0 ? product.original_price : null,
    descuento: discount,
    baja_historial: drop === null || !Number.isFinite(drop) ? null : Math.round(drop),
    // Como booleanos: el generador escribe "Envío gratis" y "Full" solo con un sí explícito.
    envio_gratis: product.offer_info?.free_shipping === true,
    full: product.offer_info?.is_full === true,
  };
}

/**
 * La huella de lo que el video dice: los primeros 8 caracteres, en
 * hexadecimal, del SHA-256 de esos datos escritos siempre en el mismo orden.
 * Va en el nombre del archivo junto al precio. Pura.
 *
 * Sin ella, un video seguía ofreciéndose cuando al producto le cambiaban el
 * precio de lista o le quitaban el envío gratis sin tocarle el precio: el
 * video decía "-45%" y la tarjeta de al lado "-15%". Con ella, cualquier
 * cambio en lo que el video lleva escrito es otro nombre de archivo: el de
 * antes deja de mostrarse y el plan pide uno nuevo.
 *
 * El orden y la forma de escribir los datos son parte del contrato con el
 * almacén: si cambian, todos los videos guardados dejan de reconocerse.
 */
export function videoFingerprint(claims: VideoClaims): string {
  const said = [
    claims.nombre_corto,
    claims.marca ?? null,
    claims.precio_lista ?? null,
    claims.descuento,
    claims.baja_historial ?? null,
    claims.envio_gratis,
    claims.full,
  ];
  return createHash('sha256').update(JSON.stringify(said)).digest('hex').slice(0, 8);
}

/** Dirección pública de un archivo del almacén (el bucket es público). */
export function videoPublicUrl(path: string, base: string | undefined = process.env.NEXT_PUBLIC_SUPABASE_URL): string {
  return `${(base ?? '').replace(/\/+$/, '')}/storage/v1/object/public/${VIDEO_BUCKET}/${path}`;
}

// ---------------------------------------------------------------------------
// Plantillas.

/** FNV-1a de 32 bits: el mismo texto da siempre el mismo número. */
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Qué plantilla le toca a cada elegido del día, en el mismo orden. Puro.
 *
 * Con una sola plantilla es siempre esa. Con más, se reparten parejo (ninguna
 * se usa dos veces más que otra) y por cuál se empieza depende del producto y
 * del día, para que el primero de la lista no salga siempre con la misma. Un
 * producto que ya tiene su video de hoy (`already`) conserva su plantilla: si
 * cambiara entre una corrida y otra, se armaría dos veces.
 */
export function assignVideoTemplates(
  productIds: string[],
  date: string,
  already: ReadonlyMap<string, string> = new Map(),
  templates: readonly string[] = VIDEO_TEMPLATES
): string[] {
  const used = new Map<string, number>();
  for (const template of templates) used.set(template, 0);
  const count = (template: string) => used.get(template) ?? 0;

  const kept = productIds.map((id) => {
    const template = already.get(id);
    if (template === undefined || !used.has(template)) return null;
    used.set(template, count(template) + 1);
    return template;
  });

  return productIds.map((id, i) => {
    const known = kept[i];
    if (known !== null) return known;
    const start = hash(`${date}|${id}`) % templates.length;
    let choice = templates[start];
    for (let step = 1; step < templates.length; step++) {
      const other = templates[(start + step) % templates.length];
      if (count(other) < count(choice)) choice = other;
    }
    used.set(choice, count(choice) + 1);
    return choice;
  });
}

// ---------------------------------------------------------------------------
// El almacén.

/** Un reel de 10 segundos pesa unos 4 MB: con esto sobra, y un archivo equivocado no se come el espacio gratis. */
export const VIDEO_MAX_BYTES = 20 * 1024 * 1024;
export const VIDEO_MIME_TYPES = ['video/mp4', 'image/jpeg'];
/** Días que se guardan los videos. La página solo muestra los de hoy y de ayer; el resto es margen. */
export const VIDEO_KEEP_DAYS = 3;

/** Archivos por carpeta que se leen de una vez: un día normal son menos de veinte. */
const FOLDER_LIST_MAX = 1000;
/** Carpetas viejas que se borran por corrida: el resto queda para la siguiente. */
const CLEANUP_FOLDERS_PER_RUN = 10;
/** Productos por consulta: los ids viajan en la URL. */
const PRODUCT_CHUNK = 40;

interface StorageFailure {
  message: string;
  status?: number;
  statusCode?: string;
}

/** Storage responde "no existe" de más de una forma según la versión: se miran todas. */
function isNotFound(error: StorageFailure): boolean {
  return error.status === 404 || error.statusCode === '404' || /not found/i.test(error.message);
}

function alreadyExists(error: StorageFailure): boolean {
  return error.status === 409 || error.statusCode === '409' || /already exists|duplicate/i.test(error.message);
}

/**
 * ¿Existe el bucket? Se pregunta por el bucket y no se deduce de un listado:
 * listar un bucket que no existe devuelve una lista vacía, sin error.
 */
async function videoBucketExists(admin: SupabaseClient): Promise<boolean> {
  const { data, error } = await admin.storage.getBucket(VIDEO_BUCKET);
  if (error) {
    if (isNotFound(error)) return false;
    throw new Error(`No se pudo consultar el almacén de videos: ${error.message}`);
  }
  if (data && data.public === false) {
    throw new Error(
      'El almacén de videos ("reels") existe pero no es público: ni las redes ni el admin pueden abrir los archivos. Hay que marcarlo como público en Supabase, en Storage.'
    );
  }
  return true;
}

/**
 * Crea el bucket público si no existe, con tope de tamaño y solo MP4 y JPG.
 * Devuelve true si lo creó ahora.
 */
export async function ensureVideoBucket(admin: SupabaseClient): Promise<boolean> {
  if (await videoBucketExists(admin)) return false;
  const { error } = await admin.storage.createBucket(VIDEO_BUCKET, {
    public: true,
    fileSizeLimit: VIDEO_MAX_BYTES,
    allowedMimeTypes: VIDEO_MIME_TYPES,
  });
  if (!error) return true;
  // Dos corridas a la vez: la otra lo creó primero.
  if (alreadyExists(error)) return false;
  throw new Error(`No se pudo crear el almacén de videos: ${error.message}`);
}

/** Un video guardado, con su portada. */
export interface StoredVideo extends VideoObject {
  /** El nombre del objeto, sin extensión. */
  file: string;
  /** Cuándo se subió el MP4. */
  renderedAt: string | null;
}

/**
 * Los videos completos de un día: los que tienen el MP4 y su portada. Uno a
 * medias (se cortó la subida) no se muestra y el plan lo vuelve a pedir.
 */
async function listVideoFolder(admin: SupabaseClient, date: string): Promise<StoredVideo[]> {
  const { data, error } = await admin.storage
    .from(VIDEO_BUCKET)
    .list(date, { limit: FOLDER_LIST_MAX, sortBy: { column: 'name', order: 'asc' } });
  if (error) throw new Error(`No se pudo leer los videos del ${date}: ${error.message}`);

  const uploaded = new Map<string, string | null>();
  const covers = new Set<string>();
  for (const entry of data ?? []) {
    const match = /^(.+)\.(mp4|jpg)$/.exec(entry.name);
    if (!match) continue;
    const file = `${date}/${match[1]}`;
    if (match[2] === 'mp4') uploaded.set(file, entry.updated_at ?? entry.created_at ?? null);
    else covers.add(file);
  }

  const videos: StoredVideo[] = [];
  for (const [file, renderedAt] of uploaded) {
    const parsed = covers.has(file) ? parseVideoObjectName(file) : null;
    if (parsed) videos.push({ ...parsed, file, renderedAt });
  }
  return videos;
}

/**
 * Direcciones firmadas para subir un video y su portada sin la clave del
 * sitio. Duran dos horas. Con reemplazo: si quedó un archivo a medias de una
 * corrida anterior, se pisa.
 *
 * Son un permiso de escritura: no se imprimen ni se guardan en ninguna parte.
 */
export async function signVideoUploads(admin: SupabaseClient, file: string): Promise<{ video: string; cover: string }> {
  const sign = async (path: string): Promise<string> => {
    const { data, error } = await admin.storage.from(VIDEO_BUCKET).createSignedUploadUrl(path, { upsert: true });
    if (error || !data?.signedUrl) {
      throw new Error(`No se pudo preparar la subida de un video: ${error?.message ?? 'el almacén no entregó la dirección'}`);
    }
    return data.signedUrl;
  };
  const [video, cover] = await Promise.all([sign(`${file}.mp4`), sign(`${file}.jpg`)]);
  return { video, cover };
}

/**
 * Borra los archivos de las carpetas con más de VIDEO_KEEP_DAYS días y dice
 * cuántos borró. Solo toca carpetas cuyo nombre es una fecha: lo demás que
 * haya en el bucket no es de acá.
 *
 * Nunca lanza: que no se pueda limpiar hoy no es motivo para dejar sin plan
 * al generador. Lo que quede se borra en la próxima corrida.
 */
export async function removeOldVideos(admin: SupabaseClient, now: Date): Promise<number> {
  const keepFrom = shiftDateKey(chileDateKey(now), -VIDEO_KEEP_DAYS);
  let removed = 0;
  try {
    const bucket = admin.storage.from(VIDEO_BUCKET);
    const root = await bucket.list('', { limit: 100, sortBy: { column: 'name', order: 'asc' } });
    if (root.error) throw new Error(root.error.message);
    // Las fechas AAAA-MM-DD se ordenan igual como texto que como fecha.
    const old = (root.data ?? [])
      .map((entry) => entry.name)
      .filter((name) => isDateKey(name) && name < keepFrom)
      .slice(0, CLEANUP_FOLDERS_PER_RUN);

    for (const folder of old) {
      const files = await bucket.list(folder, { limit: FOLDER_LIST_MAX });
      if (files.error) throw new Error(files.error.message);
      const paths = (files.data ?? []).filter((entry) => entry.id !== null).map((entry) => `${folder}/${entry.name}`);
      if (paths.length === 0) continue;
      const gone = await bucket.remove(paths);
      if (gone.error) throw new Error(gone.error.message);
      removed += gone.data?.length ?? paths.length;
    }
  } catch (err) {
    console.warn('[videos] no se pudo limpiar el almacén:', err instanceof Error ? err.message : String(err));
  }
  return removed;
}

// ---------------------------------------------------------------------------
// Marcas de "ya lo subí".

/** A qué redes se subió el video de un producto: la marca vigente más nueva de cada una. */
export type VideoPosted = Partial<Record<VideoNetwork, { postId: number; at: string }>>;

interface MarkRow {
  id: number;
  product_id: string | null;
  channel: string;
  posted_at: string;
}

/**
 * Las marcas de video vigentes desde `since`, por producto y por red. Una
 * marca deshecha (status 'error') no cuenta. Sin la tabla, ninguna.
 */
export async function readVideoMarks(admin: SupabaseClient, since: Date): Promise<Map<string, VideoPosted>> {
  const { data, error } = await admin
    .from('social_posts')
    .select('id, product_id, channel, posted_at')
    .in('channel', [...VIDEO_NETWORKS])
    .eq('caption', VIDEO_MARK)
    .eq('status', 'publicado')
    .gte('posted_at', since.toISOString())
    .order('posted_at', { ascending: false })
    .limit(2000);
  if (error) {
    if (isMissingSchemaError(error)) return new Map();
    throw new Error(`No se pudo leer los videos ya subidos: ${error.message}`);
  }

  const marks = new Map<string, VideoPosted>();
  // Vienen de la más nueva a la más antigua: la primera de cada red es la que vale.
  for (const row of (data ?? []) as MarkRow[]) {
    const network = row.channel as VideoNetwork;
    if (!row.product_id || !VIDEO_NETWORKS.includes(network)) continue;
    let posted = marks.get(row.product_id);
    if (!posted) {
      posted = {};
      marks.set(row.product_id, posted);
    }
    if (!posted[network]) posted[network] = { postId: row.id, at: row.posted_at };
  }
  return marks;
}

// ---------------------------------------------------------------------------
// La selección del día.

/** Un elegido para video, con el archivo que le corresponde hoy. */
export interface VideoPick extends TelegramPick<SocialProduct> {
  template: string;
  /** Lo que el video lleva escrito además del precio. La huella de `file` sale de acá. */
  claims: VideoClaims;
  /** Nombre del objeto en el almacén, sin extensión. */
  file: string;
  /** Ya están el MP4 y su portada con ese nombre exacto: no hay que armarlo de nuevo. */
  exists: boolean;
}

export interface VideoPlan {
  /** El día (hora de Chile) al que pertenecen los archivos. */
  date: string;
  picks: VideoPick[];
  /** Productos cuyo historial de precios no se pudo leer ahora: no se proponen. */
  unreadHistory: number;
}

/**
 * La foto grande en JPG, solo si es https de Mercado Libre. El generador la
 * baja desde fuera del sitio: no se le entrega una dirección de otro lado.
 */
export function videoPhoto(imageUrl: string | null | undefined): string | null {
  if (!imageUrl) return null;
  const photo = mlPhotoJpg(imageUrl);
  try {
    const url = new URL(photo);
    const onMl = url.hostname === 'mlstatic.com' || url.hostname.endsWith('.mlstatic.com');
    return url.protocol === 'https:' && onMl ? photo : null;
  } catch {
    return null;
  }
}

/**
 * Los videos que conviene armar hoy: la puerta de entrada de siempre
 * (descuento sobre el precio de lista o baja confirmada, precio recién
 * revisado, nada con aviso) y el orden del puntaje de interés. No vuelve lo
 * que ya se subió como video a cualquier red en los últimos 14 días.
 *
 * De cada elegido dice si su video de hoy ya está en el almacén: el que
 * lleva su precio y su huella de ahora. Uno de hoy que diga otra cosa (le
 * cambiaron el precio de lista, perdió el envío gratis) no cuenta, y se
 * propone de nuevo con otro nombre. Solo lee.
 */
export async function readVideoPicks(admin: SupabaseClient, now: Date, n: number = VIDEO_RULES.maxPosts): Promise<VideoPlan> {
  const max = Number.isInteger(n) && n >= 1 ? Math.min(n, VIDEO_PLAN_MAX) : VIDEO_RULES.maxPosts;
  const freshSince = new Date(now.getTime() - VIDEO_RULES.maxPriceAgeMs).toISOString();
  const read = await readFreshSocialProducts(admin, freshSince);
  if (read.error) throw new Error(`No se pudo leer el catálogo: ${read.error}`);

  const since = new Date(now.getTime() - VIDEO_RULES.repeatAfterDays * DAY_MS);
  const marks = await readVideoMarks(admin, since);
  // Lo que no puede salir: lo ya subido y lo que no tiene una foto que el
  // generador pueda bajar. Va como "ya publicado" y no filtrado de la lista,
  // porque la selección compara cada producto con el resto de su modelo.
  const skip = new Set<string>(marks.keys());
  for (const p of read.rows) if (!videoPhoto(p.image_url)) skip.add(p.id);

  const evidence = await readSocialEvidence(admin, read.rows, now, skip);
  const picked = pickByRules(read.rows, { now, recentlyPosted: skip, evidence }, { ...VIDEO_RULES, maxPosts: max });

  const date = chileDateKey(now);
  const stored = picked.length > 0 ? await listVideoFolder(admin, date) : [];
  const ready = new Set(stored.map((video) => video.file));
  const said = picked.map((pick) => {
    const claims = videoClaims(pick.product, pick.drop);
    return { claims, fingerprint: videoFingerprint(claims) };
  });
  // La plantilla del video de hoy, si ya existe diciendo lo mismo que diría ahora.
  const already = new Map<string, string>();
  picked.forEach((pick, i) => {
    const found = stored.find(
      (video) =>
        video.productId === pick.product.id && video.price === pick.product.price && video.fingerprint === said[i].fingerprint
    );
    if (found) already.set(pick.product.id, found.template);
  });
  const templates = assignVideoTemplates(
    picked.map((pick) => pick.product.id),
    date,
    already
  );

  const picks: VideoPick[] = [];
  picked.forEach((pick, i) => {
    const template = templates[i];
    const { claims, fingerprint } = said[i];
    const file = videoObjectName({ date, productId: pick.product.id, price: pick.product.price, template, fingerprint });
    if (file) picks.push({ ...pick, template, claims, file, exists: ready.has(file) });
  });
  return { date, picks, unreadHistory: countUnreadHistory(evidence) };
}

// ---------------------------------------------------------------------------
// Lo que está listo para subir.

export interface ReadyVideo {
  id: string;
  slug: string;
  name: string;
  brand: string | null;
  price: number;
  /** Precio de lista, solo si es mayor que el precio. */
  listPrice: number | null;
  discount: number;
  checkedAt: string | null;
  template: string;
  videoUrl: string;
  coverUrl: string;
  fileName: string;
  /** Cuándo se subió el archivo al almacén. */
  renderedAt: string | null;
  /** Puntaje de interés calculado ahora, no cuando se armó el video. */
  points: number;
  /** Qué es y por qué se propone. Si ahora hay algo que mirar antes de subirlo, lo dice al final (". Ojo: …", ver VIDEO_WARNING_MARK). */
  reason: string;
  /** Link directo de afiliado, para el perfil o para el sticker de una historia. */
  link: string;
  texts: VideoTexts;
  /** Marcas vigentes de los últimos 14 días. */
  posted: VideoPosted;
}

export interface VideoBoard {
  /** Primero los que faltan por subir a alguna red, por puntos; al final los que ya están en las cuatro. */
  videos: ReadyVideo[];
  /**
   * Productos cuyo video de hoy o de ayer ya no se muestra porque el producto
   * cambió (de precio, o de lo que dice la oferta: precio de lista,
   * descuento, baja, envío gratis, Full, nombre o marca) o salió del sitio.
   * No cuenta lo que se esconde por un rato y vuelve solo, sin armarlo de
   * nuevo (precio sin revisar en las últimas 6 horas, o historial de precios
   * que no se pudo leer en esta carga, que va en hiddenUnread), ni lo que el
   * puntaje ya no publicaría.
   */
  stale: number;
  /**
   * Productos con video de hoy o de ayer que no se muestran porque en esta
   * carga no se pudo leer su historial de precios: sin él no se sabe qué baja
   * diría hoy el video. No es que estén viejos: con otra carga vuelven solos.
   * Uno por producto, como la lista. Solo cuenta los que tienen un video con
   * el precio de ahora y su precio recién revisado: lo demás no se mostraría
   * igual aunque el historial se leyera.
   */
  hiddenUnread: number;
  /** Cuándo se subió el último video de hoy o de ayer, sirva o no. */
  lastRenderedAt: string | null;
  /** false si el bucket todavía no existe (el generador no ha corrido nunca). */
  storageReady: boolean;
}

const NO_EVIDENCE: InterestEvidence = { drop: null, min30: null, daysTracked: 0 };

/**
 * Lo que separa, en `reason`, el motivo de lo que hay que mirar antes de
 * subir el video. La página lo parte por este texto exacto (splitReason en
 * app/admin/videos/VideoList, que es de cliente y no puede importar de acá):
 * si cambia en un lado, cambia en el otro.
 */
export const VIDEO_WARNING_MARK = '. Ojo: ';

function timeOf(iso: string | null): number {
  const t = iso ? new Date(iso).getTime() : NaN;
  return Number.isFinite(t) ? t : 0;
}

/** ¿El precio del producto se revisó hace poco? La misma vara que la selección. */
function isFreshlyChecked(product: SocialProduct, now: Date): boolean {
  const checked = product.price_checked_at ? new Date(product.price_checked_at).getTime() : NaN;
  const age = now.getTime() - checked;
  return Number.isFinite(checked) && age <= VIDEO_RULES.maxPriceAgeMs && age >= -60_000;
}

async function readProductsById(admin: SupabaseClient, ids: string[]): Promise<Map<string, SocialProduct>> {
  const byId = new Map<string, SocialProduct>();
  for (let i = 0; i < ids.length; i += PRODUCT_CHUNK) {
    const chunk = ids.slice(i, i + PRODUCT_CHUNK);
    const read = await selectSocialProducts((columns) => admin.from('products').select(columns).in('id', chunk));
    if (read.error) throw new Error(`No se pudo leer los productos: ${read.error}`);
    for (const p of read.rows) byId.set(p.id, p);
  }
  return byId;
}

/**
 * Los videos de hoy y de ayer que se pueden subir ahora, uno por producto: el
 * más nuevo cuyo nombre sea exactamente el que saldría ahora para ese
 * producto (el precio, una plantilla que todavía se arma y la huella de lo
 * que el video dice), y solo si el producto sigue a la venta y su precio se
 * revisó hace poco. Los puntos y el motivo se calculan en este momento, con
 * el mismo historial y las mismas señales que la selección.
 *
 * La huella lleva la baja que confirma el historial de precios. Si el de un
 * producto no se pudo leer en esta carga, no se sabe qué diría hoy su video:
 * no se muestra, tampoco se da por viejo (a la próxima carga vuelve) y se
 * cuenta en hiddenUnread, para que la página lo diga en vez de callarlo.
 *
 * Si el bucket no existe todavía no lanza: storageReady va en false. Solo lee.
 */
export async function readVideoBoard(admin: SupabaseClient, now: Date): Promise<VideoBoard> {
  if (!(await videoBucketExists(admin))) {
    return { videos: [], stale: 0, hiddenUnread: 0, lastRenderedAt: null, storageReady: false };
  }

  const today = chileDateKey(now);
  const folders = await Promise.all([today, shiftDateKey(today, -1)].map((date) => listVideoFolder(admin, date)));
  const stored = folders[0].concat(folders[1]);
  if (stored.length === 0) return { videos: [], stale: 0, hiddenUnread: 0, lastRenderedAt: null, storageReady: true };

  // Del más nuevo al más antiguo: el día de la carpeta y, dentro del día, la hora en que se subió.
  stored.sort((a, b) => (a.date === b.date ? timeOf(b.renderedAt) - timeOf(a.renderedAt) : a.date < b.date ? 1 : -1));
  let lastRenderedAt: string | null = null;
  for (const video of stored) {
    if (video.renderedAt && timeOf(video.renderedAt) > timeOf(lastRenderedAt)) lastRenderedAt = video.renderedAt;
  }

  const byProduct = new Map<string, StoredVideo[]>();
  for (const video of stored) {
    const list = byProduct.get(video.productId);
    if (list) list.push(video);
    else byProduct.set(video.productId, [video]);
  }
  const products = await readProductsById(admin, [...byProduct.keys()]);

  // Lo que se sabe sin el historial: el producto salió del sitio, o ningún
  // video suyo lleva el precio de ahora con una plantilla que todavía se arma.
  const priced: { product: SocialProduct; list: StoredVideo[] }[] = [];
  let stale = 0;
  for (const [productId, all] of byProduct) {
    const product = products.get(productId);
    const list = isOnSale(product)
      ? all.filter((video) => video.price === product.price && isCurrentTemplate(video.template))
      : [];
    if (!isOnSale(product) || list.length === 0) stale++;
    else priced.push({ product, list });
  }
  if (priced.length === 0) return { videos: [], stale, hiddenUnread: 0, lastRenderedAt, storageReady: true };

  // La baja del historial es parte de lo que el video dice: sin leerlo no se
  // puede saber cuál es el nombre de hoy.
  const history = await readInterestEvidence(
    priced.map((item) => item.product),
    now
  );
  const live: { video: StoredVideo; product: SocialProduct; claims: VideoClaims }[] = [];
  let hiddenUnread = 0;
  for (const { product, list } of priced) {
    const seen = history.get(product.id);
    // No se pudo leer: ni se muestra ni quedó viejo. Se cuenta si es lo único
    // que lo esconde; con el precio sin revisar no saldría de todos modos.
    if (!seen || seen.historyUnread === true) {
      if (isFreshlyChecked(product, now)) hiddenUnread++;
      continue;
    }
    const claims = videoClaims(product, evidenceDrop(seen));
    const fingerprint = videoFingerprint(claims);
    // De cada producto, el video más nuevo que se llame como se llamaría hoy.
    const video = list.find(
      (item) =>
        item.file ===
        videoObjectName({ date: item.date, productId: product.id, price: product.price, template: item.template, fingerprint })
    );
    if (!video) {
      stale++;
      continue;
    }
    // Con el precio sin revisar hace rato no se sabe si el video sigue
    // diciendo la verdad: no se muestra, pero tampoco quedó viejo.
    if (isFreshlyChecked(product, now)) live.push({ video, product, claims });
  }
  if (live.length === 0) return { videos: [], stale, hiddenUnread, lastRenderedAt, storageReady: true };

  const since = new Date(now.getTime() - VIDEO_RULES.repeatAfterDays * DAY_MS);
  const [evidence, marks, settings] = await Promise.all([
    // Las señales, solo de los que se pueden mostrar: los clics se le piden
    // a la base por producto, no la semana entera de todo el sitio.
    addInterestSignals(
      admin,
      live.map((item) => item.product),
      history,
      now
    ),
    readVideoMarks(admin, since),
    readAffiliateSettings(admin),
  ]);

  const videos: ReadyVideo[] = [];
  for (const { video, product: p, claims } of live) {
    const score = interestScore(p, evidence.get(p.id) ?? NO_EVIDENCE);
    // Lo que el puntaje no publicaría (por ejemplo, el sitio lo vio bastante
    // más barato después de armar el video) tampoco se ofrece para subir.
    if (score.excluded !== null) continue;

    const safeSlug = p.slug.toLowerCase().replace(/[^a-z0-9-]+/g, '').slice(0, 80) || 'producto';
    videos.push({
      id: p.id,
      slug: p.slug,
      // La tarjeta muestra lo mismo que el video lleva escrito.
      name: claims.nombre_corto,
      brand: p.brand,
      price: p.price,
      listPrice: claims.precio_lista,
      discount: claims.descuento,
      checkedAt: p.price_checked_at,
      template: video.template,
      videoUrl: videoPublicUrl(`${video.file}.mp4`),
      coverUrl: videoPublicUrl(`${video.file}.jpg`),
      fileName: `comparatech-${safeSlug}-reel.mp4`,
      renderedAt: video.renderedAt,
      points: score.points,
      reason: score.warning ? `${score.reason}${VIDEO_WARNING_MARK}${score.warning}` : score.reason,
      link: resolveOutboundUrl(p, settings),
      texts: buildVideoTexts(p, now),
      posted: marks.get(p.id) ?? {},
    });
  }

  const pending = (video: ReadyVideo) => VIDEO_NETWORKS.some((network) => !video.posted[network]);
  videos.sort(
    (a, b) => Number(pending(b)) - Number(pending(a)) || b.points - a.points || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );

  return { videos: videos.slice(0, VIDEO_BOARD_MAX), stale, hiddenUnread, lastRenderedAt, storageReady: true };
}
