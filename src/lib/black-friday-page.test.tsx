import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

/**
 * /black-friday dibujada a HTML: el enlace al termómetro según la fecha y
 * "Lo que vamos a vigilar" (desde el lunes 23 de noviembre), con datos fijos.
 */

vi.mock('next/navigation', () => ({ usePathname: () => '/black-friday', useSearchParams: () => null }));
vi.mock('@/lib/queries/deals', () => ({
  getDealsWithStats: vi.fn(async () => ({ deals: [], stats: new Map(), unread: new Set() })),
}));
vi.mock('@/lib/queries/products', () => ({ getCatalogProducts: vi.fn(async () => new Array(925).fill({})) }));
vi.mock('@/lib/queries/site-categories', () => ({ getSiteCategories: vi.fn(async () => []) }));
vi.mock('@/lib/queries/black-friday-thermometer', () => ({ getWatchList: vi.fn(async () => []) }));

import BlackFridayPage from '@/app/black-friday/page';
import { getWatchList } from '@/lib/queries/black-friday-thermometer';
import type { WatchItem } from '@/lib/black-friday-thermometer';

const cl = (s: string) => Date.parse(`${s.replace(' ', 'T')}:00-03:00`);

const AVOIDED =
  /precio de lista|lista \$|recomendad|verificad|mejor precio|m[aá]s barat|imperdible|ofert[oó]n|solo hoy|[uú]ltimas unidades|antes \$|rebaj|precio normal|ahorra|comisi[oó]n|publicidad/i;

function text(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ');
}

const ITEMS: WatchItem[] = [
  {
    name: 'JBL Charge 6',
    path: '/modelo/jbl-charge-6',
    versions: 2,
    price: 140_000,
    note: { habitual: 120_000, roseBefore: true, belowPct: null },
    drop: null,
  },
  {
    name: 'PS5',
    path: '/modelo/ps5',
    versions: 3,
    price: 440_000,
    note: { habitual: 500_000, roseBefore: false, belowPct: 12 },
    drop: null,
  },
  {
    name: 'Kindle',
    path: '/modelo/kindle',
    versions: 1,
    price: 99_990,
    note: null,
    drop: { amount: 10_000, pct: 9, since: '2026-11-25T12:00:00Z' },
  },
];

async function render(now: number, items: WatchItem[]) {
  vi.setSystemTime(now);
  vi.mocked(getWatchList).mockResolvedValue(items);
  return renderToStaticMarkup(await BlackFridayPage());
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
});
afterEach(() => {
  vi.useRealTimers();
});

describe('/black-friday', () => {
  it('antes del 23 de noviembre: sin lista, con el enlace al termómetro', async () => {
    const html = await render(cl('2026-11-20 10:00'), []);
    const t = text(html);
    expect(t).not.toContain('Lo que vamos a vigilar');
    expect(t).toContain('Termómetro del Black Friday 2026');
    expect(t).toContain('cómo vamos a medir qué bajó de verdad.');
    expect(html).toContain('href="/datos/black-friday-2026"');
  });

  it('del 23 al 26: "Lo que vamos a vigilar", con el precio de hoy, el habitual y "subió antes" si el historial lo confirma', async () => {
    const html = await render(cl('2026-11-24 10:00'), ITEMS);
    const t = text(html);
    expect(t).toContain('Lo que vamos a vigilar');
    expect(t).toContain('Productos muy buscados, con su precio de hoy y el precio habitual que tuvieron del 1 al 20 de noviembre. En el Black Friday vas a ver acá si bajan de verdad.');
    expect(t).toContain('JBL Charge 6 Desde $140.000 hoy · 2 versiones Precio habitual del 1 al 20 de noviembre: $120.000 Subió antes del Black Friday');
    expect(t).toContain('Kindle Desde $99.990 hoy · 1 versión');
    expect(t).toContain('Bajó $10.000');
    expect(html).toContain('href="/modelo/jbl-charge-6"');
    expect(t).not.toMatch(AVOIDED);
  });

  it('durante el evento: "Lo que estamos vigilando", con cuánto bajo el habitual está hoy', async () => {
    const t = text(await render(cl('2026-11-28 10:00'), ITEMS));
    expect(t).toContain('Lo que estamos vigilando');
    expect(t).not.toContain('En el Black Friday vas a ver acá');
    expect(t).toContain('PS5 Desde $440.000 hoy · 3 versiones Precio habitual del 1 al 20 de noviembre: $500.000 12% bajo su precio habitual');
    expect(t).toContain('el dato preliminar de qué está bajando de verdad');
    expect(t).not.toMatch(AVOIDED);
  });

  it('después del evento: el enlace lleva al balance', async () => {
    const t = text(await render(cl('2026-12-02 10:00'), []));
    expect(t).toContain('el balance de qué bajó de verdad');
    expect(t).not.toContain('Lo que estamos vigilando');
  });
});
