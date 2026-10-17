import { describe, expect, it, vi } from 'vitest';

/**
 * La revisión en vivo del precio (lib/social/live-price): lo que la tarjeta
 * muestra frente a lo que Mercado Libre muestra ahora, las frases que ve el
 * dueño y la revisión de varias tarjetas con dobles en vez de Mercado Libre y
 * de la base. La acción del servidor que la usa (y lo que se le permite
 * escribir) está en live-price-actions.test.ts.
 */

import type { PricingOutcome } from '@/lib/pricing';
import {
  LIVE_CHECK_CONCURRENCY,
  LIVE_CHECK_MAX_ITEMS,
  LIVE_CHECK_TIMEOUT_MS,
  LIVE_LINE,
  LIVE_RECHECK_AFTER_MS,
  LIVE_SAME_MAX_AGE_MS,
  LIVE_SAVE_TIMEOUT_MS,
  LIVE_TEXT,
  POSTED_DROP_NOTICE,
  POSTED_RISE_ALERT,
  asSentence,
  describeOfferChange,
  liveChangedText,
  liveCheckFrom,
  liveOfferFrom,
  markPriceWarning,
  minutesAgo,
  mlCheckUrl,
  needsWrite,
  normalizeShown,
  parseLiveItems,
  postedPriceShift,
  readLiveCheck,
  runLiveChecks,
  safeMlUrl,
  shouldSave,
  staleSameLine,
  type LiveCheck,
  type LiveCheckDeps,
  type LiveRow,
  type ShownOffer,
} from '@/lib/social/live-price';

const NOW = new Date('2026-10-17T15:00:00Z');
const CHECKED = '2026-10-17T15:00:05.000Z';
const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

/** Lo que muestra la tarjeta: $49.990, sin descuento $99.990 (50%), envío gratis, sin Full. */
const SHOWN: ShownOffer = { price: 49_990, listPrice: 99_990, freeShipping: true, full: false };

function row(over: Partial<LiveRow> = {}): LiveRow {
  return {
    id: ID(1),
    ml_product_id: 'MLC123',
    affiliate_url: 'https://meli.la/abc',
    price: 49_990,
    original_price: 99_990,
    seller_id: 1,
    seller_sales_count: 500,
    is_active: true,
    inactive_reason: null,
    inactive_since: null,
    winner_item_id: 'MLC9',
    link_target_product_id: null,
    link_checked_at: null,
    offer_info: { free_shipping: true, is_full: false, sold_by_ml: false, official_store: true, warranty: null, offers_count: 2, is_lowest: true },
    is_hidden: false,
    deleted_at: null,
    ...over,
  };
}

/** Lo que devuelve priceProducts: por omisión, el mismo ganador y nada que escribir más que la hora. */
function outcome(over: Partial<PricingOutcome> = {}): PricingOutcome {
  return {
    id: ID(1),
    result: 'activo',
    patch: { price_checked_at: CHECKED },
    priceChanged: false,
    reactivated: false,
    deactivated: false,
    ...over,
  };
}

// ---------------------------------------------------------------------------

describe('describeOfferChange: qué cambió en lo que la tarjeta muestra', () => {
  it('igual: nada', () => {
    expect(describeOfferChange(SHOWN, { ...SHOWN })).toBeNull();
  });

  it('el precio, aunque sea $1, hacia arriba o hacia abajo', () => {
    // $1 más: el descuento redondeado sigue siendo 50%, así que solo cambia el precio.
    expect(describeOfferChange(SHOWN, { ...SHOWN, price: 49_991 })).toBe('El precio cambió de $49.990 a $49.991.');
    expect(describeOfferChange(SHOWN, { ...SHOWN, price: 49_989 })).toBe('El precio cambió de $49.990 a $49.989.');
    // Bajó y con eso subió el descuento: dice las dos cosas.
    expect(describeOfferChange(SHOWN, { ...SHOWN, price: 45_990 })).toBe('El precio cambió de $49.990 a $45.990. El descuento cambió: ahora es 54%.');
    expect(describeOfferChange(SHOWN, { ...SHOWN, price: 59_990 })).toBe('El precio cambió de $49.990 a $59.990. El descuento cambió: ahora es 40%.');
  });

  it('la cifra tachada que desaparece o que aparece', () => {
    expect(describeOfferChange(SHOWN, { ...SHOWN, listPrice: null })).toBe('Ya no trae descuento.');
    expect(describeOfferChange({ ...SHOWN, listPrice: null }, SHOWN)).toBe('Ahora trae 50% de descuento (sin descuento $99.990).');
    // Una cifra tachada por debajo del precio no es descuento.
    expect(describeOfferChange(SHOWN, { ...SHOWN, listPrice: 40_000 })).toBe('Ya no trae descuento.');
  });

  it('el descuento redondeado que cambia, y la cifra tachada que cambia con el mismo descuento', () => {
    expect(describeOfferChange(SHOWN, { ...SHOWN, listPrice: 89_990 })).toBe('El descuento cambió: ahora es 44%.');
    // 99.990 → 100.000: sigue siendo 50%, pero la cifra tachada de la pieza es otra.
    expect(describeOfferChange(SHOWN, { ...SHOWN, listPrice: 100_000 })).toBe('El precio sin descuento cambió de $99.990 a $100.000.');
  });

  it('un "descuento" que redondea a 0% no se muestra, así que tampoco cuenta si desaparece', () => {
    const tiny: ShownOffer = { ...SHOWN, listPrice: 50_200 };
    expect(describeOfferChange(tiny, { ...SHOWN, listPrice: null })).toBeNull();
    expect(describeOfferChange({ ...SHOWN, listPrice: null }, tiny)).toBeNull();
  });

  it('el envío gratis y Full, en los dos sentidos', () => {
    expect(describeOfferChange(SHOWN, { ...SHOWN, freeShipping: false })).toBe('Ya no trae envío gratis.');
    expect(describeOfferChange({ ...SHOWN, freeShipping: false }, SHOWN)).toBe('Ahora trae envío gratis.');
    expect(describeOfferChange(SHOWN, { ...SHOWN, full: true })).toBe('Ahora llega con Full.');
    expect(describeOfferChange({ ...SHOWN, full: true }, SHOWN)).toBe('Ya no llega con Full.');
  });

  it('varias cosas a la vez, en orden: precio, descuento, envío y Full', () => {
    expect(describeOfferChange(SHOWN, { price: 52_990, listPrice: null, freeShipping: false, full: true })).toBe(
      'El precio cambió de $49.990 a $52.990. Ya no trae descuento. Ya no trae envío gratis. Ahora llega con Full.'
    );
  });
});

describe('liveOfferFrom: lo de ahora en los términos de la tarjeta', () => {
  it('sin nada en el parche, es lo de la base', () => {
    expect(liveOfferFrom(row(), outcome())).toEqual(SHOWN);
  });

  it('lo que trae el parche manda: precio, cifra tachada y la oferta', () => {
    const live = liveOfferFrom(
      row(),
      outcome({ patch: { price_checked_at: CHECKED, price: 45_990, original_price: null, offer_info: { free_shipping: false, is_full: true } } })
    );
    expect(live).toEqual({ price: 45_990, listPrice: null, freeShipping: false, full: true });
  });

  it('una cifra tachada que no es descuento no se muestra; sin datos de la oferta, sin envío ni Full', () => {
    expect(liveOfferFrom(row({ original_price: 40_000, offer_info: null }), outcome())).toEqual({
      price: 49_990,
      listPrice: null,
      freeShipping: false,
      full: false,
    });
  });
});

describe('liveCheckFrom: lo mostrado frente a lo que dijo priceProducts', () => {
  it('mismo precio y misma oferta: "same", con la hora de la revisión', () => {
    expect(liveCheckFrom(SHOWN, row(), outcome(), NOW)).toEqual({ status: 'same', checkedAt: CHECKED });
    // Sin hora en el parche, la de ahora.
    expect(liveCheckFrom(SHOWN, row(), outcome({ patch: {} }), NOW)).toEqual({ status: 'same', checkedAt: NOW.toISOString() });
  });

  it('otro vendedor u otras ventas con lo mismo a la vista sigue siendo "same"', () => {
    const o = outcome({ patch: { price_checked_at: CHECKED, seller_id: 2, seller_sales_count: 900, winner_item_id: 'MLC10' } });
    expect(liveCheckFrom(SHOWN, row(), o, NOW).status).toBe('same');
  });

  it('cambió: lo de ahora, la frase y saved en false (lo decide quien guarda)', () => {
    const o = outcome({ patch: { price_checked_at: CHECKED, price: 45_990 }, priceChanged: true });
    expect(liveCheckFrom(SHOWN, row(), o, NOW)).toEqual({
      status: 'changed',
      checkedAt: CHECKED,
      price: 45_990,
      listPrice: 99_990,
      freeShipping: true,
      full: false,
      saved: false,
      what: 'El precio cambió de $49.990 a $45.990. El descuento cambió: ahora es 54%.',
    });
  });

  it('la base ya tenía el precio nuevo (el refresco lo vio antes que la tarjeta): igual es "changed"', () => {
    expect(liveCheckFrom(SHOWN, row({ price: 45_990 }), outcome(), NOW)).toMatchObject({ status: 'changed', price: 45_990 });
  });

  it('sin ganador, ganador no verde o link a otro producto: ya no está a la venta, cada uno con su motivo', () => {
    expect(liveCheckFrom(SHOWN, row(), outcome({ result: 'sin_ganador' }), NOW)).toEqual({
      status: 'unavailable',
      checkedAt: CHECKED,
      what: LIVE_TEXT.noWinner,
    });
    expect(liveCheckFrom(SHOWN, row(), outcome({ result: 'ganador_no_verde' }), NOW)).toEqual({
      status: 'unavailable',
      checkedAt: CHECKED,
      what: 'Ya no está a la venta con un vendedor de reputación verde.',
    });
    expect(liveCheckFrom(SHOWN, row(), outcome({ result: 'link_otro_producto' }), NOW)).toEqual({
      status: 'unavailable',
      checkedAt: CHECKED,
      what: LIVE_TEXT.otherProduct,
    });
  });

  it('un tropiezo de Mercado Libre no dice nada del producto: "no pude revisar", nunca "mismo precio"', () => {
    expect(liveCheckFrom(SHOWN, row(), outcome({ result: 'error_transitorio', patch: {} }), NOW)).toEqual({
      status: 'unknown',
      what: 'No pude revisar Mercado Libre ahora.',
    });
  });
});

describe('needsWrite y shouldSave: qué se guarda', () => {
  const changed = (o: PricingOutcome) => liveCheckFrom(SHOWN, row(), o, NOW);

  it('la hora de revisión sola no es algo que escribir', () => {
    expect(needsWrite(outcome())).toBe(false);
    expect(needsWrite(outcome({ patch: {} }))).toBe(false);
    expect(needsWrite(outcome({ patch: { price_checked_at: CHECKED, price: 45_990 } }))).toBe(true);
    expect(needsWrite(outcome({ patch: { seller_sales_count: 501 } }))).toBe(true);
  });

  it('se guarda un cambio a la vista o un producto que ya no está a la venta, con algo que escribir', () => {
    const price = outcome({ patch: { price_checked_at: CHECKED, price: 45_990 }, priceChanged: true });
    expect(shouldSave(changed(price), price)).toBe(true);
    const gone = outcome({ result: 'sin_ganador', patch: { price_checked_at: CHECKED, is_active: false }, deactivated: true });
    expect(shouldSave(changed(gone), gone)).toBe(true);
  });

  it('un "mismo precio" con otro vendedor no se guarda desde acá: lo guarda el refresco', () => {
    const seller = outcome({ patch: { price_checked_at: CHECKED, seller_id: 2 } });
    expect(changed(seller).status).toBe('same');
    expect(shouldSave(changed(seller), seller)).toBe(false);
  });

  it('un cambio que la base ya tiene no tiene nada que escribir', () => {
    const o = outcome();
    const check = liveCheckFrom(SHOWN, row({ price: 45_990 }), o, NOW);
    expect(check.status).toBe('changed');
    expect(shouldSave(check, o)).toBe(false);
  });

  it('nunca la vuelta al sitio de un producto en pausa: esa la hace el refresco, que antes verifica el link', () => {
    const back = outcome({ patch: { price_checked_at: CHECKED, is_active: true, price: 45_990 }, reactivated: true, priceChanged: true });
    expect(changed(back).status).toBe('changed');
    expect(shouldSave(changed(back), back)).toBe(false);
  });

  it('un "no pude revisar" no se guarda', () => {
    const o = outcome({ result: 'error_transitorio', patch: { price: 1 } });
    expect(shouldSave({ status: 'unknown', what: LIVE_TEXT.mlDown }, o)).toBe(false);
  });
});

describe('markPriceWarning: el aviso al marcar con un precio que ya no es el de la base', () => {
  it('con otro precio, dice el de ahora y pide revisar la publicación', () => {
    expect(markPriceWarning(49_990, 45_990)).toBe(
      'Ojo: el precio cambió a $45.990 desde que cargaste la lista. Si ya la subiste, revisa la publicación.'
    );
    expect(markPriceWarning(49_990, 52_990, 'lo')).toBe(
      'Ojo: el precio cambió a $52.990 desde que cargaste la lista. Si ya lo subiste, revisa la publicación.'
    );
  });

  it('con el mismo precio (redondeado) no hay aviso', () => {
    expect(markPriceWarning(49_990, 49_990)).toBeNull();
    expect(markPriceWarning(49_989.6, 49_990, 'lo')).toBeNull();
  });

  it('con un precio de ahora que no sirve, no inventa un aviso', () => {
    for (const now of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) expect(markPriceWarning(49_990, now)).toBeNull();
    expect(markPriceWarning(Number.NaN, 45_990)).toBeNull();
  });
});

describe('postedPriceShift: cómo quedó algo ya subido', () => {
  it('los umbrales: 1% arriba avisa, 3% abajo avisa, lo de entremedio no', () => {
    expect(POSTED_RISE_ALERT).toBe(0.01);
    expect(POSTED_DROP_NOTICE).toBe(0.03);
    expect(postedPriceShift(60_000, 60_600)).toBe('higher');
    expect(postedPriceShift(60_000, 60_599)).toBeNull();
    expect(postedPriceShift(60_000, 90_000)).toBe('higher');
    expect(postedPriceShift(60_000, 58_200)).toBe('lower');
    expect(postedPriceShift(60_000, 58_201)).toBeNull();
    expect(postedPriceShift(60_000, 30_000)).toBe('lower');
    expect(postedPriceShift(60_000, 60_000)).toBeNull();
  });

  it('sin precio de ahora, ya no está a la venta', () => {
    expect(postedPriceShift(60_000, null)).toBe('gone');
  });

  it('con un precio que no sirve no dice nada', () => {
    expect(postedPriceShift(0, 60_000)).toBeNull();
    expect(postedPriceShift(60_000, 0)).toBeNull();
    expect(postedPriceShift(Number.NaN, 60_000)).toBeNull();
    expect(postedPriceShift(60_000, Number.NaN)).toBeNull();
  });
});

describe('las frases de las dos pantallas', () => {
  it('minutesAgo con el reloj del teléfono', () => {
    expect(minutesAgo(0)).toBe('hace menos de 1 min');
    expect(minutesAgo(59_999)).toBe('hace menos de 1 min');
    expect(minutesAgo(60_000)).toBe('hace 1 min');
    expect(minutesAgo(14 * 60_000 + 59_000)).toBe('hace 14 min');
    // Un reloj que se fue para atrás no da minutos negativos.
    expect(minutesAgo(-120_000)).toBe('hace menos de 1 min');
  });

  it('staleSameLine dice hace cuánto y que se revisa de nuevo al compartir', () => {
    expect(staleSameLine(16 * 60_000)).toBe(
      'Mismo precio hace 16 min: como pasaron más de 15 minutos, lo reviso de nuevo al tocar Compartir.'
    );
  });

  it('asSentence le pone el punto si le falta', () => {
    expect(asSentence('Ya no trae envío gratis')).toBe('Ya no trae envío gratis.');
    expect(asSentence('  Ya no trae envío gratis.  ')).toBe('Ya no trae envío gratis.');
    expect(asSentence('¿Qué pasó?')).toBe('¿Qué pasó?');
    expect(asSentence('Revisando…')).toBe('Revisando…');
    expect(asSentence('   ')).toBe('');
  });

  it('liveChangedText: qué cambió, que no se suba, y "el sitio ya tiene el precio nuevo" solo si es cierto', () => {
    const changed: LiveCheck = {
      status: 'changed',
      checkedAt: CHECKED,
      price: 45_990,
      listPrice: 99_990,
      freeShipping: true,
      full: false,
      saved: false,
      what: 'El precio cambió de $49.990 a $45.990',
    };
    expect(liveChangedText(changed, 'la')).toBe('El precio cambió de $49.990 a $45.990. No la subas: toca Actualizar.');
    expect(liveChangedText({ ...changed, saved: true }, 'lo')).toBe(
      'El precio cambió de $49.990 a $45.990. No lo subas: toca Actualizar. El sitio ya tiene el precio nuevo.'
    );
    expect(liveChangedText({ status: 'unavailable', checkedAt: CHECKED, what: LIVE_TEXT.notGreen }, 'la')).toBe(
      'Ya no está a la venta con un vendedor de reputación verde. No la subas: toca Actualizar.'
    );
    // Ya no dice que guardó: puede haberlo guardado el refresco, no esta revisión.
    expect(liveChangedText({ ...changed, saved: true }, 'la')).not.toContain('guardé');
    expect(liveChangedText({ ...changed, what: '' }, 'la')).toBe('No la subas: toca Actualizar.');
  });

  it('las líneas fijas', () => {
    expect(LIVE_LINE).toEqual({
      checking: 'Revisando en Mercado Libre…',
      unknown: 'No pude revisar en Mercado Libre: mira el precio con el botón antes de subir.',
      unknownNoButton: 'No pude revisar en Mercado Libre: revisa el precio antes de subir.',
    });
    expect(LIVE_TEXT.offline).toBe('La revisión en vivo funciona solo en el sitio publicado.');
  });

  it('los plazos acordados', () => {
    expect(LIVE_CHECK_MAX_ITEMS).toBe(16);
    expect(LIVE_CHECK_CONCURRENCY).toBe(4);
    expect(LIVE_CHECK_TIMEOUT_MS).toBe(8_000);
    expect(LIVE_SAVE_TIMEOUT_MS).toBe(5_000);
    expect(LIVE_SAME_MAX_AGE_MS).toBe(15 * 60_000);
    expect(LIVE_RECHECK_AFTER_MS).toBe(5 * 60_000);
  });
});

describe('las direcciones de Mercado Libre: nunca el link de afiliado', () => {
  it('mlCheckUrl arma la ficha limpia solo con un id de Mercado Libre', () => {
    expect(mlCheckUrl('MLC123')).toBe('https://www.mercadolibre.cl/p/MLC123');
    expect(mlCheckUrl('MLC1234567890')).toBe('https://www.mercadolibre.cl/p/MLC1234567890');
    for (const id of [null, undefined, '', 'mlc123', 'MLC', 'MLC-123', 'MLC123?matt_word=x', 'MLC123/../x', ' MLC123', 'MLC123456789012345678901']) {
      expect(mlCheckUrl(id), String(id)).toBeNull();
    }
  });

  it('safeMlUrl deja solo https de mercadolibre.cl, sin nada después de la ruta', () => {
    expect(safeMlUrl('https://www.mercadolibre.cl/p/MLC1')).toBe('https://www.mercadolibre.cl/p/MLC1');
    expect(safeMlUrl('https://mercadolibre.cl/p/MLC1')).toBe('https://mercadolibre.cl/p/MLC1');
    expect(safeMlUrl('https://articulo.mercadolibre.cl/MLC-123-parlante')).toBe('https://articulo.mercadolibre.cl/MLC-123-parlante');
    // Los parámetros del link de afiliado se cortan: mirar no es un clic.
    expect(safeMlUrl('https://www.mercadolibre.cl/p/MLC1?matt_word=comparatech&matt_tool=123')).toBe('https://www.mercadolibre.cl/p/MLC1');
    expect(safeMlUrl('https://www.mercadolibre.cl/p/MLC1#reviews')).toBe('https://www.mercadolibre.cl/p/MLC1');
    expect(safeMlUrl('  https://www.mercadolibre.cl/p/MLC1  ')).toBe('https://www.mercadolibre.cl/p/MLC1');
  });

  it('safeMlUrl rechaza otro esquema, otro dominio o algo que no es una ruta limpia', () => {
    for (const url of [
      null,
      undefined,
      '',
      'http://www.mercadolibre.cl/p/MLC1',
      'javascript:alert(1)',
      'https://meli.la/abc',
      'https://www.mercadolibre.com.ar/p/MLA1',
      'https://www.mercadolibre.cl.evil.com/p/MLC1',
      'https://evilmercadolibre.cl/p/MLC1',
      'https://www.mercadolibre.cl@evil.com/p/MLC1',
      'https://www.mercadolibre.cl/',
      'https://www.mercadolibre.cl/p/ML C1',
      'https://www.mercadolibre.cl/p/"onmouseover=alert(1)',
      '//www.mercadolibre.cl/p/MLC1',
    ]) {
      expect(safeMlUrl(url), String(url)).toBeNull();
    }
  });
});

describe('readLiveCheck: lo que llega por la red se revisa', () => {
  it('deja pasar las cuatro formas acordadas', () => {
    const same = { status: 'same', checkedAt: CHECKED };
    expect(readLiveCheck(same)).toBe(same);
    const unknown = { status: 'unknown', what: 'x' };
    expect(readLiveCheck(unknown)).toBe(unknown);
    const unavailable = { status: 'unavailable', checkedAt: CHECKED, what: 'x' };
    expect(readLiveCheck(unavailable)).toBe(unavailable);
    const changed = { status: 'changed', checkedAt: CHECKED, price: 1, listPrice: null, freeShipping: false, full: false, saved: false, what: 'x' };
    expect(readLiveCheck(changed)).toBe(changed);
  });

  it('cualquier otra cosa es "no pude revisar", nunca "mismo precio"', () => {
    const failed = { status: 'unknown', what: 'No pude revisar Mercado Libre ahora.' };
    for (const value of [
      undefined,
      null,
      'same',
      42,
      {},
      { status: 'igual' },
      { status: 'unknown' },
      { status: 'unavailable', checkedAt: CHECKED },
      { status: 'changed', what: 'x' },
      { status: 'changed', what: 'x', price: '45990' },
      { status: 'changed', what: 'x', price: Number.NaN },
      { status: 'changed', what: 7, price: 1 },
    ]) {
      expect(readLiveCheck(value), JSON.stringify(value)).toEqual(failed);
    }
  });
});

describe('normalizeShown y parseLiveItems: lo que llega del navegador', () => {
  it('normalizeShown redondea y exige un precio que sirva', () => {
    expect(normalizeShown({ price: 49_989.6, listPrice: 99_990, freeShipping: true, full: false })).toEqual(SHOWN);
    expect(normalizeShown({ price: 49_990 })).toEqual({ price: 49_990, listPrice: null, freeShipping: false, full: false });
    // Solo un sí explícito cuenta como envío gratis o Full.
    expect(normalizeShown({ price: 1, freeShipping: 'true', full: 1 })).toEqual({ price: 1, listPrice: null, freeShipping: false, full: false });
    expect(normalizeShown({ price: 49_990, listPrice: -5 })?.listPrice).toBeNull();
    for (const raw of [null, undefined, 'x', 49_990, { price: 0 }, { price: -1 }, { price: '49990' }, { price: Number.NaN }, { price: 3_000_000_000 }]) {
      expect(normalizeShown(raw), JSON.stringify(raw)).toBeNull();
    }
  });

  it('parseLiveItems: hasta 16 para revisar, uno por producto, lo demás con su respuesta; sin id válido, nada', () => {
    const raw = [
      { productId: 'no-es-un-id', shown: SHOWN },
      { productId: `${ID(1)} `, shown: SHOWN },
      { productId: ID(1), shown: { price: -1 } },
      ...Array.from({ length: 20 }, (_, i) => ({ productId: ID(i + 2), shown: SHOWN })),
      // Repetido: vale el primero.
      { productId: ID(2), shown: { ...SHOWN, price: 1 } },
      null,
      'x',
    ];
    const { items, results } = parseLiveItems(raw);
    expect(items).toHaveLength(16);
    expect(items[0]).toEqual({ productId: ID(2), shown: SHOWN });
    expect(items.map((item) => item.productId)).toEqual(Array.from({ length: 16 }, (_, i) => ID(i + 2)));
    expect(results[ID(1)]).toEqual({ status: 'unknown', what: LIVE_TEXT.badCard });
    for (let i = 18; i <= 21; i++) expect(results[ID(i)]).toEqual({ status: 'unknown', what: LIVE_TEXT.tooMany });
    expect(Object.keys(results)).toHaveLength(5);
    expect(results['no-es-un-id']).toBeUndefined();
  });

  it('parseLiveItems: algo que no es una lista no trae nada, y la respuesta no crece sin límite', () => {
    expect(parseLiveItems({ productId: ID(1), shown: SHOWN })).toEqual({ items: [], results: {} });
    const flood = Array.from({ length: 1_000 }, (_, i) => ({ productId: ID(i + 1), shown: SHOWN }));
    const { items, results } = parseLiveItems(flood);
    expect(items).toHaveLength(16);
    expect(Object.keys(results).length).toBeLessThanOrEqual(16 * 3);
  });
});

// ---------------------------------------------------------------------------
// La revisión de varias tarjetas, con dobles.

const items = (n: number, shown: ShownOffer = SHOWN) => Array.from({ length: n }, (_, i) => ({ productId: ID(i + 1), shown }));
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));
/** Una promesa que no termina nunca: Mercado Libre que no contesta. */
const never = <T>() => new Promise<T>(() => {});

/** Dobles de la base y de Mercado Libre: todo lo que piden queda anotado. */
function deps(over: Partial<LiveCheckDeps> = {}) {
  const readRows = vi.fn(async (ids: string[]) => ids.map((id) => row({ id })));
  const token = vi.fn(async () => 'token-de-prueba');
  const price = vi.fn(async (r: LiveRow, _token: string) => outcome({ id: r.id }));
  const save = vi.fn(async (_o: PricingOutcome) => true);
  return { readRows, token, price, save, ...over };
}

describe('runLiveChecks', () => {
  it('sin tarjetas no le pregunta nada a nadie', async () => {
    const d = deps();
    expect(await runLiveChecks([], d)).toEqual({ results: {}, changes: [], checked: 0 });
    expect(d.readRows).not.toHaveBeenCalled();
    expect(d.token).not.toHaveBeenCalled();
  });

  it('cada producto con lo suyo: igual, cambió (guardado) y ya no está a la venta', async () => {
    const price = vi.fn(async (r: LiveRow, _token: string) => {
      if (r.id === ID(2)) return outcome({ id: r.id, patch: { price_checked_at: CHECKED, price: 45_990 }, priceChanged: true });
      if (r.id === ID(3)) return outcome({ id: r.id, result: 'ganador_no_verde', patch: { price_checked_at: CHECKED, is_active: false }, deactivated: true });
      return outcome({ id: r.id });
    });
    const save = vi.fn(async (_o: PricingOutcome) => true);
    const d = deps({ price, save });
    const { results, changes, checked } = await runLiveChecks(items(3), d, { now: () => NOW });
    expect(results[ID(1)]).toEqual({ status: 'same', checkedAt: CHECKED });
    expect(results[ID(2)]).toMatchObject({ status: 'changed', price: 45_990, saved: true });
    expect(results[ID(3)]).toEqual({ status: 'unavailable', checkedAt: CHECKED, what: LIVE_TEXT.notGreen });
    expect(checked).toBe(3);
    // Se le pasa el token a cada consulta, una por producto.
    expect(price.mock.calls.map(([r, t]) => [r.id, t])).toEqual([
      [ID(1), 'token-de-prueba'],
      [ID(2), 'token-de-prueba'],
      [ID(3), 'token-de-prueba'],
    ]);
    // Se guarda lo que cambió en la tarjeta y lo que ya no se vende; nada más.
    expect(save.mock.calls.map(([o]) => o.id)).toEqual([ID(2), ID(3)]);
    // Para la bitácora: los dos cambios, con lo mostrado y lo de ahora.
    expect(changes).toEqual([
      {
        productId: ID(2),
        status: 'changed',
        what: 'El precio cambió de $49.990 a $45.990. El descuento cambió: ahora es 54%.',
        saved: true,
        shown: SHOWN,
        live: { price: 45_990, listPrice: 99_990, freeShipping: true, full: false },
      },
      { productId: ID(3), status: 'unavailable', what: LIVE_TEXT.notGreen, saved: true, shown: SHOWN, live: null },
    ]);
  });

  it('las fallas quedan aisladas: el que falla queda "no pude revisar" y los demás siguen', async () => {
    const d = deps({
      price: vi.fn(async (r: LiveRow) => {
        if (r.id === ID(2)) throw new Error('ML 500');
        if (r.id === ID(3)) return outcome({ id: r.id, result: 'error_transitorio', patch: {} });
        return outcome({ id: r.id });
      }),
    });
    const { results, checked } = await runLiveChecks(items(4), d);
    expect(results[ID(2)]).toEqual({ status: 'unknown', what: LIVE_TEXT.mlDown });
    expect(results[ID(3)]).toEqual({ status: 'unknown', what: LIVE_TEXT.mlDown });
    expect(results[ID(1)].status).toBe('same');
    expect(results[ID(4)].status).toBe('same');
    // Lo que no se pudo revisar no cuenta como revisado.
    expect(checked).toBe(2);
  });

  it('cada producto tiene su plazo: el que no contesta queda "se demoró" y no arrastra a los demás', async () => {
    const d = deps({
      price: vi.fn(async (r: LiveRow) => (r.id === ID(2) ? never<PricingOutcome>() : outcome({ id: r.id }))),
    });
    const { results } = await runLiveChecks(items(3), d, { timeoutMs: 20 });
    expect(results[ID(2)]).toEqual({ status: 'unknown', what: 'Mercado Libre se demoró en responder.' });
    expect(results[ID(1)].status).toBe('same');
    expect(results[ID(3)].status).toBe('same');
    expect(d.save).not.toHaveBeenCalled();
  });

  it('nunca más de 4 consultas a Mercado Libre a la vez', async () => {
    let active = 0;
    let peak = 0;
    const d = deps({
      price: vi.fn(async (r: LiveRow) => {
        active++;
        peak = Math.max(peak, active);
        await settle();
        active--;
        return outcome({ id: r.id });
      }),
    });
    const { checked } = await runLiveChecks(items(10), d);
    expect(checked).toBe(10);
    expect(peak).toBe(4);
    // Con otro tope, ese.
    peak = 0;
    await runLiveChecks(items(5), d, { concurrency: 2 });
    expect(peak).toBe(2);
  });

  it('pasado el presupuesto no empieza otro producto: el resto queda "no alcancé"', async () => {
    let clock = NOW.getTime();
    const d = deps({
      price: vi.fn(async (r: LiveRow) => {
        // Cada consulta se come 20 segundos del reloj.
        clock += 20_000;
        return outcome({ id: r.id });
      }),
    });
    const { results } = await runLiveChecks(items(4), d, { concurrency: 1, budgetMs: 36_000, now: () => new Date(clock) });
    expect(results[ID(1)].status).toBe('same');
    expect(results[ID(2)].status).toBe('same');
    expect(results[ID(3)]).toEqual({ status: 'unknown', what: LIVE_TEXT.outOfTime });
    expect(results[ID(4)]).toEqual({ status: 'unknown', what: LIVE_TEXT.outOfTime });
    expect(d.price).toHaveBeenCalledTimes(2);
  });

  it('lo que la base ya sabe se responde sin preguntarle a Mercado Libre', async () => {
    const d = deps({
      readRows: vi.fn(async () => [
        // ID(1) ya no está en la base.
        row({ id: ID(2), is_hidden: true }),
        row({ id: ID(3), deleted_at: '2026-10-17T10:00:00.000Z' }),
        row({ id: ID(4), ml_product_id: '' }),
      ]),
    });
    const { results, changes, checked } = await runLiveChecks(items(4), d, { now: () => NOW });
    expect(results[ID(1)]).toEqual({ status: 'unavailable', checkedAt: NOW.toISOString(), what: LIVE_TEXT.gone });
    expect(results[ID(2)]).toEqual({ status: 'unavailable', checkedAt: NOW.toISOString(), what: LIVE_TEXT.notOnSale });
    expect(results[ID(3)]).toEqual({ status: 'unavailable', checkedAt: NOW.toISOString(), what: LIVE_TEXT.notOnSale });
    expect(results[ID(4)]).toEqual({ status: 'unknown', what: LIVE_TEXT.noMl });
    // Sin nada que preguntar, ni token.
    expect(d.token).not.toHaveBeenCalled();
    expect(d.price).not.toHaveBeenCalled();
    expect(d.save).not.toHaveBeenCalled();
    // Ocultar o borrar es una decisión de una persona: no se escribe, y no pasa por la bitácora de cambios.
    expect(changes).toEqual([]);
    expect(checked).toBe(0);
  });

  it('si no se puede leer la base (o se demora), ninguna se puede revisar', async () => {
    const broken = deps({ readRows: vi.fn(async () => Promise.reject(new Error('se cayó'))) });
    const down = await runLiveChecks(items(2), broken);
    expect(Object.values(down.results)).toEqual([
      { status: 'unknown', what: LIVE_TEXT.siteDown },
      { status: 'unknown', what: LIVE_TEXT.siteDown },
    ]);
    expect(broken.token).not.toHaveBeenCalled();

    const slow = deps({ readRows: vi.fn(() => never<LiveRow[]>()) });
    const late = await runLiveChecks(items(1), slow, { timeoutMs: 20 });
    expect(late.results[ID(1)]).toEqual({ status: 'unknown', what: LIVE_TEXT.siteDown });
  });

  it('sin token de Mercado Libre (null, una falla o una demora), todo queda "no me pude conectar"', async () => {
    for (const token of [vi.fn(async () => null), vi.fn(async () => Promise.reject(new Error('429'))), vi.fn(() => never<string | null>())]) {
      const d = deps({ token });
      const { results, checked } = await runLiveChecks(items(2), d, { tokenTimeoutMs: 20 });
      expect(Object.values(results)).toEqual([
        { status: 'unknown', what: LIVE_TEXT.mlConnect },
        { status: 'unknown', what: LIVE_TEXT.mlConnect },
      ]);
      expect(d.price).not.toHaveBeenCalled();
      expect(checked).toBe(0);
    }
  });

  it('un "mismo precio" con otro vendedor no se guarda, y uno con la hora sola tampoco', async () => {
    const d = deps({
      price: vi.fn(async (r: LiveRow) =>
        r.id === ID(1) ? outcome({ id: r.id, patch: { price_checked_at: CHECKED, seller_id: 77 } }) : outcome({ id: r.id })
      ),
    });
    const { results, changes } = await runLiveChecks(items(2), d);
    expect(results[ID(1)].status).toBe('same');
    expect(d.save).not.toHaveBeenCalled();
    expect(changes).toEqual([]);
  });

  it('no guarda la vuelta al sitio de un producto en pausa', async () => {
    const back = (r: LiveRow) =>
      outcome({ id: r.id, patch: { price_checked_at: CHECKED, is_active: true, price: 45_990 }, reactivated: true, priceChanged: true });
    const d = deps({ price: vi.fn(async (r: LiveRow) => back(r)) });
    const { results, changes } = await runLiveChecks(items(1), d);
    expect(d.save).not.toHaveBeenCalled();
    // Se muestra el cambio, y como no se escribió, no se dice que el sitio lo tiene.
    expect(results[ID(1)]).toMatchObject({ status: 'changed', saved: false });
    expect(changes[0]).toMatchObject({ status: 'changed', saved: false });
  });

  it('saved dice la verdad: true si la base ya lo tenía o si quedó guardado; false si no se pudo', async () => {
    const changedOutcome = (r: LiveRow) => outcome({ id: r.id, patch: { price_checked_at: CHECKED, price: 45_990 }, priceChanged: true });

    // La base ya lo tenía (el refresco lo vio): nada que escribir, y el sitio ya tiene el precio nuevo.
    const cron = deps({ readRows: vi.fn(async (ids: string[]) => ids.map((id) => row({ id, price: 45_990 }))) });
    const already = await runLiveChecks(items(1), cron);
    expect(already.results[ID(1)]).toMatchObject({ status: 'changed', price: 45_990, saved: true });
    expect(cron.save).not.toHaveBeenCalled();

    // Se guardó.
    const ok = deps({ price: vi.fn(async (r: LiveRow) => changedOutcome(r)) });
    expect((await runLiveChecks(items(1), ok)).results[ID(1)]).toMatchObject({ saved: true });

    // El guardado dijo que no, o falló.
    for (const save of [vi.fn(async () => false), vi.fn(async () => Promise.reject(new Error('se cayó')))]) {
      const failed = deps({ price: vi.fn(async (r: LiveRow) => changedOutcome(r)), save });
      const out = await runLiveChecks(items(1), failed);
      expect(out.results[ID(1)]).toMatchObject({ status: 'changed', saved: false });
      expect(out.changes[0].saved).toBe(false);
    }

    // Sin quién guarde (fuera del sitio publicado), no se escribe y no se dice que se guardó.
    const { save: _unused, ...readOnly } = deps({ price: vi.fn(async (r: LiveRow) => changedOutcome(r)) });
    const offline = await runLiveChecks(items(1), readOnly);
    expect(offline.results[ID(1)]).toMatchObject({ status: 'changed', saved: false });
  });

  it('un guardado que se demora: el cambio igual se muestra, como no guardado, y queda en la bitácora', async () => {
    const d = deps({
      price: vi.fn(async (r: LiveRow) => outcome({ id: r.id, patch: { price_checked_at: CHECKED, price: 45_990 }, priceChanged: true })),
      save: vi.fn(() => never<boolean>()),
    });
    // El plazo del guardado es el más corto entre el del producto y LIVE_SAVE_TIMEOUT_MS.
    const { results, changes, checked } = await runLiveChecks(items(1), d, { timeoutMs: 20 });
    expect(results[ID(1)]).toMatchObject({ status: 'changed', price: 45_990, saved: false });
    expect(changes).toEqual([expect.objectContaining({ productId: ID(1), status: 'changed', saved: false })]);
    expect(checked).toBe(1);
  });

  it('el plazo de cada producto cubre la consulta a Mercado Libre, no el guardado que viene después', async () => {
    let releaseSave: (value: boolean) => void = () => {};
    const d = deps({
      price: vi.fn(async (r: LiveRow) => outcome({ id: r.id, patch: { price_checked_at: CHECKED, price: 45_990 }, priceChanged: true })),
      save: vi.fn(
        () =>
          new Promise<boolean>((resolve) => {
            releaseSave = resolve;
          })
      ),
    });
    const running = runLiveChecks(items(1), d, { timeoutMs: 1_000 });
    await settle();
    releaseSave(true);
    const { results } = await running;
    // Llegó a tiempo: guardado, y nunca "se demoró".
    expect(results[ID(1)]).toMatchObject({ status: 'changed', saved: true });
  });
});
