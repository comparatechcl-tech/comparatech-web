import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

/**
 * El termómetro del Black Friday (/datos/black-friday-2026) dibujado a HTML
 * en cada momento: antes (sin datos, con la prueba del método y con la
 * semana previa), el viernes 27 de madrugada, el dato preliminar y el
 * balance. Con datos fijos.
 */

vi.mock('next/navigation', () => ({ usePathname: () => '/datos/black-friday-2026', useSearchParams: () => null }));
vi.mock('@/lib/queries/black-friday-thermometer', () => ({ getThermometer: vi.fn() }));
vi.mock('@/lib/queries/products', () => ({ getCatalogProducts: vi.fn(async () => new Array(1234).fill({})) }));

import TermometroPage, { metadata } from '@/app/datos/black-friday-2026/page';
import { getThermometer } from '@/lib/queries/black-friday-thermometer';
import {
  BASELINE_WINDOWS,
  EVENT_WINDOWS,
  baselineWindows,
  summarizeOutcomes,
  type ProductOutcome,
  type ThermometerSummary,
  type ThermometerWindows,
} from '@/lib/black-friday-thermometer';

const cl = (s: string) => Date.parse(`${s.replace(' ', 'T')}:00-03:00`);

/** Lo que el sitio no dice nunca (CLAUDE.md, voz de marca). */
const AVOIDED =
  /precio de lista|lista \$|recomendad|verificad|mejor precio|m[aá]s barat|imperdible|ofert[oó]n|solo hoy|[uú]ltimas unidades|antes \$|rebaj|precio normal|ahorra|comisi[oó]n|publicidad/i;

function text(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ');
}

let seq = 0;
function outcome(over: Partial<ProductOutcome> = {}): ProductOutcome {
  seq++;
  return {
    id: `o${seq}`,
    slug: `producto-${seq}`,
    name: `Parlante Marca Modelo ${seq}`,
    category: 'audio',
    habitual: 100_000,
    eventPrice: 100_000,
    realPct: 0,
    announcedPct: 0,
    verdict: 'igual',
    prePrice: null,
    roseBefore: false,
    roseThenDropped: false,
    ...over,
  };
}

/** 100 productos: 23 bajaron (uno de $5.000, fuera de las listas), 61 igual, 16 más caros; 12 subieron antes (7 "bajaron"). */
function eventSummary(windows: ThermometerWindows) {
  const outcomes: ProductOutcome[] = [];
  for (let i = 0; i < 23; i++) {
    outcomes.push(
      outcome({
        verdict: 'bajo',
        realPct: 10 + i,
        eventPrice: 100_000 - (10 + i) * 1000,
        announcedPct: 40,
        habitual: i === 0 ? 5_000 : 100_000,
        ...(i === 22 ? { name: 'Audífonos Sony WH-1000XM6 Negro', slug: 'audifonos-sony-wh-1000xm6' } : {}),
      })
    );
  }
  for (let i = 0; i < 61; i++) {
    outcomes.push(
      outcome({
        category: i < 30 ? 'celulares' : 'audio',
        announcedPct: i < 20 ? 35 : 0,
        roseBefore: i < 12,
        roseThenDropped: i < 7,
        prePrice: i < 12 ? 125_000 : null,
        realPct: 1,
      })
    );
  }
  for (let i = 0; i < 16; i++) outcomes.push(outcome({ verdict: 'caro', realPct: -8, eventPrice: 108_000 }));
  return summarizeOutcomes(outcomes, windows)!;
}

function baselineSummary(windows: ThermometerWindows) {
  const outcomes: ProductOutcome[] = [];
  for (let i = 0; i < 12; i++) outcomes.push(outcome({ verdict: 'bajo', realPct: 8, announcedPct: 36 }));
  for (let i = 0; i < 70; i++) outcomes.push(outcome({ announcedPct: i < 30 ? 36 : 0, roseBefore: i < 5 }));
  for (let i = 0; i < 18; i++) outcomes.push(outcome({ verdict: 'caro', realPct: -6 }));
  return summarizeOutcomes(outcomes, windows)!;
}

async function render(now: number, summary: ThermometerSummary | null) {
  vi.setSystemTime(now);
  vi.mocked(getThermometer).mockResolvedValue(summary);
  return renderToStaticMarkup(await TermometroPage());
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
});
afterEach(() => {
  vi.useRealTimers();
});

describe('metadata', () => {
  it('título de 60 caracteres o menos, canonical fijo y descripción corta', () => {
    const title = (metadata.title as { absolute: string }).absolute;
    expect(title.length).toBeLessThanOrEqual(60);
    expect(metadata.alternates?.canonical).toBe('/datos/black-friday-2026');
    expect(String(metadata.description).length).toBeLessThanOrEqual(170);
    expect(`${title} ${metadata.description}`).not.toMatch(AVOIDED);
  });
});

describe('antes del evento', () => {
  it('sin datos todavía: explica cómo se va a medir y cuándo salen los datos', async () => {
    const html = await render(cl('2026-10-20 10:00'), { asOf: cl('2026-10-20 10:00'), phase: 'antes', event: null, baseline: null, preLive: null });
    const t = text(html);
    expect(t).toContain('Termómetro del Black Friday 2026');
    expect(t).toContain('faltan 38 días');
    expect(t).toContain('El primer dato sale el viernes 27 de noviembre en la mañana y el balance, el martes 1 de diciembre');
    expect(t).toContain('Precio habitual: el que más tiempo rigió del 1 al 20 de noviembre');
    expect(t).toContain('al menos 6 horas del viernes 27 al lunes 30 de noviembre');
    expect(t).toContain('Seguimos el precio de 1.234 productos');
    expect(t).toContain('del viernes 13 al lunes 16 de noviembre, con su propio precio habitual ( del 18 de octubre al 6 de noviembre)'.replace('( ', '('));
    expect(t).not.toContain('Así se ve un fin de semana sin evento');
    expect(t).not.toMatch(AVOIDED);
    expect(html).toContain('href="/black-friday"');
  });

  it('con la prueba del método: el último fin de semana sin evento', async () => {
    const now = cl('2026-11-10 10:00');
    const windows = baselineWindows(now)!;
    const html = await render(now, { asOf: now, phase: 'antes', event: null, baseline: baselineSummary(windows), preLive: null });
    const t = text(html);
    expect(t).toContain('Así se ve un fin de semana sin evento');
    expect(t).toContain('Probamos la regla con el fin de semana del viernes 6 al lunes 9 de noviembre');
    expect(t).toContain('12 de cada 100 bajaron de verdad, 70 quedaron igual y 18 estuvieron más caros');
    expect(t).toContain('Las ofertas mostraban en promedio 36% de descuento; contra su precio habitual, bajaron en promedio 2%');
    expect(t).toContain('hasta el del 13 al 16 de noviembre');
    expect(t).not.toMatch(AVOIDED);
  });

  it('en la semana previa: lo que ya subió, comparado con la semana antes del fin de semana sin evento', async () => {
    const now = cl('2026-11-24 10:00');
    const html = await render(now, {
      asOf: now,
      phase: 'antes',
      event: null,
      baseline: baselineSummary(BASELINE_WINDOWS),
      preLive: {
        measured: 900,
        roseBefore: 90,
        items: [{ slug: 'tv-lg-55', name: 'Smart TV LG 55" 4K', category: 'electronica', habitual: 400_000, prePrice: 460_000 }],
      },
    });
    const t = text(html);
    expect(t).toContain('La semana antes');
    expect(t).toContain('Desde el sábado 21 de noviembre, 10% de los productos (90 de 900) ya estuvo al menos un día 5% o más sobre su precio habitual');
    expect(t).toContain('En la semana antes del fin de semana sin evento fue 5%');
    expect(t).toContain('precio habitual $400.000 → estuvo en $460.000 (15% más)');
    expect(html).toContain('href="/producto/tv-lg-55"');
    expect(t).toContain('Con este fin de semana vamos a comparar el Black Friday');
    expect(t).not.toMatch(AVOIDED);
  });

  it('el viernes 27 de madrugada: ya empezó, el primer dato sale a las 8:00', async () => {
    const now = cl('2026-11-27 05:00');
    const t = text(await render(now, { asOf: now, phase: 'antes', event: null, baseline: baselineSummary(BASELINE_WINDOWS), preLive: null }));
    expect(t).toContain('primer dato a las 8:00');
    expect(t).toContain('El Black Friday ya empezó: el primer dato sale hoy a las 8:00');
  });
});

describe('durante y después', () => {
  it('dato preliminar: la hora de los precios, las cifras, la comparación y las listas', async () => {
    const now = cl('2026-11-27 09:40');
    const asOf = cl('2026-11-27 09:30');
    const html = await render(now, {
      asOf,
      phase: 'preliminar',
      event: eventSummary(EVENT_WINDOWS),
      baseline: baselineSummary(BASELINE_WINDOWS),
      preLive: null,
    });
    const t = text(html);
    expect(t).toContain('Dato preliminar · precios hasta las 09:30 del viernes 27 de noviembre');
    expect(t).toContain('de 100 productos que seguimos en Mercado Libre, 23% bajó de verdad (5% o más bajo su precio de las semanas anteriores). En un fin de semana sin evento fue 12%');
    expect(t).toContain('el balance sale el martes 1 de diciembre');
    expect(t).toContain('23 de 100 productos · fin de semana sin evento: 12%');
    expect(t).toContain('Subió la semana antes');
    expect(t).toContain('Del 21 al 26 de noviembre; 7 de ellos "bajaron" en el evento sin quedar bajo su precio habitual');
    expect(t).toContain('Las ofertas bajaron en promedio');
    expect(t).toContain('De cada 100 productos, 23 bajaron de verdad, 61 quedaron igual y 16 estuvieron más caros');
    // Por categoría: celulares (30) y audio (54); electrónica no llega a 10.
    expect(t).toContain('Por categoría');
    expect(html.indexOf('>Celulares<')).toBeGreaterThan(-1);
    expect(html.indexOf('>Celulares<')).toBeLessThan(html.indexOf('>Audio<'));
    // Las bajas más grandes: de mayor a menor, sin lo de menos de $10.000.
    expect(t).toContain('Las bajas más grandes');
    expect(t).toContain('precio habitual $100.000 → $68.000 en el Black Friday (32% menos); la publicación mostraba 40% de descuento');
    expect(t).not.toContain('$5.000 →');
    expect(html).toContain('href="/producto/audifonos-sony-wh-1000xm6"');
    expect(t).toContain('Subieron antes y en el Black Friday "bajaron"');
    expect(t).toContain('precio habitual $100.000 · del 21 al 26 de noviembre subió a $125.000 · en el Black Friday $100.000');
    expect(t).not.toMatch(AVOIDED);
  });

  it('balance: el mismo resumen con el título de balance', async () => {
    const now = cl('2026-12-02 10:00');
    const t = text(
      await render(now, {
        asOf: EVENT_WINDOWS.eventEnd,
        phase: 'balance',
        event: eventSummary(EVENT_WINDOWS),
        baseline: baselineSummary(BASELINE_WINDOWS),
        preLive: null,
      })
    );
    expect(t).toContain('Balance · Del viernes 27 al lunes 30 de noviembre de 2026');
    expect(t).toContain('Balance del Black Friday 2026 en Mercado Libre, del viernes 27 al lunes 30 de noviembre: de 100 productos de tecnología y hogar que seguimos, 23% bajó de verdad');
    expect(t).not.toContain('Dato preliminar');
    expect(t).not.toMatch(AVOIDED);
  });

  it('si no se pudo calcular, lo dice en vez de mostrar números', async () => {
    const t = text(await render(cl('2026-11-28 10:00'), null));
    expect(t).toContain('Estamos actualizando el dato');
    expect(t).not.toContain('De cada 100');
    expect(t).not.toContain('Las bajas más grandes');
    expect(t).toContain('Cómo lo medimos');
  });
});
