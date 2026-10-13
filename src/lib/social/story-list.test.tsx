import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

// Las acciones escriben en la base: acá solo se mira lo que la página dibuja.
vi.mock('@/app/admin/historias/actions', () => ({ markStoryPublished: vi.fn(), undoStoryPublished: vi.fn() }));
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
  readStoryPicks: vi.fn(async () => []),
  readPostedStories: vi.fn(async () => []),
}));

import HistoriasPage from '@/app/admin/historias/page';
import { StoryList } from '@/app/admin/historias/StoryList';
import { readStoryPicks, type PostedStory, type StoryItem } from '@/lib/social/stories';

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
    reason: 'Parlante JBL, 50% por debajo del precio de lista, de tienda oficial',
    warning: null,
    points: 62.5,
    image: `/social/pieza/${id}/story-49990-99990-1-1-1-abc.jpg`,
    link: `https://www.mercadolibre.cl/p/MLC${seq}?matt_word=comparatech`,
    fileName: `comparatech-producto-${seq}-historia.jpg`,
    ...over,
  };
}

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
    const item = story({ warning: 'la oferta es chica', again: { price: 59_990, at: '2026-10-09T12:00:00.000Z' } });
    const html = render([item]);
    for (const text of ['$49.990', '-50%', 'Copiar link', 'Guardar imagen', 'Ya la publiqué', 'Ya la subiste el', item.link]) {
      expect(html).toContain(text);
    }
    expect(html).toContain('Bajaron desde que las subiste');
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
    };
    const html = render([offer], [done]);
    const postedCard = card(html, done);
    expect(postedCard).toContain('Subida el');
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
    vi.mocked(readStoryPicks).mockResolvedValueOnce([story({ warning: 'la oferta es chica' })]);
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
    expect(page).toContain('20% o más por debajo del precio de lista');
    // El piso de interés y la exclusión también pueden dejar la lista vacía.
    expect(page).toContain('Tampoco muestro las que le interesarían a poca gente');
    expect(page).toContain('las que hace poco costaban bastante menos');
    expect(page).not.toMatch(AVOIDED);
  });
});
