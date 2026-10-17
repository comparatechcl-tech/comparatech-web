import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

/**
 * /admin/videos dibujada a HTML estático: lo que la página le explica al
 * dueño, lo que trae cada tarjeta y cómo queda anotado en la bitácora. Lo
 * que pasa al tocar (bajar el archivo, compartir, copiar, marcar) está en
 * video-page-gestures.test.tsx, con dobles del navegador.
 */

// Las acciones escriben en la base: acá solo se mira lo que la página dibuja.
vi.mock('@/app/admin/videos/actions', () => ({ markVideoPosted: vi.fn(), undoVideoPosted: vi.fn() }));
// La revisión en vivo consulta Mercado Libre (y su módulo usa cache() de React, que fuera de Next no existe).
vi.mock('@/app/admin/live-price-actions', () => ({ checkLivePrices: vi.fn(async () => ({})) }));
vi.mock('@/lib/supabase/server', () => ({ getSupabaseAdmin: vi.fn(() => ({})) }));
// El tablero se entrega ya armado: el módulo de verdad lee el almacén y la base.
vi.mock('@/lib/social/videos', () => ({
  VIDEO_MARK: 'video',
  VIDEO_NETWORKS: ['instagram', 'tiktok', 'youtube', 'facebook'],
  VIDEO_RULES: { maxPosts: 4, perCategory: 2, minDiscount: 20, minDrop: 5, maxPriceAgeMs: 6 * 3600_000, cleanOnly: true, repeatAfterDays: 14 },
  readVideoBoard: vi.fn(),
}));
vi.mock('@/lib/admin-audit', () => ({ readAdminEvents: vi.fn() }));
vi.mock('next/navigation', () => ({ usePathname: () => '/admin/videos' }));

import ActividadPage from '@/app/admin/actividad/page';
import { AdminTabs } from '@/app/admin/AdminTabs';
import VideosPage, * as videosPageModule from '@/app/admin/videos/page';
import {
  VideoCard,
  VideoList,
  arrange,
  isEverywhere,
  mergePosted,
  shareLabel,
  splitReason,
  type Mark,
  type VideoCardProps,
} from '@/app/admin/videos/VideoList';
import { CHECKING_LINE, SKIPPED_LINE, UNKNOWN_LINE, type LiveEntry } from '@/app/admin/videos/live';
import { fetchVideoFile } from '@/app/admin/videos/wiring';
import { readAdminEvents, type AdminEventRow } from '@/lib/admin-audit';
import { getSupabaseAdmin } from '@/lib/supabase/server';
import { LIVE_TEXT, type LiveCheck } from '@/lib/social/live-price';
import { HISTORY_UNREAD_EXAMPLE, WARNING_GLOSSARY, explainWarning } from '@/lib/social/warning-help';
import { VIDEO_RULES, readVideoBoard, type ReadyVideo, type VideoBoard } from '@/lib/social/videos';

const NOW = new Date('2026-10-13T15:00:00Z');
const STORAGE = 'https://abcd1234.supabase.co/storage/v1/object/public/reels';

/** Palabras que el sitio no usa en nada que se lea. */
const AVOIDED =
  /recomendad|verificad|publicidad|mejor precio|m[aá]s barat|imperdible|ofert[oó]n|solo hoy|[uú]ltimas unidades|antes \$|rebajad|precio normal|ahorra/i;

/** El texto que se lee: sin etiquetas, con las comillas de vuelta. Las etiquetas de énfasis no cortan la frase. */
function text(html: string): string {
  return html
    .replace(/<\/?(?:strong|s|a|em)\b[^>]*>/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ');
}

let seq = 0;
function video(over: Partial<ReadyVideo> = {}): ReadyVideo {
  seq++;
  const id = `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`;
  return {
    id,
    slug: `producto-${seq}`,
    name: `Parlante Bluetooth JBL Go ${seq}`,
    brand: 'JBL',
    price: 49_990,
    listPrice: 99_990,
    discount: 50,
    checkedAt: new Date(NOW.getTime() - 20 * 60_000).toISOString(),
    template: 'estudio',
    videoUrl: `${STORAGE}/2026-10-13/${id}-49990-estudio-0a1b2c3d.mp4`,
    coverUrl: `${STORAGE}/2026-10-13/${id}-49990-estudio-0a1b2c3d.jpg`,
    fileName: `comparatech-producto-${seq}-reel.mp4`,
    renderedAt: '2026-10-13T11:05:00.000Z',
    points: 62.5,
    reason: 'Parlante JBL, 50% de descuento, de tienda oficial',
    link: `https://www.mercadolibre.cl/p/MLC${seq}?matt_word=comparatech`,
    texts: {
      instagram: `Texto de Instagram ${seq}`,
      tiktok: `Texto de TikTok ${seq}`,
      facebook: `Texto de Facebook ${seq}`,
      youtubeTitle: `Título de YouTube ${seq}`,
      youtubeDescription: `Descripción de YouTube ${seq}`,
    },
    posted: {},
    mlUrl: `https://www.mercadolibre.cl/p/MLC${seq}`,
    freeShipping: true,
    full: false,
    ...over,
  };
}

const mark = (postId: number): Mark => ({ postId, at: '2026-10-13T12:00:00.000Z' });
const EVERYWHERE = { instagram: mark(1), tiktok: mark(2), youtube: mark(3), facebook: mark(4) };

function render(videos: ReadyVideo[]): string {
  return renderToStaticMarkup(<VideoList videos={videos} maxPriceAgeMs={6 * 3600_000} renderedAt={NOW.getTime()} />);
}

/** El trozo del HTML que corresponde a una tarjeta: desde su video hasta su link de afiliado. */
function card(html: string, item: ReadyVideo): string {
  const start = html.indexOf(`src="${item.videoUrl}"`);
  const end = html.indexOf(item.link, start);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return html.slice(html.lastIndexOf('<li', start), end);
}

/** Los botones de un trozo de HTML: sus atributos y lo que se lee en cada uno. */
function buttons(html: string): { attrs: string; label: string }[] {
  const found: { attrs: string; label: string }[] = [];
  const re = /<button([^>]*)>([\s\S]*?)<\/button>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    // De los dos textos apilados de un botón de copiar, se lee solo el que no está escondido
    // (escondido para la vista y para el lector de pantalla a la vez).
    const visible = m[2].replace(/<span aria-hidden="true" class="[^"]*\binvisible\b[^"]*">[^<]*<\/span>/g, '');
    found.push({ attrs: m[1], label: text(visible).trim() });
  }
  return found;
}

/** ¿El botón viene apagado? El atributo, no la clase disabled:opacity-50 que llevan todos. */
const isOff = (b: { attrs: string }) => /\sdisabled=""/.test(b.attrs);

/** Un elemento de React ya armado, sin dibujar. */
interface El {
  type: unknown;
  key: string | null;
  props: Record<string, unknown> & { children?: unknown };
}

/** Todos los elementos del árbol que devuelve la página, sin entrar en los componentes. */
function elements(node: unknown, out: El[] = []): El[] {
  if (Array.isArray(node)) for (const child of node) elements(child, out);
  else if (typeof node === 'object' && node !== null && 'props' in node) {
    out.push(node as El);
    elements((node as El).props.children, out);
  }
  return out;
}

function board(over: Partial<VideoBoard> = {}): VideoBoard {
  return { videos: [], stale: 0, hiddenUnread: 0, lastRenderedAt: null, storageReady: true, changedAfterPosting: [], ...over };
}

async function page(): Promise<string> {
  return renderToStaticMarkup(await VideosPage());
}

beforeEach(() => {
  vi.mocked(readVideoBoard).mockReset();
  vi.mocked(readVideoBoard).mockResolvedValue(board());
  vi.mocked(getSupabaseAdmin).mockReset();
  vi.mocked(getSupabaseAdmin).mockReturnValue({} as ReturnType<typeof getSupabaseAdmin>);
});

describe('VideoList: la tarjeta de un video', () => {
  it('trae el video con su portada, en 9:16 y de ancho fijo, sin bajarlo hasta que se le da play', () => {
    const item = video();
    const html = card(render([item]), item);
    const tag = /<video[^>]*>/.exec(html)?.[0] ?? '';
    expect(tag).toContain(`src="${item.videoUrl}"`);
    expect(tag).toContain(`poster="${item.coverUrl}"`);
    expect(tag).toContain('controls=""');
    expect(tag).toContain('playsinline=""');
    expect(tag).toContain('preload="none"');
    expect(tag).not.toContain('autoplay');
    expect(tag).toContain(`aria-label="Video de ${item.name}"`);

    // La caja del video: vertical y de ancho contenido, nunca a todo el ancho.
    const box = /<div class="([^"]*)">\s*<video/.exec(html)?.[1] ?? '';
    expect(box).toContain('aspect-[9/16]');
    expect(box).toMatch(/\bw-36\b/);
    expect(box).toMatch(/\bsm:w-44\b/);
    expect(box).not.toMatch(/\bw-full\b/);
    expect(box).not.toContain('opacity-60');
  });

  it('dice qué es: marca, nombre, precio con la cifra tachada ("sin descuento") y el descuento, el motivo en letra chica y la plantilla', () => {
    const item = video();
    const html = card(render([item]), item);
    const read = text(html);
    expect(read).toContain('JBL');
    expect(read).toContain(item.name);
    expect(read).toContain('$49.990');
    expect(read).toContain('sin descuento $99.990 · -50%');
    expect(read).not.toContain('precio de lista');
    expect(html).toContain('<s>$99.990</s>');
    // Hecho a las 11:05 UTC, que en Chile son las 08:05.
    expect(read).toContain('Plantilla estudio · hecho el 13/10 a las 08:05');

    const at = html.indexOf(`${item.reason}.`);
    expect(at).toBeGreaterThan(0);
    expect(html.slice(0, at)).toMatch(/<p class="[^"]*text-xs[^"]*text-muted[^"]*">$/);
    // Antes de los botones: se lee antes de decidir.
    expect(at).toBeLessThan(html.indexOf('Guardar video'));
  });

  it('si desde que se armó el video apareció algo que mirar, lo dice en una línea aparte que se distingue', () => {
    const clean = video();
    const warned = video({ reason: 'Parlante JBL, 50% de descuento. Ojo: otro vendedor lo ofrece a menos' });
    const html = render([clean, warned]);
    expect(card(html, clean)).not.toContain('Ojo:');

    const mine = card(html, warned);
    const whyAt = mine.indexOf('Parlante JBL, 50% de descuento.');
    const warningAt = mine.indexOf('Ojo: otro vendedor lo ofrece a menos.');
    expect(whyAt).toBeGreaterThan(0);
    expect(warningAt).toBeGreaterThan(whyAt);
    expect(warningAt).toBeLessThan(mine.indexOf('Guardar video'));
    // Otro color, otro peso y un ícono: no pasa por una frase más del motivo.
    const classOf = (at: number) => /<p class="([^"]*)"[^>]*>(?:(?!<p ).)*$/.exec(mine.slice(0, at))?.[1] ?? '';
    expect(classOf(warningAt)).toContain('text-amber-400');
    expect(classOf(whyAt)).toContain('text-muted');
    expect(classOf(whyAt)).not.toContain('amber');
    expect(mine.slice(whyAt, warningAt)).toContain('lucide-triangle-alert');

    expect(splitReason('Parlante JBL')).toEqual({ why: 'Parlante JBL', warning: null });
    expect(splitReason('')).toEqual({ why: '', warning: null });
    expect(splitReason('Parlante JBL. Ojo: la oferta es chica; vendedor con pocas ventas (4)')).toEqual({
      why: 'Parlante JBL',
      warning: 'la oferta es chica; vendedor con pocas ventas (4)',
    });
  });

  it('sin cifra tachada no inventa un descuento', () => {
    const item = video({ listPrice: null, discount: 0 });
    const read = text(card(render([item]), item));
    expect(read).toContain('$49.990');
    expect(read).not.toContain('sin descuento');
    expect(read).not.toContain('lista $');
    expect(read).not.toContain('-0%');
    expect(card(render([item]), item)).not.toContain('<s>');
  });

  it('tiene Guardar video y Copiar link, y el link completo para copiarlo a mano', () => {
    const item = video();
    const html = render([item]);
    const labels = buttons(card(html, item)).map((b) => b.label);
    expect(labels).toContain('Guardar video');
    expect(labels).toContain('Copiar link');
    expect(html).toContain(`aria-label="Link de afiliado">${item.link.replace(/&/g, '&amp;')}</p>`);
    // El video está en otro dominio: no se ofrece con un enlace de descarga, que ahí no funciona.
    expect(html).not.toMatch(/<a[^>]*download/);
    expect(html).not.toContain('blob:');
  });

  it('trae un botón por texto: Instagram, TikTok, Facebook y los dos de YouTube', () => {
    const item = video();
    const html = card(render([item]), item);
    const from = html.indexOf('Copiar texto para:');
    const to = html.indexOf('Subido en:');
    expect(from).toBeGreaterThan(0);
    expect(to).toBeGreaterThan(from);

    const group = buttons(html.slice(from, to));
    expect(group.map((b) => b.label)).toEqual(['Instagram', 'TikTok', 'Facebook', 'YouTube: título', 'YouTube: descripción']);
    // La confirmación ya está en cada botón, escondida: al copiar se muestra sin cambiarle el tamaño.
    expect(html.slice(from, to).split('>Copiado<')).toHaveLength(6);
    // Con textos que copiar, ninguno viene apagado.
    for (const b of group) expect(isOff(b)).toBe(false);
    // Los textos no se escriben en la página: van al portapapeles.
    expect(html).not.toContain(item.texts.instagram);
  });

  it('un texto vacío deja su botón apagado', () => {
    const item = video();
    item.texts = { ...item.texts, youtubeTitle: '' };
    const html = card(render([item]), item);
    const group = buttons(html.slice(html.indexOf('Copiar texto para:'), html.indexOf('Subido en:')));
    expect(group.filter(isOff).map((b) => b.label)).toEqual(['YouTube: título']);
  });

  it('muestra en cuáles de las cuatro redes ya se subió, sin depender del color', () => {
    const item = video({ posted: { instagram: mark(11), youtube: mark(12) } });
    const html = card(render([item]), item);
    const group = html.slice(html.indexOf('Subido en:'));
    const state = buttons(group).map((b) => [b.label, /aria-pressed="(true|false)"/.exec(b.attrs)?.[1]]);
    expect(state).toEqual([
      ['Instagram', 'true'],
      ['TikTok', 'false'],
      ['YouTube', 'true'],
      ['Facebook', 'false'],
    ]);
    // El grupo tiene nombre para quien no ve la pantalla, igual que el de los textos.
    expect(html).toContain(`role="group" aria-labelledby="subido-${item.id}"`);
    expect(html).toContain(`id="subido-${item.id}"`);
    expect(html).toContain(`role="group" aria-labelledby="textos-${item.id}"`);
    expect(html).toContain(`id="textos-${item.id}"`);
    // Subido lleva un visto y pendiente un círculo vacío: dos íconos distintos, no solo otro color.
    const icons = (group.match(/lucide-[a-z-]+/g) ?? []).filter((name) => name !== 'lucide-icon');
    expect(icons).toEqual(['lucide-check', 'lucide-circle', 'lucide-check', 'lucide-circle']);
    expect(text(html)).not.toContain('Ya está en las cuatro redes');
  });

  it('todos los botones miden 44 px de alto o más y ninguno envía un formulario', () => {
    const html = render([video(), video({ posted: EVERYWHERE })]);
    const all = buttons(html);
    // Por tarjeta: guardar, copiar link, cinco textos y cuatro redes.
    expect(all).toHaveLength(22);
    for (const b of all) {
      expect(b.attrs).toMatch(/\bmin-h-11\b/);
      expect(b.attrs).toContain('type="button"');
      expect(b.label).not.toBe('');
    }
  });

  it('Compartir no se dibuja hasta saber que el aparato puede compartir archivos', () => {
    const html = render([video()]);
    expect(buttons(html).map((b) => b.label)).not.toContain('Compartir');
    // Ni el aviso de "aparece en el teléfono", que es para cuando ya se sabe que no puede.
    expect(text(html)).not.toContain('aparece en el teléfono');
  });

  it('cada tarjeta tiene dónde avisar lo que pasa, y la lista dónde anunciar lo copiado', () => {
    const html = render([video(), video()]);
    expect(html.split('role="status"')).toHaveLength(4);
    expect(html).toContain('<p role="status" aria-live="polite" class="sr-only"></p>');
  });
});

describe('VideoList: lo ya subido a las cuatro redes', () => {
  it('va al final, plegado en "Ya subidos a las cuatro redes (N)" y atenuado', () => {
    const done = video({ posted: EVERYWHERE });
    const half = video({ posted: { instagram: mark(21) } });
    const fresh = video();
    const html = render([done, half, fresh]);

    const order = [half, fresh, done].map((item) => html.indexOf(`src="${item.videoUrl}"`));
    expect(order.every((at) => at > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);

    // Plegado: una sección que se abre con el dedo, cerrada al cargar, con cuántos son.
    const fold = /<details class="[^"]*"><summary class="([^"]*)">Ya subidos a las cuatro redes \(1\)<\/summary>/.exec(html);
    expect(fold).not.toBeNull();
    expect(fold?.[1]).toMatch(/\bmin-h-11\b/);
    expect(html).not.toMatch(/<details[^>]* open/);
    expect(html.indexOf('Ya subidos a las cuatro redes')).toBeGreaterThan(html.indexOf(`src="${fresh.videoUrl}"`));
    expect(html.indexOf('Ya subidos a las cuatro redes')).toBeLessThan(html.indexOf(`src="${done.videoUrl}"`));

    const doneCard = card(html, done);
    // Ahí no repite que está en las cuatro: lo dice la sección.
    expect(text(doneCard)).not.toContain('Ya está en las cuatro redes');
    expect(/<div class="([^"]*)">\s*<video/.exec(doneCard)?.[1]).toContain('opacity-60');
    expect(buttons(doneCard.slice(doneCard.indexOf('Subido en:'))).map((b) => /aria-pressed="(\w+)"/.exec(b.attrs)?.[1])).toEqual([
      'true',
      'true',
      'true',
      'true',
    ]);
    // Sigue teniendo todo para compartirlo de nuevo o desmarcar: no se apaga ningún botón.
    for (const b of buttons(doneCard)) expect(isOff(b)).toBe(false);

    for (const item of [half, fresh]) {
      const other = card(html, item);
      expect(text(other)).not.toContain('Ya está en las cuatro redes');
      expect(/<div class="([^"]*)">\s*<video/.exec(other)?.[1]).not.toContain('opacity-60');
    }
  });

  it('arrange reparte en tres grupos sin cambiar el orden dentro de cada uno', () => {
    const warned = (over: Partial<ReadyVideo> = {}) => video({ reason: 'Parlante JBL. Ojo: la oferta es chica', ...over });
    const [a, b, c, d, e, f] = [video({ posted: EVERYWHERE }), video(), warned(), video({ posted: EVERYWHERE }), video(), warned({ posted: EVERYWHERE })];
    const posted: Record<string, ReadyVideo['posted']> = {};
    for (const item of [a, b, c, d, e, f]) posted[item.id] = item.posted;
    const groups = arrange([a, b, c, d, e, f], posted);
    expect(groups.clean.map((item) => item.id)).toEqual([b.id, e.id]);
    expect(groups.warned.map((item) => item.id)).toEqual([c.id]);
    // Lo que ya está en las cuatro va al final aunque traiga un "Ojo": ya no hay que subirlo.
    expect(groups.done.map((item) => item.id)).toEqual([a.id, d.id, f.id]);
    // Un video sin anotación cuenta como pendiente.
    expect(arrange([a, b], {}).clean.map((item) => item.id)).toEqual([a.id, b.id]);
  });

  it('isEverywhere pide las cuatro', () => {
    expect(isEverywhere(EVERYWHERE)).toBe(true);
    expect(isEverywhere({ instagram: mark(1), tiktok: mark(2), youtube: mark(3) })).toBe(false);
    expect(isEverywhere({})).toBe(false);
    expect(isEverywhere(undefined)).toBe(false);
  });
});

describe('mergePosted: lo que trajo el servidor más lo hecho en esta visita', () => {
  it('sin cambios, queda lo del servidor', () => {
    const item = video({ posted: { instagram: mark(31) } });
    expect(mergePosted(item, new Map())).toEqual({ instagram: mark(31) });
  });

  it('lo marcado en la visita se suma y lo desmarcado se quita', () => {
    const item = video({ posted: { instagram: mark(31), tiktok: mark(32) } });
    const changes = new Map<string, Mark | null>([
      [`${item.id}|instagram`, null],
      [`${item.id}|youtube`, mark(40)],
    ]);
    expect(mergePosted(item, changes)).toEqual({ tiktok: mark(32), youtube: mark(40) });
  });

  it('una marca rehecha en la visita reemplaza a la del servidor', () => {
    const item = video({ posted: { facebook: mark(31) } });
    expect(mergePosted(item, new Map([[`${item.id}|facebook`, mark(77)]]))).toEqual({ facebook: mark(77) });
  });

  it('los cambios de otro video no se le aplican', () => {
    const item = video();
    const other = video();
    expect(mergePosted(item, new Map([[`${other.id}|instagram`, mark(50)]]))).toEqual({});
  });
});

describe('Compartir: el archivo se baja con el primer toque', () => {
  it('el botón dice en qué va', () => {
    expect(shareLabel(undefined)).toBe('Compartir');
    expect(shareLabel('cargando')).toBe('Preparando el video…');
    expect(shareLabel('lista')).toBe('Listo: toca para compartir');
    expect(shareLabel('error')).toBe('No se pudo bajar: reintentar');
  });

  const response = (body: string, ok = true) => ({ ok, status: ok ? 200 : 503, blob: async () => new Blob([body]) }) as unknown as Response;

  it('entrega el archivo con su nombre y como video/mp4, diga lo que diga el almacén', async () => {
    const fetcher = vi.fn(async () => response('contenido del video'));
    const file = await fetchVideoFile(`${STORAGE}/a.mp4`, 'comparatech-parlante-reel.mp4', fetcher as unknown as typeof fetch);
    expect(file).toBeInstanceOf(File);
    expect(file?.name).toBe('comparatech-parlante-reel.mp4');
    expect(file?.type).toBe('video/mp4');
    expect(await file?.text()).toBe('contenido del video');
    // Una sola llamada, a la dirección del video y sin nada más (ni credenciales ni cabeceras).
    expect(fetcher.mock.calls).toEqual([[`${STORAGE}/a.mp4`]]);
  });

  it('si la descarga se corta, lo intenta una vez más', async () => {
    const fetcher = vi
      .fn<() => Promise<Response>>()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(response('ahora sí'));
    const file = await fetchVideoFile('https://x.test/a.mp4', 'a.mp4', fetcher as unknown as typeof fetch);
    expect(await file?.text()).toBe('ahora sí');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('con dos fallas avisa que no pudo, sin insistir más', async () => {
    const down = vi.fn(async () => response('', false));
    expect(await fetchVideoFile('https://x.test/a.mp4', 'a.mp4', down as unknown as typeof fetch)).toBeNull();
    expect(down).toHaveBeenCalledTimes(2);

    // Un archivo vacío tampoco sirve: compartirlo abriría la app con un video que no existe.
    const empty = vi.fn(async () => response(''));
    expect(await fetchVideoFile('https://x.test/a.mp4', 'a.mp4', empty as unknown as typeof fetch)).toBeNull();
    expect(empty).toHaveBeenCalledTimes(2);
  });
});

describe('/admin/videos: lo que la página le explica al dueño', () => {
  it('trae el título, una frase corta y Actualizar como enlace común', async () => {
    const html = await page();
    expect(html).toContain('<h1 class="font-heading text-2xl font-bold text-fg">Videos de hoy</h1>');
    expect(html).toMatch(/<a href="\/admin\/videos" class="[^"]*\bmin-h-11\b[^"]*">Actualizar<\/a>/);
  });

  it('explica el método completo, en seis pasos numerados: mirar la revisión y copiar el texto antes de Compartir', async () => {
    const html = await page();
    const list = /<ol[^>]*>([\s\S]*?)<\/ol>/.exec(html);
    expect(list?.[0]).toContain('list-decimal');
    const steps = (list?.[1] ?? '').split('</li>').slice(0, -1).map((step) => text(step).trim());
    expect(steps).toEqual([
      'Elige uno o dos videos al día. Para una cuenta que parte de cero vale más subir uno todos los días que muchos de una vez.',
      // Antes de copiar nada: el texto y el video llevan el precio escrito.
      'Mira la línea bajo el precio. Si dice ✓ Mismo precio que en Mercado Libre, súbelo. Si dice en rojo que cambió, no lo subas y toca Actualizar. Si no pude revisar, toca Ver en Mercado Libre y compara el precio antes de subirlo.',
      // Antes de Compartir: Compartir manda solo el archivo, y en la app ya no hay de dónde copiar.
      'Copia el texto de la red donde lo vas a subir, con su botón: queda copiado en el teléfono.',
      // Las cuatro redes de la tarjeta, Facebook incluida.
      'Toca Compartir y elige Instagram (Reel), TikTok, YouTube o Facebook. Sube este mismo archivo a cada red: un video bajado de otra red lleva su marca de agua y se muestra menos.',
      'En la app, pega el texto y ponle un audio de la biblioteca de la app: los videos en silencio se muestran menos. En TikTok activa "Contenido comercial" y elige "Contenido de marca".',
      'Marca en qué redes lo subiste: lo que ya subiste no se vuelve a sugerir en 14 días.',
    ]);
  });

  it('avisa que el reel no lleva link, que el del perfil ya lleva a Lo de hoy y para qué sirve Copiar link', async () => {
    const html = await page();
    expect(text(html)).toContain(
      'Un reel no lleva link que se pueda tocar. El link de tu perfil ya lleva a la página Lo de hoy del sitio, donde aparecen los productos de los videos que marcas como subidos: no lo cambies. Copiar link sirve para el sticker de la historia de este producto.'
    );
    // La página Lo de hoy queda a un toque, para mirar que el producto esté.
    expect(html).toMatch(/<a[^>]*href="\/hoy"[^>]*>Lo de hoy<\/a>/);
    // No manda a la pestaña Historias: llevan otra selección y el producto del reel puede no estar ahí.
    expect(html).not.toContain('href="/admin/historias"');
    // Después del método y antes de la lista.
    expect(html.indexOf('Un reel no lleva link')).toBeGreaterThan(html.indexOf('</ol>'));
  });

  it('es dinámica: se arma en cada visita, no una vez al construir el sitio', () => {
    expect(videosPageModule.dynamic).toBe('force-dynamic');
  });

  it('le pasa a la lista el plazo del precio y la hora de esta carga, que además es su key', async () => {
    vi.mocked(readVideoBoard).mockResolvedValue(board({ videos: [video(), video()] }));
    const before = Date.now();
    const lists = elements(await VideosPage()).filter((el) => el.type === VideoList);
    expect(lists).toHaveLength(1);
    const [list] = lists;
    // El plazo es el de las reglas: con otro, la lista nunca daría un precio por viejo.
    expect(list.props.maxPriceAgeMs).toBe(6 * 3600_000);
    expect(list.props.maxPriceAgeMs).toBe(VIDEO_RULES.maxPriceAgeMs);
    // La hora de la carga identifica la visita (lo marcado al volver con "atrás")...
    expect(list.props.renderedAt).toBeGreaterThanOrEqual(before);
    expect(list.props.renderedAt).toBeLessThanOrEqual(Date.now());
    // ...y es la key: con datos nuevos del servidor la lista se monta de cero y los toma.
    expect(list.key).toBe(String(list.props.renderedAt));
    // La misma hora con que se leyó el tablero.
    expect(vi.mocked(readVideoBoard).mock.calls[0][1].getTime()).toBe(list.props.renderedAt);
  });

  it('con videos, dibuja la lista', async () => {
    const items = [video(), video()];
    vi.mocked(readVideoBoard).mockResolvedValue(board({ videos: items, lastRenderedAt: '2026-10-13T11:05:00.000Z' }));
    const html = await page();
    for (const item of items) expect(html).toContain(`src="${item.videoUrl}"`);
    expect(html.split('<video')).toHaveLength(3);
    expect(text(html)).not.toContain('Ahora no hay videos listos');
    expect(text(html)).not.toMatch(AVOIDED);
    // La lista va después de la explicación.
    expect(html.indexOf('<video')).toBeGreaterThan(html.indexOf('Un reel no lleva link'));
  });

  it('sin videos, dice que aparecen cuando una pasada los arma, sin horas escritas a mano', async () => {
    const read = text(await page());
    expect(read).toContain(
      'Ahora no hay videos listos. Aparecen acá cuando una pasada los arma. Vuelve a mirar después de la próxima pasada.'
    );
    // La hora ya está arriba, calculada: el aviso no la repite ni la escribe fija.
    expect(read).not.toContain('cerca de las 8, las 13 y las 18');
    expect(read).not.toContain('tres veces al día');
    expect(read).not.toContain('Todavía no se ha generado');
    expect(read).not.toMatch(AVOIDED);
  });

  it('si el almacén todavía no existe, dice que no se ha generado el primero', async () => {
    vi.mocked(readVideoBoard).mockResolvedValue(board({ storageReady: false }));
    const read = text(await page());
    expect(read).toContain('Todavía no se ha generado el primer video. Aparecen acá cuando una pasada los arma.');
    expect(read).not.toContain('Vuelve a mirar después de la próxima pasada');
    expect(read).not.toContain('Ahora no hay videos listos');
    expect(read).not.toContain('Último video generado');
  });

  it('cuenta los videos que dejaron de mostrarse, en singular y en plural, sin prometer que se rehacen', async () => {
    vi.mocked(readVideoBoard).mockResolvedValue(board({ videos: [video()], stale: 3 }));
    const many = text(await page());
    expect(many).toContain(
      '3 videos ya no se muestran porque el producto cambió (de precio, de oferta o salió del sitio). Si no lo habías marcado en ninguna red y sigue entre los sugeridos, se arma uno nuevo en una próxima pasada; si ya lo marcaste en alguna, no se vuelve a armar en 14 días.'
    );

    vi.mocked(readVideoBoard).mockResolvedValue(board({ stale: 1 }));
    const one = text(await page());
    expect(one).toContain(
      '1 video ya no se muestra porque el producto cambió (de precio, de oferta o salió del sitio). Si no lo habías marcado en ninguna red y sigue entre los sugeridos, se arma uno nuevo en una próxima pasada; si ya lo marcaste en alguna, no se vuelve a armar en 14 días.'
    );
    // Sin videos vigentes se ven los dos mensajes: por qué no hay y cuándo vuelven.
    expect(one).toContain('Ahora no hay videos listos');

    // Lo que no se rehace (ya subido, fuera del sitio, sin oferta que alcance) no se promete.
    for (const read of [many, one]) {
      expect(read).not.toMatch(/se rehacen? solos?/);
      expect(read).not.toMatch(/qued(ó|aron) viejos?/);
      expect(read).not.toMatch(AVOIDED);
    }

    vi.mocked(readVideoBoard).mockResolvedValue(board({ videos: [video()] }));
    expect(text(await page())).not.toMatch(/ya no se muestran?/);
  });

  describe('los videos que no se muestran porque no se pudo revisar su historial de precios', () => {
    const MANY = '3 videos no se muestran ahora porque no se pudo revisar su historial de precios. Vuelve a mirar en unos minutos.';
    const ONE = '1 video no se muestra ahora porque no se pudo revisar su historial de precios. Vuelve a mirar en unos minutos.';

    it('los cuenta, en plural y en singular, y no dice que no hay videos', async () => {
      vi.mocked(readVideoBoard).mockResolvedValue(board({ hiddenUnread: 3 }));
      const many = text(await page());
      expect(many).toContain(MANY);

      vi.mocked(readVideoBoard).mockResolvedValue(board({ hiddenUnread: 1 }));
      const one = text(await page());
      expect(one).toContain(ONE);
      expect(one).not.toContain('1 videos');

      for (const read of [many, one]) {
        // Sí hay videos: decir que no hay, o que se vuelva "más tarde", contradiría el aviso.
        expect(read).not.toContain('Ahora no hay videos listos');
        expect(read).not.toContain('Vuelve a mirar después de la próxima pasada');
        expect(read).not.toContain('Todavía no se ha generado');
        // No es un video que cambió: no se mezcla con el aviso de los que ya no se muestran.
        expect(read).not.toContain('porque el producto cambió');
        expect(read).not.toMatch(AVOIDED);
        // El método sigue a la vista.
        expect(read).toContain('Elige uno o dos videos al día');
      }
    });

    it('con cero no dice nada y vuelve lo de siempre', async () => {
      const read = text(await page());
      expect(read).not.toContain('historial de precios');
      expect(read).toContain('Ahora no hay videos listos.');
      expect(read).toContain('Vuelve a mirar después de la próxima pasada.');
    });

    it('un número que no es mayor que cero no se cuenta', async () => {
      for (const hiddenUnread of [-2, Number.NaN]) {
        vi.mocked(readVideoBoard).mockResolvedValue(board({ hiddenUnread }));
        const read = text(await page());
        expect(read).not.toContain('historial de precios');
        expect(read).toContain('Ahora no hay videos listos.');
      }
    });

    it('con otros videos a la vista, el aviso va antes de la lista y la lista sigue', async () => {
      const items = [video(), video()];
      vi.mocked(readVideoBoard).mockResolvedValue(board({ videos: items, hiddenUnread: 3 }));
      const html = await page();
      const at = html.indexOf('no se pudo revisar su historial de precios');
      expect(at).toBeGreaterThan(html.indexOf('Un reel no lleva link'));
      expect(at).toBeLessThan(html.indexOf('<video'));
      for (const item of items) expect(html).toContain(`src="${item.videoUrl}"`);
      expect(text(html)).toContain(MANY);
    });

    it('junto al aviso de los que cambiaron, se ven los dos, cada uno con su número', async () => {
      vi.mocked(readVideoBoard).mockResolvedValue(board({ stale: 2, hiddenUnread: 1 }));
      const read = text(await page());
      expect(read).toContain(ONE);
      expect(read).toContain('2 videos ya no se muestran porque el producto cambió');
      expect(read).not.toContain('Ahora no hay videos listos');
    });

    it('si no se pudo leer el tablero, no inventa videos escondidos', async () => {
      vi.mocked(readVideoBoard).mockRejectedValue(new Error('se cayó'));
      expect(text(await page())).not.toContain('historial de precios');
    });
  });

  it('al pie dice cuándo se generó el último, en hora de Chile, y con qué criterio se eligen', async () => {
    vi.mocked(readVideoBoard).mockResolvedValue(board({ videos: [video()], lastRenderedAt: '2026-10-13T21:40:00.000Z' }));
    const html = await page();
    const foot = text(html.slice(html.lastIndexOf('<p class="mt-6 text-xs text-muted">')));
    // 21:40 UTC son las 18:40 en Chile.
    expect(foot).toContain('Último video generado el 13/10 a las 18:40.');
    expect(foot).toContain('Se eligen por lo que más puede interesar');
    expect(foot).toContain('qué es, la marca, qué tan comprobada está la oferta y que el precio esté al alcance');
    expect(foot).toContain('lo que figura entre los más vendidos de Mercado Libre');
    expect(foot).toContain('lo que recibe más clics en el sitio');
    expect(foot).toContain('Solo ofertas sin avisos y con el precio revisado en las últimas 6 horas');
    // No solo el precio: también lo que el video dice de la oferta (precio de lista, descuento, envío).
    expect(foot).toContain('Si un producto cambia de precio o de oferta, su video deja de mostrarse');
    // Un aviso que aparece después de armado el video no contradice lo anterior: se explica.
    expect(foot).toContain('si después de armado aparece algo que mirar, la tarjeta lo dice con un "Ojo"');
    expect(foot).not.toMatch(AVOIDED);
    // El pie va después de la lista.
    expect(html.lastIndexOf('<p class="mt-6 text-xs text-muted">')).toBeGreaterThan(html.lastIndexOf('</video>'));
  });

  it('un video de la medianoche chilena lleva la fecha de Chile, no la de UTC', async () => {
    // 02:30 UTC del 14 son las 23:30 del 13 en Chile.
    vi.mocked(readVideoBoard).mockResolvedValue(board({ lastRenderedAt: '2026-10-14T02:30:00.000Z' }));
    expect(text(await page())).toContain('Último video generado el 13/10 a las 23:30.');
  });

  it('si no se pudo leer, lo dice y no afirma que no hay videos', async () => {
    vi.mocked(readVideoBoard).mockRejectedValue(new Error('No se pudo leer el almacén: se cayó'));
    const html = await page();
    expect(html).toContain('role="alert"');
    const read = text(html);
    expect(read).toContain('No se pudieron leer los videos: No se pudo leer el almacén: se cayó');
    expect(read).not.toContain('Ahora no hay videos listos');
    expect(read).not.toContain('Todavía no se ha generado');
    // El método sigue a la vista.
    expect(read).toContain('Elige uno o dos videos al día');
  });

  it('sin Supabase lo dice y no intenta leer', async () => {
    vi.mocked(getSupabaseAdmin).mockReturnValue(null);
    expect(text(await page())).toContain('No se pudieron leer los videos: Supabase admin no configurado');
    expect(vi.mocked(readVideoBoard)).not.toHaveBeenCalled();
  });

  it('lee el tablero una vez, con la hora de este momento', async () => {
    const before = Date.now();
    await page();
    expect(vi.mocked(readVideoBoard)).toHaveBeenCalledTimes(1);
    const at = vi.mocked(readVideoBoard).mock.calls[0][1];
    expect(at).toBeInstanceOf(Date);
    expect(at.getTime()).toBeGreaterThanOrEqual(before);
    expect(at.getTime()).toBeLessThanOrEqual(Date.now());
  });
});

describe('la pestaña Videos', () => {
  it('va después de Historias y antes de Problemas, y se marca como la página actual', () => {
    const html = renderToStaticMarkup(<AdminTabs pending={0} problems={0} />);
    const labels = (html.match(/<a[^>]*>[^<]+/g) ?? []).map((a) => a.replace(/<a[^>]*>/, ''));
    expect(labels).toEqual(['Resumen', 'Candidatos', 'Productos', 'Historias', 'Videos', 'Problemas', 'Métricas', 'Actividad', 'Configuración']);
    expect(html).toMatch(/<a[^>]*aria-current="page"[^>]*href="\/admin\/videos"[^>]*>Videos|<a[^>]*href="\/admin\/videos"[^>]*aria-current="page"[^>]*>Videos/);
    expect(html.split('aria-current="page"')).toHaveLength(2);
  });
});

describe('/admin/actividad: las marcas de video en la bitácora', () => {
  const PRODUCT = '00000000-0000-4000-8000-0000000000aa';
  let id = 0;
  const event = (after: unknown, target: string | null = PRODUCT): AdminEventRow => ({
    id: ++id,
    at: '2026-10-13T14:00:00.000Z',
    actor: 'cristopher',
    action: 'marcar_rrss',
    target,
    before: null,
    after,
  });

  async function lines(rows: AdminEventRow[]): Promise<string[]> {
    vi.mocked(readAdminEvents).mockResolvedValue({ ok: true, rows });
    const html = renderToStaticMarkup(await ActividadPage({ searchParams: Promise.resolve({}) }));
    return (html.match(/<p class="text-sm text-fg">[\s\S]*?<\/p>/g) ?? []).map((line) => text(line).trim());
  }

  it('dice que se marcó un video como subido, y en qué red', async () => {
    const out = await lines([
      event({ video: 'subido', red: 'tiktok', precio: 49_990 }),
      event({ video: 'subido', red: 'youtube', precio: 49_990 }),
      event({ video: 'subido', red: 'instagram', precio: 49_990 }, null),
    ]);
    expect(out[0]).toMatch(new RegExp(`cristopher · marcó un video como subido a TikTok · ${PRODUCT}$`));
    expect(out[1]).toMatch(new RegExp(`marcó un video como subido a YouTube · ${PRODUCT}$`));
    expect(out[2]).toMatch(/marcó un video como subido a Instagram$/);
  });

  it('dice que se deshizo la marca de un video', async () => {
    const out = await lines([event({ video: 'deshecho', red: 'facebook' })]);
    expect(out[0]).toMatch(new RegExp(`deshizo la marca de un video en Facebook · ${PRODUCT}$`));
  });

  it('un registro sin red, o con una que no conoce, no rompe la línea', async () => {
    const out = await lines([
      event({ video: 'subido' }),
      event({ video: 'subido', red: 'constructor' }),
      event({ video: 'deshecho', red: 42 }),
    ]);
    expect(out[0]).toContain('marcó un video como subido a una red');
    expect(out[1]).toContain('marcó un video como subido a una red');
    expect(out[2]).toContain('deshizo la marca de un video en una red');
  });

  it('las historias y los cambios del feed se siguen describiendo como antes', async () => {
    const out = await lines([
      event({ historia: 'publicada', precio: 49_990 }),
      event({ historia: 'deshecha' }),
      event({ rrss_status: 'publicado' }),
    ]);
    expect(out[0]).toContain('marcó una historia como publicada');
    expect(out[1]).toContain('deshizo la marca de una historia');
    expect(out[2]).toContain('cambió el estado en redes de un producto');
    for (const line of out) expect(line).not.toContain('video');
  });
});

// ---------------------------------------------------------------------------
// La revisión en vivo en la tarjeta, dibujada a HTML estático.

const T = NOW.getTime();
const MIN = 60_000;

/** Lo que dijo la revisión en vivo, llegado a la hora `at` del reloj del teléfono. */
const answered = (check: LiveCheck, at = T, checking = false): LiveEntry => ({ result: { check, at }, checking });
const SAME = (at = T, checking = false) => answered({ status: 'same', checkedAt: new Date(at).toISOString() }, at, checking);
const CHANGED = (saved: boolean) =>
  answered({
    status: 'changed',
    checkedAt: new Date(T).toISOString(),
    price: 45_990,
    listPrice: 99_990,
    freeShipping: true,
    full: false,
    saved,
    what: 'El precio cambió de $49.990 a $45.990.',
  });
const UNAVAILABLE = () => answered({ status: 'unavailable', checkedAt: new Date(T).toISOString(), what: LIVE_TEXT.notGreen });
const UNKNOWN = (what: string = LIVE_TEXT.mlDown) => answered({ status: 'unknown', what });

const cardGestures: VideoCardProps['gestures'] = {
  share: vi.fn(),
  save: vi.fn(),
  copy: vi.fn(async () => {}),
  toggle: vi.fn(),
};

/** Una tarjeta sola, en el estado que se pida. Por omisión: sin revisión todavía y en un teléfono que comparte. */
function drawCard(over: Partial<VideoCardProps> = {}): string {
  const item = over.video ?? video();
  return renderToStaticMarkup(
    <VideoCard
      video={item}
      posted={{}}
      fileState={undefined}
      saving={false}
      canShare
      copied={null}
      busy={null}
      note={undefined}
      manual={undefined}
      gestures={cardGestures}
      live={undefined}
      now={T}
      {...over}
    />
  );
}

/** La clase del último párrafo que se abre antes de `needle`: así se sabe de qué color va. */
function classBefore(html: string, needle: string): string {
  const at = html.indexOf(needle);
  expect(at, needle).toBeGreaterThanOrEqual(0);
  const open = html.lastIndexOf('<p ', at);
  const tag = html.slice(open, html.indexOf('>', open));
  return /class="([^"]*)"/.exec(tag)?.[1] ?? '';
}

/** La etiqueta de apertura del enlace que lleva el texto `label`. */
function anchorOf(html: string, label: string): string {
  const at = html.indexOf(label);
  expect(at, label).toBeGreaterThanOrEqual(0);
  const open = html.lastIndexOf('<a ', at);
  return html.slice(open, html.indexOf('>', open) + 1);
}

describe('VideoCard: la línea de la revisión en vivo, junto al precio', () => {
  it('sin respuesta todavía: "Revisando en Mercado Libre…", en gris y con la rueda', () => {
    const html = drawCard();
    expect(html).toContain(CHECKING_LINE);
    expect(classBefore(html, CHECKING_LINE)).toContain('text-muted');
    expect(html).toMatch(/animate-spin[^>]*><path[^>]*><\/path><\/svg><span>Revisando en Mercado Libre…<\/span>/);
    // El reproductor está: todavía no se sabe que algo cambió.
    expect(html).toContain('<video');
  });

  it('mismo precio reciente: en verde, con hace cuánto, y avisa si está revisando de nuevo', () => {
    const html = drawCard({ live: SAME(T - 3 * MIN) });
    const line = '✓ Mismo precio que en Mercado Libre (hace 3 min)';
    expect(html).toContain(line);
    expect(classBefore(html, line)).toContain('text-accent');
    expect(drawCard({ live: SAME(T - 3 * MIN, true) })).toContain(`${line} · revisando de nuevo…`);
  });

  it('mismo precio de más de 15 minutos: ya no va en verde sino en ámbar, y dice que se revisa al tocar Compartir', () => {
    const html = drawCard({ live: SAME(T - 20 * MIN) });
    const line = 'Mismo precio hace 20 min: como pasaron más de 15 minutos, lo reviso de nuevo al tocar Compartir.';
    expect(html).toContain(line);
    expect(html).not.toContain('✓');
    expect(classBefore(html, line)).toContain('text-amber-400');
    // A los 15 justos todavía es verde; y si ya está revisando de nuevo, lo dice.
    expect(drawCard({ live: SAME(T - 15 * MIN) })).toContain('✓ Mismo precio que en Mercado Libre (hace 15 min)');
    expect(drawCard({ live: SAME(T - 20 * MIN, true) })).toContain(CHECKING_LINE);
  });

  it('cambió y el sitio ya lo tiene: en rojo, que no lo suba, y el reproductor se reemplaza por el aviso', () => {
    const item = video();
    const html = drawCard({ video: item, live: CHANGED(true) });
    const line = '✗ El precio cambió de $49.990 a $45.990. No lo subas: toca Actualizar. El sitio ya tiene el precio nuevo.';
    expect(html).toContain(line);
    expect(classBefore(html, line)).toContain('text-red-400');
    // Sin reproductor: desde su menú se podría bajar el video igual.
    expect(html).not.toContain('<video');
    expect(html).not.toContain(`src="${item.videoUrl}"`);
    expect(html).toContain(`role="img" aria-label="Video de ${item.name}: ya no calza con Mercado Libre"`);
    expect(html).toContain('Ya no calza con Mercado Libre. No lo subas: toca Actualizar.');
    // La portada queda de fondo, apagada.
    expect(html).toMatch(new RegExp(`<img src="${item.coverUrl.replace(/[.?]/g, '\\$&')}" alt="" class="[^"]*opacity-20`));
  });

  it('cambió sin quedar guardado: no dice que el sitio lo tiene', () => {
    const html = drawCard({ live: CHANGED(false) });
    expect(html).toContain('✗ El precio cambió de $49.990 a $45.990. No lo subas: toca Actualizar.');
    expect(html).not.toContain('El sitio ya tiene el precio nuevo');
  });

  it('ya no está a la venta en Mercado Libre: en rojo y sin reproductor', () => {
    const html = drawCard({ live: UNAVAILABLE() });
    const line = '✗ Ya no está a la venta con un vendedor de reputación verde. No lo subas: toca Actualizar.';
    expect(html).toContain(line);
    expect(classBefore(html, line)).toContain('text-red-400');
    expect(html).not.toContain('<video');
  });

  it('no se pudo revisar: en ámbar, y el motivo del servidor en letra chica si agrega algo', () => {
    const offline = drawCard({ live: UNKNOWN(LIVE_TEXT.offline) });
    expect(offline).toContain(UNKNOWN_LINE);
    expect(classBefore(offline, UNKNOWN_LINE)).toContain('text-amber-400');
    expect(offline).toContain(`<span class="text-muted"> ${LIVE_TEXT.offline}</span>`);
    // El reproductor sigue: no se sabe que algo cambió.
    expect(offline).toContain('<video');

    const down = drawCard({ live: UNKNOWN(LIVE_TEXT.mlDown) });
    expect(down).toContain(UNKNOWN_LINE);
    expect(down).not.toContain(LIVE_TEXT.mlDown);
  });

  it('ya en las cuatro redes desde hace más de un día: no se revisa, y lo dice en ámbar', () => {
    const html = drawCard({ live: { result: null, checking: false, skipped: true } });
    expect(html).toContain(SKIPPED_LINE);
    expect(classBefore(html, SKIPPED_LINE)).toContain('text-amber-400');
  });

  it('con el precio cambiado no ofrece abrir el video directo, aunque la descarga haya fallado', () => {
    const note = { tone: 'error' as const, text: 'No se pudo bajar el video.', openVideo: true };
    expect(drawCard({ note })).toContain('Abrir el video');
    expect(drawCard({ note, live: CHANGED(false) })).not.toContain('Abrir el video');
    expect(drawCard({ note, live: UNAVAILABLE() })).not.toContain('Abrir el video');
  });
});

describe('VideoCard: el botón "Ver en Mercado Libre"', () => {
  it('es un enlace común a la ficha limpia: pestaña nueva, sin referer y del alto de un dedo', () => {
    const item = video();
    const tag = anchorOf(drawCard({ video: item }), 'Ver en Mercado Libre');
    expect(tag).toContain(`href="${item.mlUrl}"`);
    expect(tag).toContain('target="_blank"');
    expect(tag).toContain('rel="noopener noreferrer"');
    expect(tag).toMatch(/\bmin-h-11\b/);
    // Nunca el link de afiliado: abrirlo para mirar contaría como clic.
    expect(tag).not.toMatch(/matt_|meli\.la|\/api\/e/);
    expect(tag).not.toContain(item.link.replace(/&/g, '&amp;'));
  });

  it('una dirección con parámetros se limpia, y una que no es de Mercado Libre no se enlaza', () => {
    const dirty = drawCard({ video: video({ mlUrl: 'https://www.mercadolibre.cl/p/MLC88?matt_word=comparatech' }) });
    expect(anchorOf(dirty, 'Ver en Mercado Libre')).toContain('href="https://www.mercadolibre.cl/p/MLC88"');
    for (const mlUrl of ['https://evil.example.com/p/MLC1', 'javascript:alert(1)', 'http://www.mercadolibre.cl/p/MLC1', null]) {
      expect(drawCard({ video: video({ mlUrl }) }), String(mlUrl)).not.toContain('Ver en Mercado Libre');
    }
  });

  it('va también cuando el precio cambió: es justo cuando más sirve mirar', () => {
    expect(drawCard({ live: CHANGED(false) })).toContain('Ver en Mercado Libre');
  });
});

describe('VideoCard: el "Ojo" con su explicación', () => {
  it('bajo el aviso, qué significa cada parte y qué hacer', () => {
    const warning = 'vendedor con pocas ventas (4); el precio cambió 3 veces en dos días';
    const html = drawCard({ video: video({ reason: `Parlante JBL, 50% de descuento. Ojo: ${warning}` }) });
    const read = text(html);
    expect(read).toContain(`Ojo: ${warning}.`);
    const help = explainWarning(warning);
    expect(help.map((h) => h.kind)).toEqual(['vendedor', 'precio']);
    for (const h of help) expect(read).toContain(`${h.meaning} ${h.whatToDo}`);
    expect(read).toContain('El vendedor que aparece primero lleva 4 ventas y no es tienda oficial.');
    expect(html.indexOf(help[1].meaning)).toBeLessThan(html.indexOf('Guardar video'));
  });

  it('sin aviso no hay explicación', () => {
    const html = drawCard();
    for (const entry of WARNING_GLOSSARY) expect(text(html)).not.toContain(entry.whatToDo);
  });

  it('subido a las cuatro redes durante la visita: lo dice; ya en la sección de subidos, no lo repite', () => {
    expect(text(drawCard({ posted: EVERYWHERE }))).toContain('Ya está en las cuatro redes. Al tocar Actualizar pasa abajo, a los ya subidos.');
    expect(text(drawCard({ posted: EVERYWHERE, settled: true }))).not.toContain('Ya está en las cuatro redes');
  });
});

describe('VideoList: los grupos', () => {
  it('los que traen un "Ojo" van después, en "Con algo que mirar", con qué hacer', () => {
    const clean = video();
    const warned = video({ reason: 'Parlante JBL, 50% de descuento. Ojo: la oferta es chica' });
    const html = render([warned, clean]);
    expect(html.indexOf(`src="${clean.videoUrl}"`)).toBeLessThan(html.indexOf('Con algo que mirar'));
    expect(html.indexOf('Con algo que mirar')).toBeLessThan(html.indexOf(`src="${warned.videoUrl}"`));
    expect(text(html)).toContain(
      'Después de armar estos videos apareció un "Ojo". Lee lo que dice y mira el precio con el botón antes de subirlos.'
    );
  });

  it('sin avisos ni subidos a todo, no hay secciones aparte', () => {
    const html = render([video(), video()]);
    expect(html).not.toContain('Con algo que mirar');
    expect(html).not.toContain('Ya subidos a las cuatro redes');
    expect(html).not.toContain('<details');
  });

  it('al cargar, cada tarjeta dice que se está revisando', () => {
    const html = render([video(), video()]);
    expect(html.split(CHECKING_LINE)).toHaveLength(3);
  });
});

describe('/admin/videos: cuándo hay videos nuevos', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  /** La página como la arma el servidor a la hora `at`. */
  async function pageAt(at: string): Promise<string> {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(at));
    return text(await page());
  }

  const LINE = (when: string) =>
    `Los videos se arman solos 6 veces al día, unas cada 3 horas de día. Próxima pasada: ${when}, aunque GitHub suele atrasarla entre 1 y 4 horas. Para que entren productos nuevos, marca en qué redes subiste los de hoy: lo marcado deja su lugar al siguiente.`;

  it('dice la próxima pasada en hora de Chile, calculada del horario de GitHub', async () => {
    // 10:30 de Chile en verano: la próxima es la de las 13:10.
    expect(await pageAt('2026-10-17T13:30:00Z')).toContain(LINE('programada a las 13:10'));
  });

  it('de noche, la próxima es la de mañana temprano, y lo dice', async () => {
    // 22:30 de Chile: la de las 22:10 ya pasó.
    expect(await pageAt('2026-10-18T01:30:00Z')).toContain(LINE('programada a las 07:10 de mañana'));
    // 21:30 de Chile: todavía queda la de las 22:10, que en UTC ya es el día siguiente.
    expect(await pageAt('2026-10-18T00:30:00Z')).toContain(LINE('programada a las 22:10'));
    // Pasada la medianoche de Chile, la de las 07:10 es de hoy.
    expect(await pageAt('2026-10-17T03:30:00Z')).toContain(LINE('programada a las 07:10'));
  });

  it('en invierno las mismas pasadas caen una hora antes en Chile', async () => {
    expect(await pageAt('2026-06-17T09:00:00Z')).toContain(LINE('programada a las 06:10'));
  });

  it('va arriba, antes de los pasos, y no escribe horas fijas', async () => {
    vi.mocked(readVideoBoard).mockResolvedValue(board({ videos: [video()] }));
    const html = await page();
    expect(html.indexOf('Próxima pasada')).toBeGreaterThan(0);
    expect(html.indexOf('Próxima pasada')).toBeLessThan(html.indexOf('<ol'));
    expect(text(html)).not.toMatch(/cerca de las 8|las 13 y las 18|tres veces al día/);
  });
});

describe('/admin/videos: lo ya subido cuyo precio cambió', () => {
  const at = '2026-10-13T12:00:00.000Z';

  it('lo avisa arriba y en rojo, uno por producto y precio marcado, con qué hacer en cada red', async () => {
    vi.mocked(readVideoBoard).mockResolvedValue(
      board({
        videos: [video()],
        changedAfterPosting: [
          { productId: 'p1', name: 'Parlante JBL Go 4', networks: ['instagram', 'tiktok'], postedPrice: 49_990, price: 54_990, at },
          { productId: 'p2', name: 'Audífonos Sony WH-CH520', networks: ['youtube'], postedPrice: 89_990, price: null, at },
          { productId: 'p3', name: null, networks: ['instagram', 'tiktok', 'youtube', 'facebook'], postedPrice: 19_990, price: null, at },
        ],
      })
    );
    const html = await page();
    const block = /<div role="alert" class="([^"]*)">([\s\S]*?)<\/div>/.exec(html);
    expect(block?.[1]).toContain('border-red-500/40');
    expect(block?.[1]).toContain('text-red-400');
    const read = text(block?.[2] ?? '');
    expect(read).toContain(
      'Subiste Parlante JBL Go 4 en Instagram y TikTok a $49.990 y ahora está más caro, a $54.990: bórralo o archívalo en esa red.'
    );
    expect(read).toContain('Subiste Audífonos Sony WH-CH520 en YouTube a $89.990 y ya no está a la venta: bórralo o archívalo en esa red.');
    expect(read).toContain(
      'Subiste un producto que ya no está en el sitio en Instagram, TikTok, YouTube y Facebook a $19.990 y ya no está a la venta: bórralo o archívalo en esa red.'
    );
    expect(read).toContain(
      'Un video subido no se puede editar: lo que promete un precio más bajo que el de ahora hay que sacarlo de esa red. Si bajó de precio no hace falta: no se avisa.'
    );
    expect((block?.[2] ?? '').split('<li')).toHaveLength(4);
    // Arriba: antes de los pasos y de la lista.
    expect(html.indexOf('role="alert"')).toBeLessThan(html.indexOf('<ol'));
    expect(html.indexOf('role="alert"')).toBeLessThan(html.indexOf('<video'));
  });

  it('sin nada que avisar no hay bloque rojo', async () => {
    vi.mocked(readVideoBoard).mockResolvedValue(board({ videos: [video()] }));
    const html = await page();
    expect(html).not.toContain('role="alert"');
    expect(html).not.toContain('Subiste ');
  });

  it('un tablero viejo sin la lista no rompe la página', async () => {
    const old = board({ videos: [video()] }) as Partial<VideoBoard>;
    delete old.changedAfterPosting;
    vi.mocked(readVideoBoard).mockResolvedValue(old as VideoBoard);
    const html = await page();
    expect(html).not.toContain('role="alert"');
    expect(html).toContain('<video');
  });
});

describe('/admin/videos: "¿Qué significa cada aviso?"', () => {
  it('va plegada al final, sin el aviso del historial que en Videos nunca aparece', async () => {
    vi.mocked(readVideoBoard).mockResolvedValue(board({ videos: [video()] }));
    const html = await page();
    expect(html).toMatch(/<details class="mt-6 [^"]*"><summary[^>]*>¿Qué significa cada aviso\?<\/summary>/);
    const read = text(html);
    expect(read).not.toContain(`"${HISTORY_UNREAD_EXAMPLE}"`);
    for (const entry of WARNING_GLOSSARY) {
      if (entry.example === HISTORY_UNREAD_EXAMPLE) expect(read).not.toContain(entry.meaning);
      else expect(read, entry.example).toContain(`"${entry.example}"`);
    }
    // Después de la lista.
    expect(html.indexOf('¿Qué significa cada aviso?')).toBeGreaterThan(html.lastIndexOf('</video>'));
  });

  it('si no se pudo leer el tablero, no se muestra', async () => {
    vi.mocked(readVideoBoard).mockRejectedValue(new Error('se cayó'));
    expect(await page()).not.toContain('¿Qué significa cada aviso?');
  });
});
