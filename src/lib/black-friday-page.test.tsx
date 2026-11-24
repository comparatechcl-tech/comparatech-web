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
// Con el precio revisado hace una hora: lo de "hoy" (termómetro, lista a vigilar) vale solo con precios de hoy.
vi.mock('@/lib/queries/products', () => ({
  getCatalogProducts: vi.fn(async () =>
    new Array(925).fill({ price_checked_at: new Date(Date.now() - 3_600_000).toISOString() })
  ),
}));
vi.mock('@/lib/queries/site-categories', () => ({ getSiteCategories: vi.fn(async () => []) }));
vi.mock('@/lib/queries/black-friday-thermometer', () => ({ getWatchList: vi.fn(async () => []) }));

import BlackFridayPage from '@/app/black-friday/page';
import { getWatchList } from '@/lib/queries/black-friday-thermometer';
import { getCatalogProducts } from '@/lib/queries/products';
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

/*
 * Desde el 23-11-2026 Mercado Libre no entrega precios. Con los precios de ese
 * día la página no puede prometer ver qué bajó: dice cuánto costaba cada cosa
 * en la última revisión y manda a ver el precio de hoy en Mercado Libre.
 */
describe('/black-friday con precios que no son de hoy', () => {
  // La última revisión: el 23-11 a las 13:33 de Chile.
  const LAST_CHECK = '2026-11-23T16:33:00Z';
  async function renderDated(now: number, items: WatchItem[]) {
    vi.mocked(getCatalogProducts).mockResolvedValueOnce(new Array(925).fill({ price_checked_at: LAST_CHECK }) as never);
    return render(now, items);
  }

  it('antes del evento: cuánto costaba cada producto, hasta qué fecha, y sin termómetro', async () => {
    const now = cl('2026-11-24 15:00');
    const html = await renderDated(now, ITEMS);
    const t = text(html);
    expect(t).toContain(
      'acá puedes ver cuánto costaba cada producto antes. Registramos el precio de 925 productos de tecnología y hogar en Mercado Libre desde octubre hasta el 23-11-2026.'
    );
    expect(t).not.toContain('Termómetro del Black Friday');
    expect(html).not.toContain('href="/datos/black-friday-2026"');
    expect(t).not.toContain('vas a poder ver si el precio de verdad bajó');
    // El historial se mira hasta la última revisión, no hasta ahora.
    expect(vi.mocked(getWatchList)).toHaveBeenLastCalledWith(now, Date.parse(LAST_CHECK));
  });

  it('la lista de los más buscados dice de qué día es cada precio y no habla de "hoy" ni de bajas', async () => {
    const t = text(await renderDated(cl('2026-11-24 15:00'), ITEMS));
    expect(t).toContain('Los más buscados, antes del Black Friday');
    expect(t).toContain(
      'Productos muy buscados, con el precio de nuestra última revisión, el 23/11, y el precio habitual que tuvieron del 1 al 20 de noviembre. Compáralos con el precio de hoy en Mercado Libre.'
    );
    expect(t).toContain('JBL Charge 6 Desde $140.000 el 23/11 · 2 versiones Precio habitual del 1 al 20 de noviembre: $120.000');
    expect(t).toContain('Kindle Desde $99.990 el 23/11 · 1 versión');
    expect(t).not.toContain('Bajó $10.000');
    expect(t).not.toContain('hoy ·');
    expect(t).not.toContain('Lo que vamos a vigilar');
    expect(t).not.toContain('Bajaron de precio según nuestro registro');
    expect(t).not.toContain('varias veces al día');
    expect(t).not.toMatch(AVOIDED);
  });

  it('durante el evento: antes de comprar, cuánto costaba antes del evento', async () => {
    const t = text(await renderDated(cl('2026-11-28 10:00'), ITEMS));
    expect(t).toContain(
      'Antes de comprar, mira cuánto costaba cada producto antes del evento: registramos el precio de 925 productos de tecnología y hogar en Mercado Libre desde octubre hasta el 23-11-2026.'
    );
    expect(t).toContain('Los más buscados, antes del Black Friday');
    expect(t).not.toContain('Lo que estamos vigilando');
    expect(t).not.toContain('el dato preliminar');
    expect(t).toContain('¿De cuándo es el precio que veo?');
  });
});
