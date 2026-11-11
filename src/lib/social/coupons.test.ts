import { describe, expect, it } from 'vitest';
import {
  COUPON_MAX,
  couponCaptions,
  couponConditionText,
  couponDiscountText,
  couponFooter,
  couponProblem,
  couponPublishTarget,
  couponsProblem,
  isCouponNotice,
  parseCouponTargets,
  parseCouponText,
  productCouponCodes,
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
    expect(parseCouponText('Cupón CYBER15: 15 mil de descuento por compras mayores a $150.000')).toEqual([
      coupon({ code: 'CYBER15', value: 15000, min: 150000, minWord: 'sobre' }),
    ]);
    expect(parseCouponText('Usa el código TECNO5 y ahorra $5k con compra mínima de $50.000')).toEqual([
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
    expect(parseCouponText('Cupón ORBITA45\n$45.000 OFF en compras sobre $500.000\nVálidos hasta agotar stock')).toEqual([coupon()]);
  });

  it('no toma por código las palabras comunes en mayúsculas ni lo que no trae montos', () => {
    expect(parseCouponText('MERCADO LIBRE CUPONES OFF HOY $10.000')).toEqual([]);
    expect(parseCouponText('IMPORTANTE: revisa el canal')).toEqual([]);
    expect(parseCouponText('')).toEqual([]);
  });

  it('no repite un código y deja a lo más COUPON_MAX', () => {
    const text = ['Cupones de hoy', 'A1A $1.000', 'B2B $2.000', 'C3C $3.000', 'D4D $4.000', 'E5E $5.000', 'A1A $1.000'].join('\n');
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

describe('cupones sin código (aviso del 03-11-2026)', () => {
  const aviso = [
    'Les dejamos un datazo fuerte en computación para compartir hoy con su comunidad:',
    '',
    'Se activó un cupón de *$30.000 OFF* en notebooks reacondicionados seleccionados, ideal para quienes buscan renovar equipo de trabajo o estudio con un ahorro real:',
    '',
    '💻 *Computación Reacondicionada*',
    '💻 *HP Elite Dragonfly G2 2-en-1 Convertible (i5 / Win 11 Pro)*',
    '🔥 *57% OFF*',
    '💰 De ~$1.104.393~ a *$473.471*',
    '🏷️ Con cupón en checkout: queda en *$443.471* (¡más de *$650.000 de ahorro total*!)',
    '👉 https://tinyurl.com/tb4v9e7t',
  ].join('\n');

  it('lee el monto y a qué productos aplica', () => {
    expect(parseCouponText(aviso)).toEqual([
      coupon({ code: '', value: 30000, min: 0, minWord: 'desde', note: 'en notebooks reacondicionados' }),
    ]);
  });

  it('se acepta sin código, solo uno, y los textos dicen "Sin código"', () => {
    const c = coupon({ code: '', value: 30000, min: 0, note: 'en notebooks reacondicionados' });
    expect(couponProblem(c)).toBeNull();
    expect(couponsProblem([c, { ...c }])).toMatch(/un solo cupón sin código/);
    expect(couponsProblem([c, coupon()])).toBeNull();
    const { instagram } = couponCaptions([c], 20261103, 'https://www.comparatech.cl/');
    expect(instagram).toContain('Sin código: $30.000 de descuento en notebooks reacondicionados');
    expect(couponPublishTarget(20261103, [c])).toBe('cupones:20261103:SINCODIGO');
    expect(couponFooter([c])).toMatch(/aparece al pagar/);
    expect(couponFooter([coupon()])).toMatch(/código se ingresa al pagar/);
  });

  it('un aviso con código sigue leyendo el código', () => {
    expect(parseCouponText('Con cupón BELLEZA (10% extra): queda en $89.991').map((c) => c.code)).toEqual(['BELLEZA']);
  });
});

describe('avisos que no son de cupones (05-11-2026)', () => {
  // El aviso del canal que salió publicado como cupón: dos televisores en oferta.
  const deals = [
    'Buen dia, Afiliados! Les dejamos dos datazos en televisores con rebajas fuertisimas para que compartan hoy con su comunidad:',
    'Samsung 55" Mini LED M70H 4K Vision AI Smart TV 2026',
    '48% OFF',
    'De $629.990 a $329.990',
    'https://tinyurl.com/5947na3n',
    'Smart TV LED 43" Google TV Full HD Bluetooth MG43FFK5 Master-G 2026',
    '37% OFF',
    'De $299.990 a $189.990',
    'https://tinyurl.com/23ve9ehy',
    'Tip para afiliados: Armar una encuesta en historias.',
  ].join('\n');

  it('un aviso de productos en oferta no trae cupones', () => {
    expect(isCouponNotice(deals)).toBe(false);
    expect(parseCouponText(deals)).toEqual([]);
  });

  it('se reconoce un aviso de cupones con o sin tilde', () => {
    expect(isCouponNotice('Nuevos cupones de Mercado Libre')).toBe(true);
    expect(isCouponNotice('Usa el código ORBITA45')).toBe(true);
    expect(isCouponNotice('CODIGO: ORBITA45')).toBe(true);
    expect(isCouponNotice('Se activó un cupón de $30.000 OFF')).toBe(true);
    expect(isCouponNotice('Recuperar la cuponera')).toBe(false);
  });

  it('"4K" no es plata: solo "$5k" o "15 mil"', () => {
    expect(parseCouponText('Código TELE10: 10% de descuento en televisores 4K')).toEqual([
      coupon({ code: 'TELE10', kind: 'porcentaje', value: 10, cap: 0, min: 0, minWord: 'desde' }),
    ]);
  });
});

describe('cupones de un producto puntual (avisos del 11-11-2026)', () => {
  // Tres mensajes del canal copiados juntos: dos cupones de un producto y uno general.
  const notice = [
    '[11/11, 11:58] null: *🔥 DOREL 11/11: descuentos de hasta 67% OFF 🛒*',
    'Silla De Auto Convertible Poplar Stone Onyx Britax',
    'Con el cupón *🎟️ PICK11* queda en $279.990',
    '🔗https://www.mercadolibre.cl/up/MLCU379728559',
    '[11/11, 11:58] null: ¡Lo más vendido en electro! ⚡',
    'Ventilador Tower Fan Mouvair Freeze Silencioso 6 Velocidades Con Ionizador De Aire y Wifi',
    'Con el cupón 🎟️ LOCURASDD queda en $84.990',
    '🔗https://www.mercadolibre.cl/p/MLC63071662',
    '[11/11, 12:34] null: *¡HABEMUS CUPÓN DE FECHA DOBLE!* ',
    '🎟️FECHADOBLE: $5.000 off en compras sobre $34.990',
  ].join('\n');

  it('"queda en $X" es el precio del producto con el cupón, no el descuento: no va en la imagen', () => {
    expect(parseCouponText(notice)).toEqual([
      coupon({ code: 'FECHADOBLE', kind: 'monto', value: 5_000, cap: 0, min: 34_990, minWord: 'sobre' }),
    ]);
    expect(productCouponCodes(notice)).toEqual(['PICK11', 'LOCURASDD']);
  });

  it('solo cupones de producto: ninguno general', () => {
    const one = 'Con el cupón 🎟️ LOCURASDD queda en $84.990';
    expect(parseCouponText(one)).toEqual([]);
    expect(productCouponCodes(one)).toEqual(['LOCURASDD']);
  });

  it('si además dice cuánto da, se lee ese descuento y no el precio del producto', () => {
    expect(parseCouponText('Con cupón BELLEZA (10% extra): queda en $89.991')).toEqual([
      coupon({ code: 'BELLEZA', kind: 'porcentaje', value: 10, cap: 0, min: 0, minWord: 'desde' }),
    ]);
    expect(productCouponCodes('Con cupón BELLEZA (10% extra): queda en $89.991')).toEqual([]);
  });

  it('un cupón general no se confunde', () => {
    expect(productCouponCodes('🎟️FECHADOBLE: $5.000 off en compras sobre $34.990')).toEqual([]);
  });
});
