import 'server-only';
import { createHmac } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { isMissingSchemaError } from '@/lib/supabase/errors';

/**
 * Conexión con la app propia de Meta del dueño (Graph API), para publicar
 * en la página de Facebook y en la cuenta de Instagram sin pasar por
 * Metricool ni gastar su cupo gratis.
 *
 * Cómo se conecta (una sola vez, desde /admin/configuracion/meta):
 * 1. El dueño genera un token de usuario en el Graph API Explorer con su app
 *    (dura 1 hora) y lo pega en el admin.
 * 2. El servidor lo cambia por uno de 60 días (necesita META_APP_SECRET) y,
 *    con ese, pide el token de la página. Un token de página sacado de un
 *    token de usuario de 60 días no vence (lo dice la guía de Meta "Get
 *    long-lived tokens"), salvo que el dueño cambie su contraseña o quite
 *    los permisos.
 * 3. Se guarda solo el token de la página, en admin_private_settings: esa
 *    tabla no tiene policies, así que solo la lee el servidor, y el
 *    respaldo diario no la copia. El token de usuario no se guarda.
 *
 * El token nunca sale del servidor: lo que ve el admin es MetaStatus, sin
 * token. Los mensajes de error de Meta se limpian por si traen uno.
 */

export const GRAPH_VERSION = 'v26.0';
const GRAPH = `https://graph.facebook.com/${GRAPH_VERSION}`;
const TIMEOUT_MS = 15_000;

export const META_CONNECTION_KEY = 'meta_connection';

/**
 * Lo mínimo para publicar fotos, reels e historias en las dos redes. Fuente:
 * guía de publicación de Instagram (Facebook Login: instagram_basic,
 * instagram_content_publish, pages_read_engagement), caso de uso de
 * Instagram (agrega pages_show_list) y publicaciones de páginas
 * (pages_manage_posts).
 */
export const REQUIRED_SCOPES = [
  'instagram_basic',
  'instagram_content_publish',
  'pages_show_list',
  'pages_read_engagement',
  'pages_manage_posts',
] as const;

/**
 * Útil, pero sin él igual se conecta: se avisa si falta. publish_video no
 * va: el caso de uso "Administra todo en tu página" no lo ofrece (revisado
 * en el panel el 24-10-2026) y pedir en el Graph API Explorer un permiso que
 * la app no tiene hace fallar la ventana de Meta. Los reels de la página
 * usan pages_manage_posts.
 */
export const OPTIONAL_SCOPES = ['business_management'] as const;

export interface MetaCredentials {
  appId: string;
  appSecret: string;
}

/** META_APP_ID y META_APP_SECRET de Vercel; null si falta alguno. */
export function metaCredentials(): MetaCredentials | null {
  const appId = process.env.META_APP_ID?.trim();
  const appSecret = process.env.META_APP_SECRET?.trim();
  if (!appId || !appSecret) return null;
  return { appId, appSecret };
}

/** Lo que se guarda. Lleva el token: nunca se manda al navegador. */
export interface MetaConnection {
  pageId: string;
  pageName: string;
  pageToken: string;
  igUserId: string;
  igUsername: string | null;
  /** null = no vence (si tokenExpiryKnown) o no se pudo saber. */
  tokenExpiresAt: string | null;
  /** Si Meta confirmó cuándo vence el token de la página. */
  tokenExpiryKnown: boolean;
  scopes: string[];
  connectedAt: string;
  connectedBy: string;
}

/** Lo que ve el admin: lo mismo, sin el token. */
export type MetaStatus = Omit<MetaConnection, 'pageToken'>;

export function toStatus(conn: MetaConnection): MetaStatus {
  const { pageToken: _omit, ...rest } = conn;
  void _omit;
  return rest;
}

export class MetaApiError extends Error {
  constructor(
    message: string,
    readonly code: number | null,
    readonly subcode: number | null,
    readonly status: number
  ) {
    super(message);
    this.name = 'MetaApiError';
  }
}

/** Tapa cualquier token que venga en un texto (los de Meta empiezan con EAA). */
export function redactTokens(text: string): string {
  return text.replace(/EAA[A-Za-z0-9]{10,}/g, 'EAA…');
}

/**
 * Prueba de que quien llama tiene la clave de la app (appsecret_proof). Meta
 * la acepta siempre y la exige si la app tiene activado "Require App
 * Secret": se manda en cada llamada con token.
 */
export function appSecretProof(token: string, appSecret: string): string {
  return createHmac('sha256', appSecret).update(token).digest('hex');
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** Token de la página y su appsecret_proof, para cada llamada que publica o lee con la conexión. */
export function pageAuth(conn: Pick<MetaConnection, 'pageToken'>, creds: MetaCredentials): Record<string, string> {
  return { access_token: conn.pageToken, appsecret_proof: appSecretProof(conn.pageToken, creds.appSecret) };
}

export function graphGet(
  path: string,
  params: Record<string, string>,
  fetchImpl: FetchLike
): Promise<Record<string, unknown>> {
  const url = new URL(`${GRAPH}/${path.replace(/^\//, '')}`);
  for (const key of Object.keys(params)) url.searchParams.set(key, params[key]);
  return graphFetch(url.toString(), { cache: 'no-store' }, fetchImpl);
}

/**
 * POST con los parámetros en el cuerpo, no en la dirección: ahí quedarían el
 * token y el texto en los registros de cualquier intermediario.
 */
export function graphPost(
  path: string,
  params: Record<string, string>,
  fetchImpl: FetchLike
): Promise<Record<string, unknown>> {
  const body = new URLSearchParams();
  for (const key of Object.keys(params)) body.set(key, params[key]);
  return graphFetch(
    `${GRAPH}/${path.replace(/^\//, '')}`,
    { method: 'POST', body, headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, cache: 'no-store' },
    fetchImpl
  );
}

async function graphFetch(url: string, init: RequestInit, fetchImpl: FetchLike): Promise<Record<string, unknown>> {
  let res: Response;
  try {
    res = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new MetaApiError(`No se pudo conectar con Meta (${redactTokens(reason)})`, null, null, 0);
  }
  let body: Record<string, unknown> = {};
  try {
    body = (await res.json()) as Record<string, unknown>;
  } catch {
    // Sin JSON: se informa con el código HTTP.
  }
  const error = body.error as { message?: unknown; code?: unknown; error_subcode?: unknown } | undefined;
  if (!res.ok || error) {
    const message = typeof error?.message === 'string' ? error.message : `HTTP ${res.status}`;
    throw new MetaApiError(
      redactTokens(message),
      typeof error?.code === 'number' ? error.code : null,
      typeof error?.error_subcode === 'number' ? error.error_subcode : null,
      res.status
    );
  }
  return body;
}

/** Token de usuario de 1 hora → token de 60 días. */
export async function exchangeForLongLivedToken(
  shortToken: string,
  creds: MetaCredentials,
  fetchImpl: FetchLike = fetch
): Promise<string> {
  const body = await graphGet(
    'oauth/access_token',
    {
      grant_type: 'fb_exchange_token',
      client_id: creds.appId,
      client_secret: creds.appSecret,
      fb_exchange_token: shortToken,
    },
    fetchImpl
  );
  if (typeof body.access_token !== 'string' || !body.access_token) {
    throw new MetaApiError('Meta no devolvió el token de 60 días', null, null, 200);
  }
  return body.access_token;
}

/** Permisos que el dueño aceptó en la ventana de Meta. */
export async function grantedScopes(
  userToken: string,
  creds: MetaCredentials,
  fetchImpl: FetchLike = fetch
): Promise<string[]> {
  const body = await graphGet(
    'me/permissions',
    { access_token: userToken, appsecret_proof: appSecretProof(userToken, creds.appSecret) },
    fetchImpl
  );
  const data = Array.isArray(body.data) ? (body.data as Array<{ permission?: unknown; status?: unknown }>) : [];
  return data
    .filter((p) => p.status === 'granted' && typeof p.permission === 'string')
    .map((p) => p.permission as string);
}

export interface MetaPage {
  id: string;
  name: string;
  accessToken: string;
  tasks: string[];
  igUserId: string | null;
  igUsername: string | null;
}

/** Páginas que el dueño administra, cada una con su token y su Instagram vinculado. */
export async function listPages(
  userToken: string,
  creds: MetaCredentials,
  fetchImpl: FetchLike = fetch
): Promise<MetaPage[]> {
  const body = await graphGet(
    'me/accounts',
    {
      access_token: userToken,
      appsecret_proof: appSecretProof(userToken, creds.appSecret),
      fields: 'id,name,access_token,tasks,instagram_business_account{id,username}',
      limit: '100',
    },
    fetchImpl
  );
  const data = Array.isArray(body.data) ? (body.data as Array<Record<string, unknown>>) : [];
  const pages: MetaPage[] = [];
  for (const row of data) {
    if (typeof row.id !== 'string' || typeof row.access_token !== 'string') continue;
    const ig = row.instagram_business_account as { id?: unknown; username?: unknown } | undefined;
    pages.push({
      id: row.id,
      name: typeof row.name === 'string' ? row.name : row.id,
      accessToken: row.access_token,
      tasks: Array.isArray(row.tasks) ? row.tasks.filter((t): t is string => typeof t === 'string') : [],
      igUserId: typeof ig?.id === 'string' ? ig.id : null,
      igUsername: typeof ig?.username === 'string' ? ig.username : null,
    });
  }
  return pages;
}

/**
 * Cuándo vence un token, según Meta (debug_token con el token de la app).
 * null = no vence. Si no se puede saber, undefined.
 */
export async function tokenExpiry(
  token: string,
  creds: MetaCredentials,
  fetchImpl: FetchLike = fetch
): Promise<string | null | undefined> {
  try {
    const body = await graphGet(
      'debug_token',
      { input_token: token, access_token: `${creds.appId}|${creds.appSecret}` },
      fetchImpl
    );
    const data = (body.data ?? {}) as { expires_at?: unknown; data_access_expires_at?: unknown };
    const expiresAt = typeof data.expires_at === 'number' ? data.expires_at : null;
    if (expiresAt === null) return undefined;
    return expiresAt === 0 ? null : new Date(expiresAt * 1000).toISOString();
  } catch {
    return undefined;
  }
}

/** Cuántas publicaciones por API van en las últimas 24 h (lectura, no publica nada). */
export async function publishingQuota(
  conn: Pick<MetaConnection, 'igUserId' | 'pageToken'>,
  creds: MetaCredentials,
  fetchImpl: FetchLike = fetch
): Promise<{ used: number | null; total: number | null }> {
  const body = await graphGet(
    `${conn.igUserId}/content_publishing_limit`,
    {
      fields: 'quota_usage,config',
      access_token: conn.pageToken,
      appsecret_proof: appSecretProof(conn.pageToken, creds.appSecret),
    },
    fetchImpl
  );
  const row = (Array.isArray(body.data) ? body.data[0] : null) as
    | { quota_usage?: unknown; config?: { quota_total?: unknown } }
    | null;
  return {
    used: typeof row?.quota_usage === 'number' ? row.quota_usage : null,
    total: typeof row?.config?.quota_total === 'number' ? row.config.quota_total : null,
  };
}

/**
 * Lo que el dueño pega: el token, a veces con comillas, espacios o saltos de
 * línea al copiarlo. null si no parece un token de Meta.
 */
export function cleanPastedToken(raw: string): string | null {
  const token = (raw ?? '').replace(/\s+/g, '').replace(/^["']+|["']+$/g, '');
  return /^EAA[A-Za-z0-9]{40,2000}$/.test(token) ? token : null;
}

/**
 * Qué página conectar. La que tiene Instagram vinculado; si hay varias, la
 * elegida (pageId) o null para preguntar.
 */
export function pickPage(
  pages: MetaPage[],
  pageId?: string | null
): { page: MetaPage } | { choose: MetaPage[] } | { error: string } {
  if (pageId) {
    const chosen = pages.find((p) => p.id === pageId);
    if (!chosen) return { error: 'Esa página ya no aparece en tu cuenta. Vuelve a generar el token.' };
    if (!chosen.igUserId) return { error: `La página "${chosen.name}" no tiene una cuenta de Instagram vinculada.` };
    return { page: chosen };
  }
  if (pages.length === 0) {
    return {
      error:
        'Meta no entregó ninguna página. En la ventana de permisos de Meta, marca la página ComparaTech y la cuenta de Instagram.',
    };
  }
  const withIg = pages.filter((p) => p.igUserId);
  if (withIg.length === 0) {
    return {
      error:
        'Ninguna de tus páginas tiene Instagram vinculado, o no se marcó la cuenta de Instagram en la ventana de permisos de Meta.',
    };
  }
  if (withIg.length === 1) return { page: withIg[0] };
  return { choose: withIg };
}

/** Los obligatorios que faltan (vacío = todo bien). */
export function missingScopes(scopes: string[]): string[] {
  return REQUIRED_SCOPES.filter((s) => !scopes.includes(s));
}

/**
 * Mensaje en español para el admin a partir de un error de Meta.
 *
 * 'conectar': el token es el que se acaba de pegar (dura 1 hora). 'guardada':
 * es la conexión guardada, que no vence sola. Si Meta la rechaza (código
 * 190), es porque después se le quitó el acceso a la página o a la app; pasó
 * el 25-10-2026: "Any of the pages_read_engagement… permission(s) must be
 * granted before impersonating a user's page".
 */
export function metaErrorMessage(err: unknown, context: 'conectar' | 'guardada' = 'conectar'): string {
  if (err instanceof MetaApiError) {
    if (err.code === 190) {
      return context === 'guardada'
        ? 'Meta ya no acepta la conexión guardada: a la app le quitaron el acceso a la página o a Instagram. Vuelve a conectar en Configuración → Instagram y Facebook. No se publicó nada.'
        : 'Meta rechazó el token: venció (dura 1 hora) o no se copió completo. Genera uno nuevo y pégalo de inmediato.';
    }
    if (err.code === 10 || (err.code !== null && err.code >= 200 && err.code < 300)) {
      return `Falta un permiso en la app de Meta (${err.message}).`;
    }
    if (err.code === 4 || err.code === 17 || err.code === 32 || err.code === 613) {
      return 'Meta pide esperar: se hicieron muchas consultas seguidas. Prueba en unos minutos.';
    }
    if (err.code === 101 || err.code === 1) {
      return `Meta no reconoce la app: revisa META_APP_ID y META_APP_SECRET en Vercel (${err.message}).`;
    }
    return `Meta respondió con un error: ${err.message}`;
  }
  return err instanceof Error ? redactTokens(err.message) : 'Error desconocido al hablar con Meta.';
}

function parseConnection(value: unknown): MetaConnection | null {
  const v = (value ?? {}) as Record<string, unknown>;
  const str = (x: unknown) => (typeof x === 'string' && x ? x : null);
  const pageId = str(v.pageId);
  const pageToken = str(v.pageToken);
  const igUserId = str(v.igUserId);
  if (!pageId || !pageToken || !igUserId) return null;
  return {
    pageId,
    pageName: str(v.pageName) ?? pageId,
    pageToken,
    igUserId,
    igUsername: str(v.igUsername),
    tokenExpiresAt: str(v.tokenExpiresAt),
    tokenExpiryKnown: v.tokenExpiryKnown === true,
    scopes: Array.isArray(v.scopes) ? v.scopes.filter((s): s is string => typeof s === 'string') : [],
    connectedAt: str(v.connectedAt) ?? '',
    connectedBy: str(v.connectedBy) ?? '',
  };
}

/**
 * La conexión guardada (con token: solo para el servidor). available=false
 * si falta la tabla (migración 0013) o no se pudo leer.
 */
export async function readMetaConnection(
  admin: SupabaseClient | null
): Promise<{ available: boolean; connection: MetaConnection | null }> {
  if (!admin) return { available: false, connection: null };
  try {
    const { data, error } = await admin
      .from('admin_private_settings')
      .select('value')
      .eq('key', META_CONNECTION_KEY)
      .maybeSingle();
    if (error) {
      if (!isMissingSchemaError(error)) console.error(`[meta] ${error.message}`);
      return { available: false, connection: null };
    }
    return { available: true, connection: data ? parseConnection(data.value) : null };
  } catch (err) {
    console.error('[meta] no se pudo leer la conexión:', err instanceof Error ? redactTokens(err.message) : err);
    return { available: false, connection: null };
  }
}

export async function writeMetaConnection(
  admin: SupabaseClient,
  conn: MetaConnection
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await admin.from('admin_private_settings').upsert({
    key: META_CONNECTION_KEY,
    value: conn,
    updated_at: new Date().toISOString(),
  });
  return error ? { ok: false, error: error.message } : { ok: true };
}

export async function deleteMetaConnection(admin: SupabaseClient): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await admin.from('admin_private_settings').delete().eq('key', META_CONNECTION_KEY);
  return error ? { ok: false, error: error.message } : { ok: true };
}

/**
 * Todo el paso de conectar, sin tocar la base: cambia el token, revisa los
 * permisos, elige la página y averigua si el token de la página vence.
 */
export async function buildConnection(
  shortToken: string,
  opts: { creds: MetaCredentials; actor: string; pageId?: string | null; now?: Date; fetchImpl?: FetchLike }
): Promise<
  | { ok: true; connection: MetaConnection; missingOptional: string[] }
  | { ok: false; choose: Array<{ id: string; name: string; igUsername: string | null }> }
  | { ok: false; error: string }
> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const longToken = await exchangeForLongLivedToken(shortToken, opts.creds, fetchImpl);
  const scopes = await grantedScopes(longToken, opts.creds, fetchImpl);
  const missing = missingScopes(scopes);
  if (missing.length > 0) {
    return {
      ok: false,
      error: `En el token faltan estos permisos: ${missing.join(', ')}. En el Graph API Explorer agrégalos antes de tocar "Generate Access Token" y acéptalos en la ventana de Meta.`,
    };
  }
  const picked = pickPage(await listPages(longToken, opts.creds, fetchImpl), opts.pageId);
  if ('error' in picked) return { ok: false, error: picked.error };
  if ('choose' in picked) {
    return { ok: false, choose: picked.choose.map((p) => ({ id: p.id, name: p.name, igUsername: p.igUsername })) };
  }
  const page = picked.page;
  if (page.tasks.length > 0 && !page.tasks.includes('CREATE_CONTENT')) {
    return { ok: false, error: `Tu usuario no puede publicar en la página "${page.name}" (le falta el permiso de crear contenido).` };
  }
  const expiry = await tokenExpiry(page.accessToken, opts.creds, fetchImpl);
  const connection: MetaConnection = {
    pageId: page.id,
    pageName: page.name,
    pageToken: page.accessToken,
    igUserId: page.igUserId as string,
    igUsername: page.igUsername,
    tokenExpiresAt: expiry === undefined ? null : expiry,
    tokenExpiryKnown: expiry !== undefined,
    scopes,
    connectedAt: (opts.now ?? new Date()).toISOString(),
    connectedBy: opts.actor,
  };
  return { ok: true, connection, missingOptional: OPTIONAL_SCOPES.filter((s) => !scopes.includes(s)) };
}
