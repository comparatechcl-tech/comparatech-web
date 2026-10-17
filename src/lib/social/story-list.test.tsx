import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

// Las acciones escriben en la base (y la revisión en vivo consulta Mercado Libre): acá solo se mira lo que la página dibuja.
vi.mock('@/app/admin/historias/actions', () => ({ markStoryPublished: vi.fn(), undoStoryPublished: vi.fn() }));
vi.mock('@/app/admin/live-price-actions', () => ({ checkLivePrices: vi.fn(async () => ({})) }));
vi.mock('@/lib/supabase/server', () => ({ getSupabaseAdmin: () => ({}) }));
vi.mock('@/lib/queries/price-history', () => {
  const getPriceStatsMany = vi.fn(async (_ids: string[]) => new Map());
  // La lectura que avisa lo que no pudo leer se arma sobre la misma de mentira: acá se lee todo.
  const getPriceStatsManyChecked = async (ids: string[]) => ({ stats: await getPriceStatsMany(ids), unread: new Set<string>() });
  return { getPriceStatsMany, getPriceStatsManyChecked };
});
// lib/settings usa cache() de React, que solo existe dentro de Next.
vi.mock('@/lib/settings', () => ({ readAffiliateSettings: vi.fn() }));
// Las listas se entregan ya armadas.
vi.mock('@/lib/social/stories', async (original) => ({
  ...(await original<typeof import('@/lib/social/stories')>()),
  readStoryPicks: vi.fn(async () => Object.assign([], { waiting: 0 })),
  readPostedStories: vi.fn(async () => []),
}));

import HistoriasPage from '@/app/admin/historias/page';
import { StoryCard, StoryList, checkSummary, type StoryCardProps } from '@/app/admin/historias/StoryList';
import type { StoryGestures } from '@/app/admin/historias/gestures';
import { CHECKING_LINE, UNKNOWN_LINE, UNKNOWN_LINE_NO_BUTTON, type CardCheck } from '@/app/admin/historias/rules';
import { formatPrice } from '@/lib/content/captions';
import { chileTime, nextPriceRefresh } from '@/lib/social/content-timing';
import { LIVE_TEXT, type LiveCheck } from '@/lib/social/live-price';
import { readPostedStories, readStoryPicks, type PostedStory, type StoryItem } from '@/lib/social/stories';
import { HISTORY_UNREAD_EXAMPLE, WARNING_GLOSSARY, explainWarning } from '@/lib/social/warning-help';

const NOW = new Date('2026-10-12T15:00:00Z');

let seq = 0;
function story(over: Partial<StoryItem> = {}): StoryItem {
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
    drop: null,
    checkedAt: new Date(NOW.getTime() - 20 * 60_000).toISOString(),
    again: null,
    reason: 'Parlante JBL, 50% de descuento, de tienda oficial',
    warning: null,
    points: 62.5,
    image: `/social/pieza/${id}/story-49990-99990-1-1-1-abc.jpg`,
    link: `https://www.mercadolibre.cl/p/MLC${seq}?matt_word=comparatech`,
    fileName: `comparatech-producto-${seq}-historia.jpg`,
    mlUrl: `https://www.mercadolibre.cl/p/MLC${seq}`,
    freeShipping: true,
    full: false,
    ...over,
  };
}

/** Lo que entrega readStoryPicks: la lista con cuántas más esperan pegado. */
const picks = (items: StoryItem[], waiting = 0) => Object.assign(items, { waiting });

function render(items: StoryItem[], posted: PostedStory[] = []): string {
  return renderToStaticMarkup(
    <StoryList items={items} posted={posted} maxPriceAgeMs={6 * 3600_000} renderedAt={NOW.getTime()} />
  );
}

/** El trozo del HTML que corresponde a una tarjeta: desde su nombre hasta su link de afiliado. */
function card(html: string, item: StoryItem): string {
  const start = html.indexOf(item.name);
  const end = html.indexOf(item.link, start);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return html.slice(start, end);
}

describe('StoryList: el motivo y el aviso en la tarjeta', () => {
  it('cada oferta dice, bajo el nombre y en letra chica, por qué se propone', () => {
    const item = story();
    const html = card(render([item]), item);
    const at = html.indexOf(`${item.reason}.`);
    expect(at).toBeGreaterThan(0);
    expect(html.slice(0, at)).toMatch(/<p class="[^"]*text-xs[^"]*">$/);
    // Antes de los botones: se lee antes de decidir.
    expect(at).toBeLessThan(html.indexOf('Copiar link'));
    expect(at).toBeLessThan(html.indexOf('Ya la publiqué'));
  });

  it('si hay algo que mirar, lo dice en una línea aparte que se distingue: "Ojo: …"', () => {
    const item = story({ warning: 'hace poco estuvo a $44.990; otro vendedor lo ofrece a menos' });
    const html = card(render([item]), item);
    const reasonAt = html.indexOf(`${item.reason}.`);
    const warningAt = html.indexOf('Ojo: hace poco estuvo a $44.990; otro vendedor lo ofrece a menos.');
    expect(warningAt).toBeGreaterThan(reasonAt);
    expect(warningAt).toBeLessThan(html.indexOf('Copiar link'));

    // Otro color y otro peso que el motivo.
    const classOf = (at: number) => /<p class="([^"]*)"[^>]*>(?:(?!<p ).)*$/.exec(html.slice(0, at))?.[1] ?? '';
    expect(classOf(warningAt)).toContain('text-amber-400');
    expect(classOf(reasonAt)).toContain('text-muted');
    expect(classOf(reasonAt)).not.toContain('amber');
  });

  it('sin aviso no hay línea de "Ojo"', () => {
    const item = story();
    expect(render([item])).not.toContain('Ojo:');
  });

  it('el aviso es de su tarjeta y no de la vecina', () => {
    const clean = story();
    const warned = story({ warning: 'vendedor con pocas ventas (4)' });
    const html = render([clean, warned]);
    expect(card(html, clean)).not.toContain('Ojo:');
    expect(card(html, warned)).toContain('Ojo: vendedor con pocas ventas (4).');
  });

  it('la tarjeta conserva lo que ya hacía: precio, link, copiar, guardar y marcar', () => {
    const item = story({ again: { price: 59_990, at: '2026-10-09T12:00:00.000Z' } });
    const html = render([item]);
    for (const text of ['$49.990', '-50%', 'Copiar link', 'Guardar imagen', 'Ya la publiqué', 'Ya la subiste el', item.link]) {
      expect(html).toContain(text);
    }
    expect(html).toContain('Bajaron desde que las subiste');
    // La cifra tachada se rotula "sin descuento", no "lista".
    expect(html).toContain('sin descuento <s>$99.990</s>');
    expect(html).not.toContain('lista <s>');
    // La miniatura y "Guardar imagen" usan la dirección firmada de la pieza, nunca una dirección blob:.
    expect(html).not.toContain('blob:');
  });

  it('las ya publicadas no llevan motivo ni aviso', () => {
    const offer = story({ warning: 'la oferta es chica' });
    const done: PostedStory = {
      ...story({ reason: '', warning: null, points: 0 }),
      postId: 77,
      postedAt: '2026-10-12T13:00:00.000Z',
      postedPrice: 49_990,
      onSale: true,
    };
    const html = render([offer], [done]);
    const postedCard = card(html, done);
    expect(postedCard).toContain('Subida a Instagram el');
    expect(postedCard).toContain('No la publiqué: deshacer');
    expect(postedCard).not.toContain('Ojo:');
    expect(postedCard).not.toContain(offer.reason);
    // Una sola línea de "Ojo" en toda la página: la de la oferta.
    expect(html.split('Ojo:')).toHaveLength(2);
  });
});

describe('/admin/historias: lo que la página le explica al dueño', () => {
  /** Palabras que el sitio no usa en nada que se lea. */
  const AVOIDED =
    /recomendad|verificad|publicidad|mejor precio|m[aá]s barat|imperdible|ofert[oó]n|solo hoy|[uú]ltimas unidades|antes \$|rebajad|precio normal|ahorra/i;
  const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

  beforeAll(() => {
    vi.stubEnv('CRON_SECRET', 'un-secreto-de-prueba-de-mas-de-32-caracteres');
  });
  afterAll(() => {
    vi.unstubAllEnvs();
  });

  it('el pie dice el criterio nuevo: interés, no comisión', async () => {
    vi.mocked(readStoryPicks).mockResolvedValueOnce(picks([story({ warning: 'la oferta es chica' })]));
    const page = text(renderToStaticMarkup(await HistoriasPage()));
    expect(page).toContain('primero las que más pueden interesar');
    expect(page).toContain('lo que la gente busca y reconoce');
    expect(page).toContain('Una por tipo de producto y dos por marca');
    expect(page).toContain('nunca más de dos por categoría');
    expect(page).not.toMatch(/comisi[oó]n dejan/);
    expect(page).not.toMatch(AVOIDED);
  });

  it('sin ofertas, la explicación sigue siendo cierta con el piso de interés', async () => {
    const page = text(renderToStaticMarkup(await HistoriasPage()));
    expect(page).toContain('Ahora no hay ofertas para mostrar');
    expect(page).toContain('20% o más de descuento');
    expect(page).not.toContain('precio de lista');
    // El piso de interés y la exclusión también pueden dejar la lista vacía.
    expect(page).toContain('Tampoco muestro las que le interesarían a poca gente');
    expect(page).toContain('las que hace poco costaban bastante menos');
    expect(page).not.toMatch(AVOIDED);
  });
});

// ---------------------------------------------------------------------------
// La revisión en vivo en cada tarjeta, dibujada a HTML estático.

const MINUTE = 60_000;
const T = NOW.getTime();

/** Una respuesta de la revisión en vivo, llegada a la hora `at` del reloj del teléfono. */
const answered = (result: LiveCheck, at = T, pending = false): CardCheck => ({ last: { result, at }, pending });
const SAME = (at = T, pending = false) => answered({ status: 'same', checkedAt: new Date(at).toISOString() }, at, pending);
const CHANGED = (saved: boolean, at = T, price = 45_990) =>
  answered(
    {
      status: 'changed',
      checkedAt: new Date(at).toISOString(),
      price,
      listPrice: 99_990,
      freeShipping: true,
      full: false,
      saved,
      what: `El precio cambió de $49.990 a ${formatPrice(price)}.`,
    },
    at
  );
const UNAVAILABLE = (at = T) =>
  answered({ status: 'unavailable', checkedAt: new Date(at).toISOString(), what: LIVE_TEXT.notGreen }, at);
const UNKNOWN = (what: string = LIVE_TEXT.mlDown, at = T) => answered({ status: 'unknown', what }, at);

const noop = () => {};
const gestures: StoryGestures = {
  share: vi.fn(noop),
  save: vi.fn(() => true),
  copyLink: vi.fn(async () => {}),
  mark: vi.fn(noop),
  undoOffer: vi.fn(noop),
  undoPosted: vi.fn(noop),
};

/** Una tarjeta sola, en el estado que se pida. Por omisión: oferta con la imagen lista, en un teléfono que comparte. */
function drawCard(over: Partial<StoryCardProps> = {}): string {
  const item = over.item ?? story();
  return renderToStaticMarkup(
    <StoryCard
      item={item}
      kind="offer"
      cardKey={item.id}
      fileState="lista"
      check={undefined}
      now={T}
      openedAt={T - 5 * MINUTE}
      maxPriceAgeMs={6 * 3600_000}
      canShare
      copied={null}
      busy={null}
      note={undefined}
      gestures={gestures}
      {...over}
    />
  );
}

/** Una historia ya subida: por omisión, hace dos horas, al mismo precio de ahora y a la venta. */
function postedStory(over: Partial<PostedStory> = {}): PostedStory {
  return {
    ...story({ reason: '', warning: null, points: 0 }),
    postId: 900 + seq,
    postedAt: new Date(T - 2 * 3600_000).toISOString(),
    postedPrice: 49_990,
    onSale: true,
    ...over,
  };
}

/** El texto que se lee: sin etiquetas y con las comillas de vuelta. */
const read = (html: string) =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ');

/** La clase del último párrafo que se abre antes de `text`: así se sabe de qué color va. */
function classBefore(html: string, text: string): string {
  const at = html.indexOf(text);
  expect(at, text).toBeGreaterThanOrEqual(0);
  const before = html.slice(0, at);
  const open = before.lastIndexOf('<p class="');
  return before.slice(open + 10, before.indexOf('"', open + 10));
}

/** La etiqueta de apertura (enlace o botón) que lleva el texto `label`. */
function tagOf(html: string, label: string): string {
  const at = html.indexOf(label);
  expect(at, label).toBeGreaterThanOrEqual(0);
  const before = html.slice(0, at);
  const start = Math.max(before.lastIndexOf('<a '), before.lastIndexOf('<button'));
  return before.slice(start, before.indexOf('>', start) + 1);
}

describe('StoryCard: la línea de la revisión en vivo, junto al precio', () => {
  it('mientras se revisa: "Revisando en Mercado Libre…", en gris y con la rueda', () => {
    for (const check of [undefined, { last: null, pending: true }]) {
      const html = drawCard({ check });
      expect(html).toContain(CHECKING_LINE);
      expect(classBefore(html, CHECKING_LINE)).toContain('text-muted');
      expect(html).toMatch(/animate-spin[^>]*><path[^>]*><\/path><\/svg><span>Revisando en Mercado Libre…<\/span>/);
    }
  });

  it('mismo precio reciente: en verde, con hace cuánto', () => {
    const html = drawCard({ check: SAME(T - 3 * MINUTE) });
    const line = '✓ Mismo precio que en Mercado Libre (hace 3 min)';
    expect(html).toContain(line);
    expect(classBefore(html, line)).toContain('text-accent');
    // Recién llegado: "hace menos de 1 min".
    expect(drawCard({ check: SAME(T - 20_000) })).toContain('✓ Mismo precio que en Mercado Libre (hace menos de 1 min)');
  });

  it('mismo precio de más de 15 minutos: ya no va en verde sino en ámbar, y dice que se revisa de nuevo', () => {
    const html = drawCard({ check: SAME(T - 20 * MINUTE) });
    const line = 'Mismo precio hace 20 min: como pasaron más de 15 minutos, lo reviso de nuevo al tocar Compartir.';
    expect(html).toContain(line);
    expect(html).not.toContain('✓');
    expect(classBefore(html, line)).toContain('text-amber-400');
    // A los 15 justos todavía vale.
    expect(drawCard({ check: SAME(T - 15 * MINUTE) })).toContain('✓ Mismo precio que en Mercado Libre (hace 15 min)');
    // Si ya se está revisando de nuevo, dice eso.
    expect(drawCard({ check: SAME(T - 20 * MINUTE, true) })).toContain(CHECKING_LINE);
  });

  it('cambió y el sitio ya lo guardó: en rojo, que no la suba, y que el sitio ya tiene el precio nuevo', () => {
    const html = drawCard({ check: CHANGED(true) });
    const line = '✗ El precio cambió de $49.990 a $45.990. No la subas: toca Actualizar. El sitio ya tiene el precio nuevo.';
    expect(html).toContain(line);
    expect(classBefore(html, line)).toContain('text-red-400');
    expect(html).not.toContain('Ya guardé');
  });

  it('cambió sin que quedara guardado: no dice que el sitio lo tiene', () => {
    const html = drawCard({ check: CHANGED(false) });
    expect(html).toContain('✗ El precio cambió de $49.990 a $45.990. No la subas: toca Actualizar.');
    expect(html).not.toContain('El sitio ya tiene el precio nuevo');
  });

  it('ya no está a la venta en Mercado Libre: en rojo, con el motivo', () => {
    const html = drawCard({ check: UNAVAILABLE() });
    const line = '✗ Ya no está a la venta con un vendedor de reputación verde. No la subas: toca Actualizar.';
    expect(html).toContain(line);
    expect(classBefore(html, line)).toContain('text-red-400');
    expect(html).not.toContain('El sitio ya tiene el precio nuevo');
  });

  it('no se pudo revisar: en ámbar, que mire el precio con el botón, y el motivo del servidor si agrega algo', () => {
    const offline = drawCard({ check: UNKNOWN(LIVE_TEXT.offline) });
    expect(offline).toContain(UNKNOWN_LINE);
    expect(classBefore(offline, UNKNOWN_LINE)).toContain('text-amber-400');
    // En el PC del dueño la revisión no corre: lo dice debajo, en letra chica.
    expect(offline).toContain(LIVE_TEXT.offline);
    expect(classBefore(offline, LIVE_TEXT.offline)).toContain('text-muted');

    // "No pude revisar Mercado Libre ahora" no agrega nada a la línea: no se repite.
    const down = drawCard({ check: UNKNOWN(LIVE_TEXT.mlDown) });
    expect(down).toContain(UNKNOWN_LINE);
    expect(down).not.toContain(LIVE_TEXT.mlDown);

    // Sin la ficha no hay botón: la línea no lo nombra.
    const noButton = drawCard({ item: story({ mlUrl: null }), check: UNKNOWN(LIVE_TEXT.noMl) });
    expect(noButton).toContain(UNKNOWN_LINE_NO_BUTTON);
    expect(noButton).not.toContain('Ver en Mercado Libre');
    expect(noButton).toContain(LIVE_TEXT.noMl);
  });
});

describe('StoryCard: el botón "Ver en Mercado Libre"', () => {
  it('es un enlace común a la ficha limpia: pestaña nueva, sin referer y del alto de un dedo', () => {
    const item = story();
    const tag = tagOf(drawCard({ item }), 'Ver en Mercado Libre');
    expect(tag).toContain(`href="${item.mlUrl}"`);
    expect(tag).toContain('target="_blank"');
    expect(tag).toContain('rel="noopener noreferrer"');
    expect(tag).toContain('min-h-11');
    // Nunca el link de afiliado: abrirlo para mirar contaría como clic.
    expect(tag).not.toMatch(/matt_|meli\.la|\/api\/e/);
  });

  it('una dirección con parámetros se limpia, y una que no es de Mercado Libre no se enlaza', () => {
    const dirty = drawCard({ item: story({ mlUrl: 'https://www.mercadolibre.cl/p/MLC77?matt_word=comparatech&matt_tool=1#x' }) });
    expect(tagOf(dirty, 'Ver en Mercado Libre')).toContain('href="https://www.mercadolibre.cl/p/MLC77"');
    expect(dirty).not.toContain('href="https://www.mercadolibre.cl/p/MLC77?');

    for (const mlUrl of ['https://evil.example.com/p/MLC1', 'javascript:alert(1)', 'http://www.mercadolibre.cl/p/MLC1', '', null]) {
      expect(drawCard({ item: story({ mlUrl }) }), String(mlUrl)).not.toContain('Ver en Mercado Libre');
    }
  });
});

describe('StoryCard: Guardar imagen y la miniatura según la revisión', () => {
  it('con "mismo precio" reciente, Guardar imagen es un enlace de descarga de la pieza', () => {
    const item = story();
    const tag = tagOf(drawCard({ item, check: SAME(T - MINUTE) }), 'Guardar imagen');
    expect(tag).toMatch(/^<a /);
    expect(tag).toContain(`href="${item.image}"`);
    expect(tag).toContain(`download="${item.fileName}"`);
  });

  it('bloqueado, Guardar imagen es un botón que dice por qué (un enlace igual se podría descargar con el dedo)', () => {
    for (const check of [CHANGED(true), UNAVAILABLE(), SAME(T - 20 * MINUTE), { last: null, pending: true }, undefined]) {
      const html = drawCard({ check });
      expect(tagOf(html, 'Guardar imagen')).toMatch(/^<button type="button"/);
      expect(html).not.toContain(' download=');
    }
    // Sin "mismo precio" y con la lista de más de una hora, tampoco.
    const old = drawCard({ check: UNKNOWN(), openedAt: T - 61 * MINUTE });
    expect(tagOf(old, 'Guardar imagen')).toMatch(/^<button/);
  });

  it('sin poder revisar y dentro de la regla de siempre, se deja guardar', () => {
    const html = drawCard({ check: UNKNOWN(LIVE_TEXT.offline), openedAt: T - 59 * MINUTE });
    expect(tagOf(html, 'Guardar imagen')).toMatch(/^<a /);
  });

  it('mientras la imagen no está lista, el botón está apagado', () => {
    const html = drawCard({ check: SAME(), fileState: 'cargando' });
    expect(tagOf(html, 'Guardar imagen')).toMatch(/^<button type="button" disabled=""/);
    expect(html).toContain('Preparando…');
  });

  it('si cambió, la miniatura queda tapada con el aviso y no se puede arrastrar', () => {
    const html = drawCard({ check: CHANGED(false) });
    expect(html).toContain('Cambió en Mercado Libre: no la guardes ni la subas.');
    expect(html).toMatch(/<img [^>]*class="[^"]*pointer-events-none select-none opacity-30[^"]*"[^>]*draggable="false"/);
    // Con "mismo precio" se ve la imagen tal cual.
    const ok = drawCard({ check: SAME() });
    expect(ok).not.toContain('pointer-events-none');
    expect(ok).not.toContain('Cambió en Mercado Libre');
  });

  it('con la lista vieja sin revisión, la miniatura pide actualizar antes de guardarla', () => {
    const html = drawCard({ check: UNKNOWN(), openedAt: T - 61 * MINUTE });
    expect(html).toContain('Toca Actualizar antes de guardarla.');
  });

  it('Compartir aparece solo en un aparato que comparte archivos', () => {
    expect(drawCard({ check: SAME() })).toContain('Compartir');
    expect(drawCard({ check: SAME(), canShare: false })).not.toContain('Compartir');
    expect(drawCard({ check: SAME(), canShare: null })).not.toContain('Compartir');
  });
});

describe('StoryCard: el "Ojo" con su explicación', () => {
  it('bajo el aviso, qué significa cada parte y qué hacer', () => {
    const warning = 'hace poco estuvo a $44.990; otro vendedor lo ofrece a menos';
    const html = drawCard({ item: story({ warning }), check: SAME() });
    const text = read(html);
    expect(text).toContain(`Ojo: ${warning}.`);
    const help = explainWarning(warning);
    expect(help).toHaveLength(2);
    for (const h of help) {
      expect(text).toContain(h.meaning);
      expect(text).toContain(h.whatToDo);
    }
    expect(text).toContain('En los últimos 30 días el sitio lo vio a $44.990, más bajo que hoy.');
    // La explicación va después del aviso y antes de los botones.
    expect(html.indexOf(help[0].meaning)).toBeGreaterThan(html.indexOf('Ojo:'));
    expect(html.indexOf(help[1].meaning)).toBeLessThan(html.indexOf('Copiar link'));
  });

  it('sin aviso no hay explicación', () => {
    const html = drawCard({ item: story(), check: SAME() });
    expect(html).not.toContain('Ojo:');
    for (const entry of WARNING_GLOSSARY) expect(html).not.toContain(entry.meaning);
  });
});

describe('StoryCard: una historia ya subida cuyo precio cambió', () => {
  it('ahora más cara (1% o más): aviso rojo para borrarla o subirla de nuevo', () => {
    const item = postedStory({ price: 52_990 });
    const html = drawCard({ item, kind: 'posted', cardKey: `publicada-${item.postId}`, check: SAME() });
    const alert = 'Tu historia en Instagram dice $49.990 y ahora está más cara, a $52.990: bórrala o súbela de nuevo.';
    expect(html).toContain(alert);
    expect(classBefore(html, alert)).toContain('border-red-500/40');
    expect(classBefore(html, alert)).toContain('text-red-400');
    expect(html).toContain('Subida a Instagram el 12/10 a las 10:00, a $49.990.');
  });

  it('la revisión en vivo manda sobre el precio de la base: si encontró uno más caro, ese es el que se avisa', () => {
    const item = postedStory({ price: 49_990 });
    const html = drawCard({ item, kind: 'posted', check: CHANGED(false, T, 54_990) });
    expect(html).toContain('Tu historia en Instagram dice $49.990 y ahora está más cara, a $54.990: bórrala o súbela de nuevo.');
  });

  it('ahora más barata (3% o más): se avisa sin rojo, que se puede subir de nuevo', () => {
    const item = postedStory({ price: 45_990 });
    const html = drawCard({ item, kind: 'posted', check: SAME() });
    const alert = 'Tu historia dice $49.990 y ahora está más barata, a $45.990: puedes subirla de nuevo con la imagen de ahora.';
    expect(html).toContain(alert);
    expect(classBefore(html, alert)).toContain('text-accent');
    expect(classBefore(html, alert)).not.toContain('red');
  });

  it('un cambio chico no se avisa (menos de 1% arriba o de 3% abajo)', () => {
    for (const price of [49_990, 50_400, 48_600]) {
      const html = drawCard({ item: postedStory({ price }), kind: 'posted', check: SAME() });
      expect(html, String(price)).not.toContain('Tu historia');
    }
  });

  it('si Mercado Libre dice que ya no está a la venta, aviso rojo para borrarla', () => {
    const html = drawCard({ item: postedStory(), kind: 'posted', check: UNAVAILABLE() });
    expect(html).toContain('Tu historia en Instagram dice $49.990 y ya no está a la venta: bórrala.');
  });

  it('ya no está a la venta en el sitio: sin imagen ni botones para subirla, sin revisión, y el aviso rojo', () => {
    const item = postedStory({ onSale: false });
    const html = drawCard({ item, kind: 'posted', cardKey: `publicada-${item.postId}`, check: undefined });
    const alert = 'Tu historia en Instagram dice $49.990 y ya no está a la venta: bórrala.';
    expect(html).toContain(alert);
    expect(classBefore(html, alert)).toContain('text-red-400');
    // La imagen se reemplaza por el aviso, y nada invita a subirla.
    expect(html).toContain('Ya no está a la venta.');
    expect(html).not.toContain('<img');
    for (const absent of ['Compartir', 'Copiar link', 'Guardar imagen', item.link, CHECKING_LINE, 'Mismo precio']) {
      expect(html, absent).not.toContain(absent);
    }
    // Deshacer la marca sigue a mano.
    expect(html).toContain('No la publiqué: deshacer');

    // Sin precio anotado, el aviso igual pide borrarla.
    const noPrice = drawCard({ item: postedStory({ onSale: false, postedPrice: null }), kind: 'posted' });
    expect(noPrice).toContain('El producto de tu historia en Instagram ya no está a la venta: bórrala.');
  });

  it('a la venta y con el mismo precio, se comparte de nuevo como una oferta', () => {
    const item = postedStory();
    const html = drawCard({ item, kind: 'posted', check: SAME() });
    for (const present of ['Compartir', 'Copiar link', 'Guardar imagen', item.link, '✓ Mismo precio que en Mercado Libre']) {
      expect(html, present).toContain(present);
    }
    expect(html).not.toContain('Tu historia');
  });
});

describe('checkSummary: la línea de arriba', () => {
  it('mientras falta alguna respuesta, dice que está revisando', () => {
    expect(checkSummary({}, T)).toEqual({ running: true, text: 'Revisando los precios en Mercado Libre…' });
    expect(checkSummary({ a: SAME(), b: { last: null, pending: true } }, T).running).toBe(true);
    expect(checkSummary({ a: SAME(T, true) }, T).running).toBe(true);
  });

  it('sin ninguna respuesta y sin nada viajando, no dice que revisó', () => {
    expect(checkSummary({ a: { last: null, pending: false } }, T)).toEqual({
      running: false,
      text: 'Todavía no reviso los precios en Mercado Libre.',
    });
  });

  it('todo "no pude revisar" no es "revisé": en el PC lo dice así, y si no, que no pudo', () => {
    const offline = checkSummary({ a: UNKNOWN(LIVE_TEXT.offline), b: UNKNOWN(LIVE_TEXT.offline) }, T + 2 * MINUTE);
    expect(offline).toEqual({
      running: false,
      text: 'Aquí no reviso en vivo: eso funciona solo en el sitio publicado. Mira cada precio con su botón antes de subir.',
    });
    const down = checkSummary({ a: UNKNOWN(LIVE_TEXT.mlDown), b: UNKNOWN(LIVE_TEXT.mlSlow) }, T);
    expect(down).toEqual({
      running: false,
      text: 'No pude revisar los precios en Mercado Libre. Mira cada precio con su botón antes de subir.',
    });
    for (const summary of [offline, down]) expect(summary.text).not.toContain('Revisé');
  });

  it('con respuestas de verdad, dice hace cuánto (la más nueva) y cuántas no se pudieron revisar', () => {
    expect(checkSummary({ a: SAME(T - 4 * MINUTE), b: CHANGED(true, T - 2 * MINUTE) }, T).text).toBe(
      'Revisé los precios en Mercado Libre hace 2 min.'
    );
    expect(checkSummary({ a: SAME(T - MINUTE), b: UNKNOWN() }, T).text).toBe(
      'Revisé los precios en Mercado Libre hace 1 min. Una no se pudo revisar: mira su precio con el botón.'
    );
    expect(checkSummary({ a: UNAVAILABLE(T), b: UNKNOWN(), c: UNKNOWN(LIVE_TEXT.mlSlow) }, T + 30_000).text).toBe(
      'Revisé los precios en Mercado Libre hace menos de 1 min. 2 no se pudieron revisar: mira su precio con el botón.'
    );
  });
});

describe('StoryList: los grupos y la línea de arriba', () => {
  it('al cargar dice que está revisando, sin el botón de revisar otra vez', () => {
    const html = render([story()]);
    expect(html).toContain('Revisando los precios en Mercado Libre…');
    expect(html).not.toContain('Revisar otra vez');
    // Cada tarjeta también: todavía no llega la respuesta.
    expect(html).toContain(CHECKING_LINE);
  });

  it('las que traen un "Ojo" van al final, en "Con algo que mirar", con la lista plegada de los avisos', () => {
    const fresh = story();
    const warned = story({ warning: 'vendedor con pocas ventas (4)' });
    const again = story({ again: { price: 59_990, at: '2026-10-09T12:00:00.000Z' } });
    const html = render([warned, fresh, again]);
    const order = [again, fresh, warned].map((item) => html.indexOf(item.name));
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(html.indexOf('Con algo que mirar')).toBeLessThan(html.indexOf(warned.name));
    expect(html.indexOf('Con algo que mirar')).toBeGreaterThan(html.indexOf(fresh.name));
    // La guía de avisos, plegada y con todos los avisos (en Historias sí puede salir el del historial).
    expect(html).toMatch(/<details[^>]*><summary[^>]*>¿Qué significa cada aviso\?<\/summary>/);
    expect(html).not.toMatch(/<details[^>]* open/);
    expect(read(html)).toContain(`"${HISTORY_UNREAD_EXAMPLE}"`);
    for (const entry of WARNING_GLOSSARY) expect(read(html)).toContain(entry.meaning);
  });

  it('sin avisos no aparece el grupo ni la guía', () => {
    const html = render([story(), story()]);
    expect(html).not.toContain('Con algo que mirar');
    expect(html).not.toContain('¿Qué significa cada aviso?');
  });

  it('las ya publicadas van en su sección, que dice qué hacer con un aviso rojo', () => {
    const done = postedStory({ price: 52_990 });
    const html = render([story()], [done]);
    expect(html).toContain('Ya publicadas (últimas 24 horas)');
    expect(read(html)).toContain(
      'Si una dice en rojo que ahora está más cara o que ya no está a la venta, borra esa historia de Instagram.'
    );
    expect(html).toContain('Tu historia en Instagram dice $49.990 y ahora está más cara, a $52.990: bórrala o súbela de nuevo.');
  });
});

describe('/admin/historias: cuándo hay historias nuevas y cómo se marca', () => {
  beforeAll(() => {
    vi.stubEnv('CRON_SECRET', 'un-secreto-de-prueba-de-mas-de-32-caracteres');
  });
  afterAll(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  /** La página como la arma el servidor a la hora `at`. */
  async function pageAt(at: string): Promise<string> {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(at));
    try {
      return read(renderToStaticMarkup(await HistoriasPage()));
    } finally {
      vi.useRealTimers();
    }
  }

  it('dice la hora de la próxima revisión de precios, calculada y en hora de Chile', async () => {
    vi.mocked(readStoryPicks).mockResolvedValueOnce(picks([story()], 3));
    // 10:10 de Chile (verano): la próxima revisión es la de las 10:30.
    const page = await pageAt('2026-10-17T13:10:00Z');
    expect(chileTime(nextPriceRefresh(new Date('2026-10-17T13:10:00Z')))).toBe('10:30');
    expect(page).toContain(
      'Cuándo hay historias nuevas: la lista se calcula cada vez que tocas Actualizar. Los precios se revisan cada 30 minutos (la próxima revisión, cerca de las 10:30).'
    );
    expect(page).toContain('Hay 3 ofertas más esperando: marca las que ya subiste y toca Actualizar para verlas.');
  });

  it('en invierno la hora también sale bien (Chile a UTC-4)', async () => {
    vi.mocked(readStoryPicks).mockResolvedValueOnce(picks([story()], 1));
    const page = await pageAt('2026-06-17T15:45:00Z');
    expect(page).toContain('la próxima revisión, cerca de las 12:00).');
    expect(page).toContain('Hay 1 oferta más esperando: marca las que ya subiste y toca Actualizar para verla.');
  });

  it('sin más ofertas esperando lo dice de otra forma', async () => {
    vi.mocked(readStoryPicks).mockResolvedValueOnce(picks([story()], 0));
    const page = await pageAt('2026-10-17T13:10:00Z');
    expect(page).toContain(
      'Ahora no hay más ofertas esperando: aparecen nuevas cuando cambian los precios o cuando se cumplen 14 días de una historia ya subida.'
    );
    expect(page).not.toContain('ofertas más esperando');
  });

  it('explica cómo se marca: una sola vez, pálida hasta Actualizar, 24 horas en "Ya publicadas" y 14 días sin volver', async () => {
    const page = await pageAt('2026-10-17T13:10:00Z');
    expect(page).toContain(
      'Marca Ya la publiqué cuando la subas a Instagram: se marca una sola vez, no por red. La tarjeta queda pálida hasta que tocas Actualizar; después pasa a "Ya publicadas" por 24 horas, para llevarla a otras redes, y no vuelve en 14 días salvo que baje 3% o más.'
    );
    // Y cómo leer la línea de la revisión antes de subir.
    expect(page).toContain('Si dice ✓ Mismo precio que en Mercado Libre , súbela.');
  });

  it('si no se pudieron leer las ofertas, no dice cuándo hay nuevas', async () => {
    vi.mocked(readStoryPicks).mockRejectedValueOnce(new Error('sin conexión'));
    const page = await pageAt('2026-10-17T13:10:00Z');
    expect(page).toContain('No se pudieron preparar las historias: sin conexión');
    expect(page).not.toContain('Cuándo hay historias nuevas');
  });

  it('una historia ya subida que no se vende igual se muestra, para pedir borrarla', async () => {
    vi.mocked(readPostedStories).mockResolvedValueOnce([postedStory({ onSale: false })]);
    const page = await pageAt('2026-10-17T13:10:00Z');
    expect(page).toContain('Ya publicadas (últimas 24 horas)');
    expect(page).toContain('ya no está a la venta: bórrala.');
  });
});
