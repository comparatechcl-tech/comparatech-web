import { describe, expect, it } from 'vitest';
import {
  COMPARISONS,
  comparisonPath,
  comparisonSlug,
  comparisonTitle,
  comparisonsOf,
  getComparison,
  priceGapText,
  shortModelName,
  specRows,
} from './comparisons';
import { getModel } from './models';
import { MODEL_SPECS } from './model-specs';
import { SEO_TITLE_MAX } from './seo-title';

/** Lo que el sitio no dice nunca (CLAUDE.md, voz de marca). */
const AVOIDED = /mejor|m[aá]s barat|recomendad|conviene|imperdible|comisi[oó]n/i;

describe('la lista de comparaciones', () => {
  it('cada comparación es entre dos modelos con página, sin repetir, y tiene su ficha técnica', () => {
    const slugs = COMPARISONS.map(comparisonSlug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const c of COMPARISONS) {
      expect(getModel(c.a)).toBeDefined();
      expect(getModel(c.b)).toBeDefined();
      expect(c.a).not.toBe(c.b);
      expect(MODEL_SPECS[c.a]).toBeDefined();
      expect(MODEL_SPECS[c.b]).toBeDefined();
      // Una sola dirección por par: nunca "b-vs-a".
      expect(slugs).not.toContain(comparisonSlug({ a: c.b, b: c.a }));
    }
    expect(comparisonPath(COMPARISONS[0])).toBe('/comparar/iphone-17-vs-iphone-17-pro');
    expect(getComparison('iphone-17-vs-iphone-17-pro')?.b.name).toBe('iPhone 17 Pro');
    expect(getComparison('iphone-17-pro-vs-iphone-17')).toBeUndefined();
  });

  it('desde cada modelo se llega a sus comparaciones', () => {
    expect(comparisonsOf('galaxy-s26-ultra').map(comparisonSlug)).toEqual([
      'iphone-17-pro-max-vs-galaxy-s26-ultra',
      'galaxy-s26-vs-galaxy-s26-ultra',
    ]);
    expect(comparisonsOf('kindle')).toEqual([]);
  });
});

describe('textos', () => {
  const s26u = getModel('galaxy-s26-ultra')!;
  const pm = getModel('iphone-17-pro-max')!;
  const i17 = getModel('iphone-17')!;
  const i17p = getModel('iphone-17-pro')!;

  it('el título cabe en lo que muestra Google: si no, sin "en Chile"', () => {
    for (const c of COMPARISONS) {
      const found = getComparison(comparisonSlug(c))!;
      expect(comparisonTitle(found.a, found.b).length).toBeLessThanOrEqual(SEO_TITLE_MAX);
    }
    expect(comparisonTitle(i17, i17p)).toBe('iPhone 17 vs iPhone 17 Pro: precio en Chile y diferencias');
    expect(comparisonTitle(pm, s26u)).toBe('iPhone 17 Pro Max vs Galaxy S26 Ultra: precio y diferencias');
    expect(shortModelName(s26u)).toBe('Galaxy S26 Ultra');
    expect(shortModelName(i17)).toBe('iPhone 17');
  });

  it('dice desde cuánto está cada uno y cuánto más cuesta uno que el otro, sin decir cuál conviene', () => {
    expect(priceGapText(i17, i17p, 1_073_674, 1_401_050)).toBe(
      'Hoy iPhone 17 está desde $1.073.674 y iPhone 17 Pro desde $1.401.050 en Mercado Libre: iPhone 17 Pro cuesta $327.376 más.',
    );
    expect(priceGapText(i17, i17p, 1_000_000, 1_000_000)).toContain('cuestan lo mismo.');
    expect(priceGapText(i17, i17p, null, 1_401_050)).toBe(
      'Hoy iPhone 17 Pro está desde $1.401.050 en Mercado Libre; iPhone 17 no tiene versiones a la venta con vendedor de reputación verde.',
    );
    expect(priceGapText(i17, i17p, null, null)).toContain('ni iPhone 17 ni iPhone 17 Pro');
    for (const text of [priceGapText(pm, s26u, 1_518_622, 970_753), comparisonTitle(pm, s26u)]) expect(text).not.toMatch(AVOIDED);
  });
});

describe('specRows', () => {
  it('arma las filas con la ficha de Mercado Libre, en formato chileno', () => {
    const rows = specRows(getModel('iphone-17')!, getModel('galaxy-s26-ultra')!);
    const byLabel = Object.fromEntries(rows.map((r) => [r.label, r]));
    expect(byLabel['Pantalla'].a).toBe('6,3", OLED, 120 Hz');
    expect(byLabel['Pantalla'].b).toBe('6,9", Dynamic AMOLED 2X, 120 Hz');
    expect(byLabel['Batería'].b).toBe('5.000 mAh');
    expect(byLabel['Procesador'].b).toBe('Qualcomm SM8850');
    expect(byLabel['Cámaras traseras'].a).toBe('2 (principal de 48 Mpx)');
    // El lápiz va porque el S26 Ultra lo trae.
    expect(byLabel['Lápiz incluido']).toEqual({ label: 'Lápiz incluido', a: 'No', b: 'Sí' });
  });

  it('una fila sin dato en ninguno de los dos no va; el lápiz, solo si alguno lo trae', () => {
    const rows = specRows(getModel('iphone-17')!, getModel('iphone-17-pro')!);
    expect(rows.find((r) => r.label === 'Lápiz incluido')).toBeUndefined();
    for (const r of rows) expect(r.a !== null || r.b !== null).toBe(true);
  });
});
