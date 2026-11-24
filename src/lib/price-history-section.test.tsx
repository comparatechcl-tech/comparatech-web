import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

/**
 * El historial de la ficha y la fecha del precio, dibujados a HTML como los
 * escribe el servidor: es lo que leen los buscadores y las IAs. El 22-11-2026
 * ChatGPT traía 3 de cada 4 clics y la ficha no le decía de cuándo era el
 * precio: "Precio revisado…" se escribía recién en el navegador y las fechas
 * del historial iban sin año.
 */

vi.mock('@/lib/queries/price-history', () => ({ getPriceHistoryCached: vi.fn() }));

import { PriceHistory } from '@/components/product/PriceHistory';
import { PriceFreshness } from '@/components/product/PriceFreshness';
import { getPriceHistoryCached } from '@/lib/queries/price-history';

/** Lo que el sitio no dice nunca (CLAUDE.md, voz de marca). */
const AVOIDED =
  /precio de lista|lista \$|recomendad|verificad|mejor precio|m[aá]s barat|imperdible|ofert[oó]n|solo hoy|[uú]ltimas unidades|antes \$|rebaj|precio normal|ahorra|comisi[oó]n|publicidad/i;

function text(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ');
}

const NOW = Date.parse('2026-11-22T22:00:00Z');
const HISTORY = [
  { price: 560_000, observed_at: '2026-10-05T15:00:00Z' },
  { price: 496_150, observed_at: '2026-11-04T15:00:00Z' },
  { price: 544_221, observed_at: '2026-11-04T19:00:00Z' },
];

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
});

async function render(props: Partial<Parameters<typeof PriceHistory>[0]> = {}, history: unknown = HISTORY) {
  vi.mocked(getPriceHistoryCached).mockResolvedValue(history as Awaited<ReturnType<typeof getPriceHistoryCached>>);
  const node = await PriceHistory({
    productId: 'p1',
    name: 'Consola Nintendo Switch 2',
    price: 544_221,
    checkedAt: '2026-11-22T21:42:00Z',
    ...props,
  });
  return node ? text(renderToStaticMarkup(node)) : null;
}

describe('historial de la ficha', () => {
  it('parte con el precio de hoy en una frase con fechas completas', async () => {
    const t = (await render())!;
    expect(t).toContain(
      'Hoy $544.221 en Mercado Libre. Precio revisado el 22-11-2026 a las 18:42 (hora de Chile). El más bajo que registramos desde el 05-10-2026 fue $496.150, el 04-11-2026.'
    );
    // La frase va antes de la explicación del gráfico.
    expect(t.indexOf('Hoy $544.221 en Mercado Libre')).toBeLessThan(t.indexOf('Así se movió el precio'));
    expect(t).not.toMatch(AVOIDED);
  });

  it('las fechas del texto llevan año; los ejes del gráfico, no', async () => {
    const t = (await render())!;
    expect(t).toContain('Así se movió el precio de Consola Nintendo Switch 2 en Mercado Libre desde el 05-10-2026.');
    expect(t).toContain('El 04-11-2026, por unas 4 horas');
    // La tabla de cambios: fecha con año y hora de Chile.
    expect(t).toContain('04-11-2026 16:00');
    expect(t).toContain('05-10-2026 12:00');
    expect(t).toContain('05/10');
  });

  it('sin la fecha de la revisión no dibuja nada: no se sabe hasta cuándo vale el historial', async () => {
    expect(await render({ checkedAt: null })).toBeNull();
  });

  it('con el precio revisado hace días, el historial termina en esa revisión y nada dice "hoy"', async () => {
    // Revisado el 19-11 a las 19:00 de Chile; se lee el 22-11.
    const t = (await render({ checkedAt: '2026-11-19T22:00:00Z' }))!;
    expect(t).toContain(
      'El 19-11-2026 a las 19:00 (hora de Chile), la última vez que revisamos el precio, costaba $544.221 en Mercado Libre. El más bajo que registramos desde el 05-10-2026 fue $496.150, el 04-11-2026. El precio de hoy está en Mercado Libre.'
    );
    expect(t).toContain('desde el 05-10-2026 hasta el 19-11-2026, la última vez que lo revisamos. Lo anotamos cada vez que lo vimos cambiar.');
    expect(t).toContain('El 19/11');
    expect(t).not.toMatch(/Hoy|últimos 30 días|últimas 48 horas/);
    expect(t).not.toMatch(AVOIDED);
  });

  it('con el precio revisado hace días y sin cambios, dice entre qué fechas no cambió', async () => {
    const t = (await render({ checkedAt: '2026-11-19T22:00:00Z' }, [{ price: 544_221, observed_at: '2026-10-05T15:00:00Z' }]))!;
    expect(t).toContain('la última vez que revisamos el precio, costaba $544.221 en Mercado Libre. El precio de hoy está en Mercado Libre.');
    expect(t).toContain('no cambió desde el 05-10-2026 hasta el 19-11-2026, la última vez que lo revisamos.');
    expect(t).not.toContain('Hoy');
  });

  it('fuera de venta no hay precio de hoy: dice hasta cuándo se vendió, con año', async () => {
    const t = (await render({ soldOutSince: '2026-11-20T15:00:00Z' }))!;
    expect(t).not.toContain('Hoy $');
    expect(t).toContain('hasta el 20-11-2026, cuando dejó de estar a la venta');
  });

  it('un precio que nunca cambió: la frase y desde cuándo se sigue, sin repetirse', async () => {
    const t = (await render({}, [{ price: 544_221, observed_at: '2026-10-05T15:00:00Z' }]))!;
    expect(t).toContain('Hoy $544.221 en Mercado Libre. Precio revisado el 22-11-2026 a las 18:42 (hora de Chile).');
    expect(t).toContain('no ha cambiado desde el 05-10-2026, cuando empezamos a seguirlo');
    expect(t).not.toContain('El más bajo que registramos');
  });

  it('sin historial no dibuja nada', async () => {
    expect(await render({}, null)).toBeNull();
    expect(await render({}, [])).toBeNull();
  });
});

describe('fecha del precio junto al precio', () => {
  it('el servidor escribe la fecha completa (en el navegador pasa a "hace 12 minutos")', () => {
    const t = text(renderToStaticMarkup(<PriceFreshness checkedAt="2026-11-22T21:42:00Z" />));
    expect(t.trim()).toBe('Precio revisado en Mercado Libre el 22-11-2026 a las 18:42 (hora de Chile)');
    expect(t).not.toMatch(AVOIDED);
  });

  it('sin fecha no escribe nada', () => {
    expect(renderToStaticMarkup(<PriceFreshness checkedAt={null} />)).toBe('');
    expect(renderToStaticMarkup(<PriceFreshness checkedAt="no es fecha" />)).toBe('');
  });
});
