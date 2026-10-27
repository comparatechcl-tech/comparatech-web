import { describe, expect, it } from 'vitest';
import {
  COUPON_MAX,
  couponCaptions,
  couponConditionText,
  couponDiscountText,
  couponProblem,
  couponPublishTarget,
  couponsProblem,
  parseCouponTargets,
  parseCouponText,
  toCoupons,
  type Coupon,
} from './coupons';

/**
 * Los cupones del canal de afiliados: leer el aviso pegado, revisar cada
 * cupón y armar el texto de cada red con la voz de la marca.
 */

const coupon = (over: Partial<Coupon> = {}): Coupon => ({
  code: 'ORBITA45',
  kind: 'monto',
  value: 45000,
  cap: 0,
  min: 500000,
  minWord: 'sobre',
  note: '',
  ...over,
});

describe('parseCouponText', () => {
  it('lee el aviso del 26-10-2026, un cupón por línea', () => {
    const text = [
      '🎟️ ¡Nuevos cupones de Mercado Libre!',
      'ORBITA45: $45.000 de descuento en compras sobre $500.000',
      'GALAXIA20: $20.000 OFF desde $200.000',
      'NEBULOSA9 → $9.000 de dcto. en compras desde $90.000',
      'Válidos en productos seleccionados.',
    ].join('\n');
    expect(parseCouponText(text)).toEqual([
      coupon(),
      coupon({ code: 'GALAXIA20', value: 20000, min: 200000, minWord: 'desde' }),
      coupon({ code: 'NEBULOSA9', value: 9000, min: 90000, minWord: 'desde' }),
    ]);
  });

  it('entiende "mil" y "k", y la compra mínima escrita de varias formas', () => {
    expect(parseCouponText('CYBER15 15 mil de descuento por compras mayores a $150.000')).toEqual([
      coupon({ code: 'CYBER15', value: 15000, min: 150000, minWord: 'sobre' }),
    ]);
    expect(parseCouponText('Usa TECNO5 y ahorra $5k con compra mínima de $50.000')).toEqual([
      coupon({ code: 'TECNO5', value: 5000, min: 50000, minWord: 'desde' }),
    ]);
  });

  it('un cupón de porcentaje con tope, aunque el código vaya después', () => {
    expect(parseCouponText('10% OFF en compras internacionales con tope de $20.000, código USA10')).toEqual([
      coupon({ code: 'USA10', kind: 'porcentaje', value: 10, cap: 20000, min: 0, minWord: 'desde', note: 'compras internacionales' }),
    ]);
  });

  it('con todo en una línea, cada cupón se queda con su frase', () => {
    const text =
      'Nuevos cupones! ORBITA45: $45.000 de descuento en compras sobre $500.000. GALAXIA20: $20.000 OFF desde $200.000. 10% en compras internacionales con tope de $20.000, codigo USA10';
    expect(parseCouponText(text)).toEqual([
      coupon(),
      coupon({ code: 'GALAXIA20', value: 20000, min: 200000, minWord: 'desde' }),
      coupon({ code: 'USA10', kind: 'porcentaje', value: 10, cap: 20000, min: 0, minWord: 'desde', note: 'compras internacionales' }),
    ]);
  });

  it('el código en una línea y lo que da en la siguiente', () => {
    expect(parseCouponText('ORBITA45\n$45.000 OFF en compras sobre $500.000\nVálidos hasta agotar stock')).toEqual([coupon()]);
  });

  it('no toma por código las palabras comunes en mayúsculas ni lo que no trae montos', () => {
    expect(parseCouponText('MERCADO LIBRE CUPONES OFF HOY $10.000')).toEqual([]);
    expect(parseCouponText('IMPORTANTE: revisa el canal')).toEqual([]);
    expect(parseCouponText('')).toEqual([]);
  });

  it('no repite un código y deja a lo más COUPON_MAX', () => {
    const text = ['A1A $1.000', 'B2B $2.000', 'C3C $3.000', 'D4D $4.000', 'E5E $5.000', 'A1A $1.000'].join('\n');
    expect(parseCouponText(text).map((c) => c.code)).toEqual(['A1A', 'B2B', 'C3C', 'D4D'].slice(0, COUPON_MAX));
  });
});

describe('couponProblem', () => {
  it('acepta un cupón normal y uno de porcentaje con tope', () => {
    expect(couponProblem(coupon())).toBeNull();
    expect(couponProblem(coupon({ kind: 'porcentaje', value: 10, cap: 20000, min: 0 }))).toBeNull();
  });

  it('rechaza lo que saldría mal en la imagen', () => {
    expect(couponProblem(coupon({ code: 'orbita 45' }))).toMatch(/mayúsculas/);
    expect(couponProblem(coupon({ value: 0 }))).toMatch(/pesos/);
    expect(couponProblem(coupon({ kind: 'porcentaje', value: 95 }))).toMatch(/entre 1 y 90/);
    expect(couponProblem(coupon({ cap: 1000 }))).toMatch(/tope/);
    expect(couponProblem(coupon({ min: 40000 }))).toMatch(/mayor que el descuento/);
    expect(couponProblem(coupon({ note: 'x'.repeat(41) }))).toMatch(/hasta 40/);
    expect(couponProblem(coupon({ note: 'oferta 🔥' }))).toMatch(/sin emojis/);
  });

  it('la aclaración no puede decir lo que la marca no dice', () => {
    for (const note of ['solo hoy', 'imperdible', 'el mejor precio', 'precio de lista', 'verificado']) {
      expect(couponProblem(coupon({ note }))).toMatch(/no dice/);
    }
  });

  it('la lista: al menos uno, a lo más COUPON_MAX y sin repetir', () => {
    expect(couponsProblem([])).toMatch(/al menos/);
    expect(couponsProblem(Array.from({ length: COUPON_MAX + 1 }, (_, i) => coupon({ code: `C${i}AB` })))).toMatch(/hasta/);
    expect(couponsProblem([coupon(), coupon()])).toMatch(/dos veces/);
  });
});

describe('toCoupons', () => {
  it('limpia lo que llega del navegador y rechaza otra forma', () => {
    expect(toCoupons([{ ...coupon(), code: ' orbita45 ', note: '  compras   internacionales ' }])).toEqual([
      coupon({ note: 'compras internacionales' }),
    ]);
    // El tope de un cupón en pesos se descarta.
    expect(toCoupons([{ ...coupon(), cap: 5000 }])?.[0].cap).toBe(0);
    expect(toCoupons('ORBITA45')).toBeNull();
    expect(toCoupons([{ ...coupon(), value: '45000' }])).toBeNull();
    expect(toCoupons([{ ...coupon(), kind: 'otro' }])).toBeNull();
  });
});

describe('textos', () => {
  it('el descuento y la condición', () => {
    expect(couponDiscountText(coupon())).toBe('$45.000 de descuento');
    expect(couponDiscountText(coupon({ kind: 'porcentaje', value: 10, cap: 20000 }))).toBe('10% de descuento, tope $20.000');
    expect(couponConditionText(coupon())).toBe('en compras sobre $500.000');
    expect(couponConditionText(coupon({ min: 0, note: 'compras internacionales' }))).toBe('compras internacionales');
    expect(couponConditionText(coupon({ min: 0 }))).toBe('');
  });

  it('el texto de cada red: el de Facebook con link, el de Instagram sin link', () => {
    const coupons = [coupon(), coupon({ code: 'NEBULOSA9', value: 9000, min: 90000, minWord: 'desde' })];
    const { instagram, facebook } = couponCaptions(coupons, 20261026, 'https://www.comparatech.cl/');
    expect(instagram).toContain('Cupones de Mercado Libre para hoy, 26 de octubre:');
    expect(instagram).toContain('ORBITA45: $45.000 de descuento en compras sobre $500.000');
    expect(instagram).toContain('NEBULOSA9: $9.000 de descuento en compras desde $90.000');
    expect(instagram).toContain('link en el perfil');
    expect(instagram).not.toContain('http');
    expect(facebook).toContain('https://www.comparatech.cl/ofertas?src=facebook-cupones');
    for (const text of [instagram, facebook]) {
      expect(text).not.toMatch(/solo hoy|imperdible|mejor precio|publicidad|comisi|verificad|recomendad/i);
    }
  });
});

describe('destinos y registro', () => {
  it('los destinos, siempre en el mismo orden y sin repetir', () => {
    expect(parseCouponTargets(['facebook', 'instagram'])).toEqual(['instagram', 'facebook']);
    expect(parseCouponTargets(['historia'])).toEqual(['historia']);
    expect(parseCouponTargets([])).toBeNull();
    expect(parseCouponTargets(['tiktok'])).toBeNull();
    expect(parseCouponTargets(['instagram', 'instagram'])).toBeNull();
  });

  it('el mismo día y los mismos códigos dan siempre el mismo registro', () => {
    expect(couponPublishTarget(20261026, [coupon(), coupon({ code: 'GALAXIA20' })])).toBe('cupones:20261026:ORBITA45.GALAXIA20');
  });
});
