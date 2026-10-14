// Un sitio de mentira para probar generar.mjs sin red. Hace de las dos cosas con las que habla el generador:
//   - el sitio:   GET /api/social/videos/plan?n=4, con el secreto de los crons (lo acordado con la ruta real);
//                 cada elemento trae su "archivo" = AAAA-MM-DD/<id>-<precio>-<plantilla>-<huella>
//   - el almacén: PUT /storage/v1/object/upload/sign/reels/<archivo>?token=..., como las subidas firmadas de
//                 Supabase Storage (responde { Key } y, si el archivo ya existe, el error "Duplicate")
// Escucha solo en 127.0.0.1, en un puerto libre, y anota todo lo que le llega para que el test lo revise.
import crypto from 'node:crypto';
import http from 'node:http';

const PLAN_PATH = '/api/social/videos/plan';
const UPLOAD_PREFIX = '/storage/v1/object/upload/sign/reels/';

/** Un token con la misma forma que los de Supabase (un JWT), distinto en cada corrida. */
function fakeToken() {
  const part = (bytes) => crypto.randomBytes(bytes).toString('base64url');
  return `eyJhbGciOiJIUzI1NiJ9.${part(48)}.${part(32)}`;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/**
 * La huella de la oferta, calculada como la calcula el sitio de verdad (src/lib/social/videos.ts): los
 * primeros 8 signos, en hexadecimal, del SHA-256 de lo que el video dice además del precio, con los mismos
 * valores que el plan entrega en esos campos. El generador no la calcula nunca: esto existe solo para que el
 * sitio de mentira entregue nombres de archivo como los de verdad.
 *
 * @param {Record<string, any>} item
 */
export function offerFingerprint(item) {
  const said = [item.nombre_corto, item.marca ?? null, item.precio_lista ?? null, item.descuento, item.baja_historial ?? null, item.envio_gratis, item.full];
  return crypto.createHash('sha256').update(JSON.stringify(said)).digest('hex').slice(0, 8);
}

/**
 * El nombre del archivo de un producto como lo entrega el plan, sin la extensión:
 * "AAAA-MM-DD/<id>-<precio>-<plantilla>-<huella>".
 *
 * @param {Record<string, any>} item
 * @param {string} [date]
 */
export function fileName(item, date = '2026-10-13') {
  return `${date}/${item.id}-${item.precio}-${item.plantilla}-${offerFingerprint(item)}`;
}

/**
 * Tres productos como los que entrega el plan (sin `archivo`, `ya_existe` ni `subir`: eso lo pone el sitio
 * de mentira).
 * @returns {Record<string, any>[]}
 */
export function sampleItems() {
  const base = {
    categoria: 'celulares',
    precio_lista: null,
    descuento: 0,
    baja_historial: null,
    envio_gratis: false,
    full: false,
    precio_revisado: '2026-10-13T12:30:11.699+00:00',
    puntos: 50,
    plantilla: 'estudio',
  };
  return [
    {
      ...base,
      id: 'bb2d3803-a43b-4aa2-bd82-f73ae7ecb246',
      slug: 'moto-g86-power-256gb',
      nombre: 'Moto G86 power 256GB 256 GB verde 8 GB RAM',
      nombre_corto: 'Moto G86 power 256GB',
      marca: 'Motorola',
      precio: 219990,
      precio_lista: 399990,
      descuento: 45,
      envio_gratis: true,
      full: true,
      puntos: 82,
      motivo: 'Celular Motorola, 45% por debajo del precio de lista, llega con Full y envío gratis',
      foto: 'https://http2.mlstatic.com/D_NQ_NP_814687-MLA106501833995_022026-F.jpg',
    },
    {
      ...base,
      id: 'bb540d67-d995-4efd-893d-29d7cef9f4d3',
      slug: 'smart-tv-led-caixun-roku-tv-43-full-hd-c43v1fr',
      nombre: 'Smart TV LED Caixun Roku TV 43" Full HD C43V1FR',
      nombre_corto: 'Smart TV LED Caixun Roku TV 43" Full HD',
      marca: 'Caixun',
      categoria: 'electronica',
      precio: 182990,
      precio_lista: 299990,
      descuento: 39,
      envio_gratis: true,
      puntos: 74,
      motivo: 'Smart TV Caixun de 43 pulgadas, 39% por debajo del precio de lista, con envío gratis',
      foto: 'https://http2.mlstatic.com/D_NQ_NP_878845-MLA112597664360_062026-F.jpg',
    },
    {
      ...base,
      id: 'c65c6a4c-42c4-42fd-b14f-8b908ca1e2b2',
      slug: 'tablet-lenovo-tab-128gb',
      nombre: 'Tablet Lenovo Tab Mediatek Helio 4gb Ram 128gb Wuxga 4g Lte',
      nombre_corto: 'Tablet Lenovo Tab 128gb',
      marca: 'Lenovo',
      categoria: 'computacion',
      precio: 189990,
      baja_historial: 12,
      puntos: 61,
      motivo: 'Tablet Lenovo, bajó 12% según el historial del sitio',
      foto: 'https://http2.mlstatic.com/D_NQ_NP_805620-MLA82361031790_022025-F.jpg',
    },
  ];
}

/**
 * Levanta el sitio de mentira.
 *
 *   secret        el secreto que acepta la ruta del plan
 *   items         los productos del plan (ver sampleItems); un item puede traer sus propios `archivo`,
 *                 `ya_existe` o `subir` para simular un plan raro
 *   existing      ids de productos cuyo video "ya existe" (ya_existe: true, subir: null)
 *   planFailures  respuestas que da la ruta del plan antes de responder bien: [{ status, body, headers }]
 *                 (con status 3xx y headers.location hace de sitio que redirige)
 *   rejectUploads ids de productos cuyas subidas se rechazan; el mensaje de error repite la dirección firmada,
 *                 para probar que el generador no la deja pasar a lo que imprime
 *
 * El nombre de cada archivo lleva su huella (ver fileName), y un video "ya existe" solo si están arriba su
 * .mp4 y su .jpg con ese nombre exacto, igual que en el sitio de verdad.
 *
 * Devuelve { origin, requests, stored, tokens, close }.
 *
 * @param {{ secret: string, items?: Record<string, any>[], date?: string, existing?: string[], planFailures?: { status: number, body?: unknown, headers?: Record<string, string> }[], rejectUploads?: string[], deleted?: number, unreadHistory?: number }} options
 */
export async function startFakeSite({ secret, items = sampleItems(), date = '2026-10-13', existing = [], planFailures = [], rejectUploads = [], deleted = 0, unreadHistory = 0 }) {
  /** @type {{ method: string, path: string, authorization: string | null, contentType: string | null, cacheControl: string | null, upsert: string | null, bytes: number }[]} */
  const requests = []; // todo lo que llegó
  /** @type {Map<string, Buffer>} */
  const stored = new Map(); // archivo -> contenido subido
  /** @type {Map<string, string>} */
  const tokens = new Map(); // archivo -> token de su dirección firmada
  const pendingFailures = [...planFailures];
  let origin = '';

  const signedUrl = (objectPath) => {
    if (!tokens.has(objectPath)) tokens.set(objectPath, fakeToken());
    return `${origin}${UPLOAD_PREFIX}${objectPath}?token=${tokens.get(objectPath)}`;
  };

  const planItem = (item) => {
    const archivo = item.archivo ?? fileName(item, date);
    const yaExiste = item.ya_existe ?? (existing.includes(item.id) || (stored.has(`${archivo}.mp4`) && stored.has(`${archivo}.jpg`)));
    const subir = 'subir' in item ? item.subir : yaExiste ? null : { video: signedUrl(`${archivo}.mp4`), portada: signedUrl(`${archivo}.jpg`) };
    return { ...item, archivo, ya_existe: yaExiste, subir };
  };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, origin);
    const json = (status, body, headers = {}) => {
      res.writeHead(status, { 'content-type': 'application/json', ...headers });
      res.end(JSON.stringify(body));
    };
    const body = await readBody(req);
    requests.push({
      method: req.method,
      path: url.pathname,
      authorization: req.headers.authorization ?? null,
      contentType: req.headers['content-type'] ?? null,
      cacheControl: req.headers['cache-control'] ?? null,
      upsert: req.headers['x-upsert'] ?? null,
      bytes: body.length,
    });

    if (req.method === 'GET' && url.pathname === PLAN_PATH) {
      if (req.headers.authorization !== `Bearer ${secret}`) return json(401, { error: 'Unauthorized' });
      const failure = pendingFailures.shift();
      if (failure) return json(failure.status, failure.body ?? { error: 'falla de prueba' }, failure.headers);
      const asked = Number(url.searchParams.get('n'));
      const count = Number.isInteger(asked) && asked >= 1 ? Math.min(asked, 6) : 4;
      return json(200, {
        ok: true,
        generado: new Date().toISOString(),
        fecha: date,
        sitio: origin,
        historial_sin_leer: unreadHistory,
        borrados: deleted,
        seleccion: items.slice(0, count).map(planItem),
      });
    }

    if (req.method === 'PUT' && url.pathname.startsWith(UPLOAD_PREFIX)) {
      const objectPath = decodeURIComponent(url.pathname.slice(UPLOAD_PREFIX.length));
      const token = url.searchParams.get('token');
      if (!token || tokens.get(objectPath) !== token) return json(400, { statusCode: '403', error: 'Unauthorized', message: 'signature verification failed' });
      if (rejectUploads.some((id) => objectPath.includes(id))) {
        return json(500, { statusCode: '500', error: 'Internal', message: `no se pudo guardar ${origin}${req.url} (token ${token})` });
      }
      if (stored.has(objectPath)) return json(400, { statusCode: '409', error: 'Duplicate', message: 'The resource already exists' });
      stored.set(objectPath, body);
      return json(200, { Key: `reels/${objectPath}` });
    }

    return json(404, { error: 'No existe' });
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;

  return {
    origin,
    requests,
    stored,
    tokens,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
