import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  GRAPH_VERSION,
  MetaApiError,
  appSecretProof,
  buildConnection,
  cleanPastedToken,
  exchangeForLongLivedToken,
  listPages,
  metaErrorMessage,
  missingScopes,
  pickPage,
  readMetaConnection,
  redactTokens,
  toStatus,
  type MetaConnection,
  type MetaPage,
} from './meta';

/**
 * La conexión con la app propia de Meta (lib/social/meta y
 * app/admin/configuracion/meta/actions): contra un Graph API de mentira.
 * Lo que más importa es que el token de la página nunca salga del servidor
 * ni quede escrito en la actividad del admin.
 */

const SHORT = 'EAA' + 'S'.repeat(60);
const LONG = 'EAA' + 'L'.repeat(80);
const PAGE_TOKEN = 'EAA' + 'P'.repeat(90);
const CREDS = { appId: '1234567890', appSecret: 'secreto-de-prueba' };

type Handler = (url: URL) => { status?: number; body: unknown };

function fakeFetch(handler: Handler) {
  const calls: URL[] = [];
  const impl = async (input: string) => {
    const url = new URL(input);
    calls.push(url);
    const { status = 200, body } = handler(url);
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  };
  return { impl, calls };
}

const ALL_SCOPES = [
  'instagram_basic',
  'instagram_content_publish',
  'pages_show_list',
  'pages_read_engagement',
  'pages_manage_posts',
  'business_management',
  'publish_video',
];

function happyGraph(overrides: Partial<Record<string, unknown>> = {}): Handler {
  return (url) => {
    const path = url.pathname.replace(`/${GRAPH_VERSION}/`, '');
    if (path === 'oauth/access_token') return { body: { access_token: LONG, token_type: 'bearer', expires_in: 5183944 } };
    if (path === 'me/permissions') {
      const scopes = (overrides.scopes as string[] | undefined) ?? ALL_SCOPES;
      return { body: { data: scopes.map((permission) => ({ permission, status: 'granted' })) } };
    }
    if (path === 'me/accounts') {
      return {
        body: {
          data: (overrides.pages as unknown[] | undefined) ?? [
            {
              id: '111',
              name: 'ComparaTech',
              access_token: PAGE_TOKEN,
              tasks: ['ANALYZE', 'ADVERTISE', 'MODERATE', 'CREATE_CONTENT', 'MANAGE'],
              instagram_business_account: { id: '1784', username: 'comparatech.cl' },
            },
          ],
        },
      };
    }
    if (path === 'debug_token') return { body: { data: { expires_at: 0, is_valid: true } } };
    return { status: 404, body: { error: { message: `ruta inesperada ${path}`, code: 803 } } };
  };
}

describe('lo que pega el dueño', () => {
  it('acepta el token con espacios, saltos de línea o comillas', () => {
    expect(cleanPastedToken(`  "${SHORT}"\n`)).toBe(SHORT);
    expect(cleanPastedToken(`${SHORT.slice(0, 30)}\n${SHORT.slice(30)}`)).toBe(SHORT);
  });

  it('rechaza lo que no es un token de Meta', () => {
    expect(cleanPastedToken('')).toBeNull();
    expect(cleanPastedToken('hola')).toBeNull();
    expect(cleanPastedToken('EAAcorto')).toBeNull();
    expect(cleanPastedToken('IGQ' + 'x'.repeat(80))).toBeNull();
    expect(cleanPastedToken('EAA' + 'x'.repeat(50) + '<script>')).toBeNull();
  });
});

describe('seguridad del token', () => {
  it('tapa los tokens que vengan en un texto', () => {
    expect(redactTokens(`falló con ${PAGE_TOKEN} y listo`)).toBe('falló con EAA… y listo');
  });

  it('firma cada llamada con appsecret_proof (HMAC-SHA256 del token)', () => {
    const expected = createHmac('sha256', CREDS.appSecret).update(LONG).digest('hex');
    expect(appSecretProof(LONG, CREDS.appSecret)).toBe(expected);
  });

  it('toStatus deja fuera el token de la página', () => {
    const conn: MetaConnection = {
      pageId: '111',
      pageName: 'ComparaTech',
      pageToken: PAGE_TOKEN,
      igUserId: '1784',
      igUsername: 'comparatech.cl',
      tokenExpiresAt: null,
      tokenExpiryKnown: true,
      scopes: ALL_SCOPES,
      connectedAt: '2026-10-24T23:00:00.000Z',
      connectedBy: 'cristopher',
    };
    const status = toStatus(conn);
    expect(JSON.stringify(status)).not.toContain('EAA');
    expect(status).not.toHaveProperty('pageToken');
  });

  it('el formulario del navegador no lee la conexión guardada', () => {
    const client = readFileSync('src/app/admin/configuracion/meta/MetaConnect.tsx', 'utf8');
    expect(client).not.toContain('readMetaConnection');
    expect(client).not.toContain('pageToken');
    const page = readFileSync('src/app/admin/configuracion/meta/page.tsx', 'utf8');
    // La página arma la vista con toStatus, nunca con la conexión completa.
    expect(page).toContain('toStatus(connection)');
    expect(page).not.toMatch(/connection\.pageToken/);
  });
});

describe('Graph API', () => {
  it('cambia el token de 1 hora por uno de 60 días con la clave de la app', async () => {
    const { impl, calls } = fakeFetch(happyGraph());
    expect(await exchangeForLongLivedToken(SHORT, CREDS, impl)).toBe(LONG);
    const url = calls[0];
    expect(url.origin + url.pathname).toBe(`https://graph.facebook.com/${GRAPH_VERSION}/oauth/access_token`);
    expect(url.searchParams.get('grant_type')).toBe('fb_exchange_token');
    expect(url.searchParams.get('client_id')).toBe(CREDS.appId);
    expect(url.searchParams.get('client_secret')).toBe(CREDS.appSecret);
    expect(url.searchParams.get('fb_exchange_token')).toBe(SHORT);
  });

  it('lee las páginas con su Instagram y manda appsecret_proof', async () => {
    const { impl, calls } = fakeFetch(happyGraph());
    const pages = await listPages(LONG, CREDS, impl);
    expect(pages).toEqual([
      {
        id: '111',
        name: 'ComparaTech',
        accessToken: PAGE_TOKEN,
        tasks: ['ANALYZE', 'ADVERTISE', 'MODERATE', 'CREATE_CONTENT', 'MANAGE'],
        igUserId: '1784',
        igUsername: 'comparatech.cl',
      },
    ]);
    expect(calls[0].searchParams.get('appsecret_proof')).toBe(appSecretProof(LONG, CREDS.appSecret));
    expect(calls[0].searchParams.get('fields')).toContain('instagram_business_account');
  });

  it('un error de Meta llega en español y sin el token', async () => {
    const { impl } = fakeFetch(() => ({
      status: 400,
      body: { error: { message: `Error validating access token: ${SHORT} has expired`, code: 190, error_subcode: 463 } },
    }));
    const err = await exchangeForLongLivedToken(SHORT, CREDS, impl).catch((e) => e);
    expect(err).toBeInstanceOf(MetaApiError);
    expect(err.message).not.toContain(SHORT);
    expect(metaErrorMessage(err)).toMatch(/venció/);
  });

  it('traduce los errores conocidos', () => {
    expect(metaErrorMessage(new MetaApiError('x', 10, null, 403))).toMatch(/permiso/);
    expect(metaErrorMessage(new MetaApiError('x', 200, null, 403))).toMatch(/permiso/);
    expect(metaErrorMessage(new MetaApiError('x', 4, null, 400))).toMatch(/esperar/);
    expect(metaErrorMessage(new MetaApiError('x', 101, null, 400))).toMatch(/META_APP_ID/);
    expect(metaErrorMessage(new Error(`se cayó ${PAGE_TOKEN}`))).toBe('se cayó EAA…');
  });
});

describe('qué página conectar', () => {
  const page = (id: string, ig: string | null): MetaPage => ({
    id,
    name: `Página ${id}`,
    accessToken: PAGE_TOKEN,
    tasks: ['CREATE_CONTENT'],
    igUserId: ig,
    igUsername: ig ? `cuenta${id}` : null,
  });

  it('sin páginas, pide marcarla en la ventana de Meta', () => {
    expect(pickPage([])).toEqual({ error: expect.stringMatching(/marca la página/) });
  });

  it('sin Instagram vinculado, lo dice', () => {
    expect(pickPage([page('1', null)])).toEqual({ error: expect.stringMatching(/Instagram/) });
  });

  it('con una sola página con Instagram, la elige aunque haya otras sin Instagram', () => {
    const result = pickPage([page('1', null), page('2', '99')]);
    expect('page' in result && result.page.id).toBe('2');
  });

  it('con varias, pregunta; con la elegida, la usa', () => {
    const pages = [page('1', '91'), page('2', '92')];
    expect(pickPage(pages)).toEqual({ choose: pages });
    const chosen = pickPage(pages, '2');
    expect('page' in chosen && chosen.page.id).toBe('2');
    expect(pickPage(pages, '3')).toEqual({ error: expect.any(String) });
  });

  it('los permisos obligatorios', () => {
    expect(missingScopes(ALL_SCOPES)).toEqual([]);
    expect(missingScopes(['instagram_basic', 'pages_show_list'])).toEqual([
      'instagram_content_publish',
      'pages_read_engagement',
      'pages_manage_posts',
    ]);
  });
});

describe('buildConnection', () => {
  const now = new Date('2026-10-24T23:00:00.000Z');

  it('arma la conexión completa: página, Instagram y token que no vence', async () => {
    const { impl } = fakeFetch(happyGraph());
    const result = await buildConnection(SHORT, { creds: CREDS, actor: 'cristopher', now, fetchImpl: impl });
    expect(result).toEqual({
      ok: true,
      missingOptional: [],
      connection: {
        pageId: '111',
        pageName: 'ComparaTech',
        pageToken: PAGE_TOKEN,
        igUserId: '1784',
        igUsername: 'comparatech.cl',
        tokenExpiresAt: null,
        tokenExpiryKnown: true,
        scopes: ALL_SCOPES,
        connectedAt: now.toISOString(),
        connectedBy: 'cristopher',
      },
    });
  });

  it('si faltan permisos obligatorios, no conecta y dice cuáles', async () => {
    const { impl } = fakeFetch(happyGraph({ scopes: ['instagram_basic', 'pages_show_list', 'pages_read_engagement'] }));
    const result = await buildConnection(SHORT, { creds: CREDS, actor: 'x', now, fetchImpl: impl });
    expect(result).toEqual({ ok: false, error: expect.stringContaining('instagram_content_publish, pages_manage_posts') });
  });

  it('avisa los permisos opcionales que faltan', async () => {
    const { impl } = fakeFetch(happyGraph({ scopes: ALL_SCOPES.filter((s) => s !== 'publish_video') }));
    const result = await buildConnection(SHORT, { creds: CREDS, actor: 'x', now, fetchImpl: impl });
    expect(result.ok && result.missingOptional).toEqual(['publish_video']);
  });

  it('si el usuario no puede crear contenido en la página, no conecta', async () => {
    const { impl } = fakeFetch(
      happyGraph({
        pages: [
          {
            id: '111',
            name: 'ComparaTech',
            access_token: PAGE_TOKEN,
            tasks: ['ANALYZE'],
            instagram_business_account: { id: '1784', username: 'comparatech.cl' },
          },
        ],
      })
    );
    const result = await buildConnection(SHORT, { creds: CREDS, actor: 'x', now, fetchImpl: impl });
    expect(result).toEqual({ ok: false, error: expect.stringMatching(/crear contenido/) });
  });

  it('si Meta no confirma el vencimiento, lo deja dicho', async () => {
    const base = happyGraph();
    const { impl } = fakeFetch((url) =>
      url.pathname.endsWith('/debug_token') ? { status: 500, body: { error: { message: 'x', code: 2 } } } : base(url)
    );
    const result = await buildConnection(SHORT, { creds: CREDS, actor: 'x', now, fetchImpl: impl });
    expect(result.ok && result.connection.tokenExpiryKnown).toBe(false);
  });
});

describe('readMetaConnection', () => {
  function fakeAdmin(result: { data: unknown; error: unknown }) {
    const query = {
      select: () => query,
      eq: () => query,
      maybeSingle: async () => result,
    };
    return { from: () => query } as never;
  }

  it('sin cliente o sin tabla, no disponible', async () => {
    expect(await readMetaConnection(null)).toEqual({ available: false, connection: null });
    const missing = fakeAdmin({ data: null, error: { code: '42P01', message: 'relation "admin_private_settings" does not exist' } });
    expect(await readMetaConnection(missing)).toEqual({ available: false, connection: null });
  });

  it('sin fila, disponible y sin conexión; una fila a medias no cuenta', async () => {
    expect(await readMetaConnection(fakeAdmin({ data: null, error: null }))).toEqual({ available: true, connection: null });
    const partial = fakeAdmin({ data: { value: { pageId: '111', igUserId: '1784' } }, error: null });
    expect(await readMetaConnection(partial)).toEqual({ available: true, connection: null });
  });
});

const store = vi.hoisted(() => ({
  rows: {} as Record<string, unknown>,
  events: [] as unknown[],
}));

vi.mock('@/lib/admin-auth', () => ({ requireAdmin: vi.fn(async () => 'cristopher') }));
vi.mock('@/lib/admin-audit', () => ({ logAdminEvent: vi.fn(async (_admin: unknown, event: unknown) => void store.events.push(event)) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({
  getSupabaseAdmin: () => ({
    from: () => {
      let key = '';
      const query = {
        select: () => query,
        eq: (_col: string, value: string) => {
          key = value;
          return query;
        },
        maybeSingle: async () => ({ data: key in store.rows ? { value: store.rows[key] } : null, error: null }),
        upsert: async (row: { key: string; value: unknown }) => {
          store.rows[row.key] = row.value;
          return { error: null };
        },
        delete: () => ({
          eq: async (_col: string, value: string) => {
            delete store.rows[value];
            return { error: null };
          },
        }),
      };
      return query;
    },
  }),
}));

describe('acciones del admin', () => {
  beforeEach(() => {
    store.rows = {};
    store.events = [];
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('sin META_APP_ID y META_APP_SECRET, pide agregarlos en Vercel', async () => {
    vi.stubEnv('META_APP_ID', '');
    vi.stubEnv('META_APP_SECRET', '');
    const { connectMeta } = await import('@/app/admin/configuracion/meta/actions');
    expect(await connectMeta({ token: SHORT })).toEqual({ ok: false, error: expect.stringMatching(/Vercel/) });
  });

  it('conecta, guarda el token solo en la tabla privada y no lo devuelve ni lo anota', async () => {
    vi.stubEnv('META_APP_ID', CREDS.appId);
    vi.stubEnv('META_APP_SECRET', CREDS.appSecret);
    const { impl } = fakeFetch(happyGraph());
    vi.stubGlobal('fetch', impl);
    const { connectMeta, disconnectMeta } = await import('@/app/admin/configuracion/meta/actions');

    const result = await connectMeta({ token: `"${SHORT}"` });
    expect(result.ok).toBe(true);
    expect(JSON.stringify(result)).not.toContain('EAA');
    expect((store.rows.meta_connection as MetaConnection).pageToken).toBe(PAGE_TOKEN);
    expect(JSON.stringify(store.events)).not.toContain('EAA');
    expect(store.events).toEqual([
      expect.objectContaining({ action: 'conectar_meta', after: { pagina: 'ComparaTech', instagram: 'comparatech.cl' } }),
    ]);

    expect(await disconnectMeta()).toEqual({ ok: true });
    expect(store.rows).toEqual({});
  });

  it('un token mal copiado no llega a Meta', async () => {
    vi.stubEnv('META_APP_ID', CREDS.appId);
    vi.stubEnv('META_APP_SECRET', CREDS.appSecret);
    const spy = vi.fn();
    vi.stubGlobal('fetch', spy);
    const { connectMeta } = await import('@/app/admin/configuracion/meta/actions');
    expect(await connectMeta({ token: 'pegué otra cosa' })).toEqual({ ok: false, error: expect.stringMatching(/EAA/) });
    expect(spy).not.toHaveBeenCalled();
  });
});
