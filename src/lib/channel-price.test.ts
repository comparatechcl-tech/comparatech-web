import { describe, expect, it } from 'vitest';
import { CHANNEL_OFFER_INFO, channelPriceDecision, noticePrice, type ChannelProduct } from './channel-price';
import { isManualPrice, priceOnlyKnown, priceState } from './price-freshness';

const POSTED = '2026-11-25T21:01:13+00:00'; // 18:01 de Chile
const NOW = Date.parse('2026-11-25T21:30:00Z');

function product(overrides: Partial<ChannelProduct> = {}): ChannelProduct {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    ml_product_id: 'MLC61403702',
    price: 709_990,
    original_price: 799_990,
    seller_id: 123,
    winner_item_id: 'MLC999',
    is_active: true,
    inactive_reason: null,
    inactive_since: null,
    price_checked_at: '2026-11-23T17:30:00Z',
    is_hidden: false,
    deleted_at: null,
    ...overrides,
  };
}

const plain = (price: number) => ({ price, coupon: null, amounts: [price], discountPct: null, conditional: false });

describe('noticePrice', () => {
  it('un solo monto es el precio', () => {
    expect(noticePrice(plain(709_990))).toEqual({ ok: true, value: { price: 709_990, listPrice: null } });
    // Un aviso leído antes de que existiera `amounts` trae solo el precio.
    expect(noticePrice({ price: 109_990, coupon: null })).toEqual({ ok: true, value: { price: 109_990, listPrice: null } });
  });

  it('"de $A a $B" da el precio y el precio sin descuento, si calza con el descuento que dice', () => {
    expect(noticePrice({ price: 369_474, coupon: null, amounts: [629_990, 369_474], discountPct: 41, conditional: false })).toEqual({
      ok: true,
      value: { price: 369_474, listPrice: 629_990 },
    });
    // El aviso dice 48% y los montos dan 41%: el precio vale, el tachado no.
    expect(noticePrice({ price: 369_474, coupon: null, amounts: [629_990, 369_474], discountPct: 48, conditional: false })).toEqual({
      ok: true,
      value: { price: 369_474, listPrice: null },
    });
    // Sin porcentaje en el aviso, basta con que sea creíble.
    expect(noticePrice({ price: 248_990, coupon: null, amounts: [499_990, 248_990], discountPct: null, conditional: false })).toEqual({
      ok: true,
      value: { price: 248_990, listPrice: 499_990 },
    });
    // Más del triple no se guarda como tachado.
    expect(noticePrice({ price: 100_000, coupon: null, amounts: [350_000, 100_000], discountPct: null, conditional: false })).toEqual({
      ok: true,
      value: { price: 100_000, listPrice: null },
    });
  });

  it('no toma un precio con condiciones ni montos que no se entienden', () => {
    expect(noticePrice({ ...plain(279_990), coupon: 'PICK11', conditional: true })).toEqual({ ok: false, reason: 'con_condiciones' });
    expect(noticePrice({ ...plain(99_990), conditional: true })).toEqual({ ok: false, reason: 'con_condiciones' });
    expect(noticePrice({ price: null, coupon: null, amounts: [], discountPct: null, conditional: false })).toEqual({
      ok: false,
      reason: 'sin_precio',
    });
    // "$219 a $84.875": el aviso cortó el primer monto. No se adivina.
    expect(noticePrice({ price: 84_875, coupon: null, amounts: [219, 84_875], discountPct: 61, conditional: false })).toEqual({
      ok: false,
      reason: 'precio_ambiguo',
    });
    expect(noticePrice({ price: 3, coupon: null, amounts: [1, 2, 3], discountPct: null, conditional: false })).toEqual({
      ok: false,
      reason: 'precio_ambiguo',
    });
  });
});

describe('channelPriceDecision', () => {
  it('mismo precio: queda revisado a la hora del aviso, sin tachado y sin datos de la oferta', () => {
    const decision = channelPriceDecision(product(), plain(709_990), POSTED, NOW);
    if (!decision.ok) throw new Error(decision.reason);
    expect(decision.postedAt).toBe('2026-11-25T21:01:13.000Z');
    expect(decision.outcome.patch).toEqual({
      price_checked_at: '2026-11-25T21:01:13.000Z',
      offer_info: CHANNEL_OFFER_INFO,
      // El aviso no trae precio sin descuento: el del 23-11 ya no se puede afirmar.
      original_price: null,
    });
    expect(decision.outcome.reactivated).toBe(false);
    expect(priceOnlyKnown({ offer_info: decision.outcome.patch.offer_info })).toBe(true);
    expect(isManualPrice({ offer_info: decision.outcome.patch.offer_info })).toBe(false);
    // Con esa hora el sitio lo muestra como precio de hoy.
    expect(priceState(decision.postedAt, NOW)).toBe('hoy');
  });

  it('precio distinto: cambia y va al historial con la hora del aviso', () => {
    const decision = channelPriceDecision(product(), plain(689_990), POSTED, NOW);
    if (!decision.ok) throw new Error(decision.reason);
    expect(decision.outcome.patch.price).toBe(689_990);
    expect(decision.outcome.priceChanged).toBe(true);
    expect(decision.outcome.observation).toMatchObject({
      price: 689_990,
      original_price: null,
      seller_id: null,
      observed_at: '2026-11-25T21:01:13.000Z',
    });
    expect(decision.outcome.previous).toMatchObject({ price: 709_990, original_price: 799_990 });
  });

  it('con "de $A a $B" guarda también el precio sin descuento', () => {
    const deal = { price: 639_990, coupon: null, amounts: [799_990, 639_990], discountPct: 20, conditional: false };
    const decision = channelPriceDecision(product(), deal, POSTED, NOW);
    if (!decision.ok) throw new Error(decision.reason);
    expect(decision.value).toEqual({ price: 639_990, listPrice: 799_990 });
    expect(decision.outcome.patch).toMatchObject({ price: 639_990 });
    // El tachado guardado era el mismo: no hace falta escribirlo de nuevo.
    expect('original_price' in decision.outcome.patch).toBe(false);
  });

  it('no pisa una revisión igual o más nueva que el aviso, ni repite el mismo aviso', () => {
    expect(channelPriceDecision(product({ price_checked_at: '2026-11-25T21:20:00Z' }), plain(689_990), POSTED, NOW)).toEqual({
      ok: false,
      reason: 'ya_revisado',
    });
    expect(channelPriceDecision(product({ price_checked_at: '2026-11-25T21:01:13.000Z' }), plain(709_990), POSTED, NOW)).toEqual({
      ok: false,
      reason: 'ya_revisado',
    });
  });

  it('un cambio de más del doble o menos de la mitad no se toma', () => {
    expect(channelPriceDecision(product(), plain(70_999), POSTED, NOW)).toEqual({ ok: false, reason: 'cambio_grande' });
    expect(channelPriceDecision(product(), plain(1_500_000), POSTED, NOW)).toEqual({ ok: false, reason: 'cambio_grande' });
  });

  it('no vuelve a publicar un producto en pausa ni toca lo oculto o eliminado', () => {
    expect(channelPriceDecision(product({ is_active: false, inactive_reason: 'sin_ganador' }), plain(709_990), POSTED, NOW)).toEqual({
      ok: false,
      reason: 'en_pausa',
    });
    expect(
      channelPriceDecision(product({ is_active: false, inactive_reason: 'link_otro_producto' }), plain(709_990), POSTED, NOW)
    ).toEqual({ ok: false, reason: 'fuera_del_sitio' });
    expect(channelPriceDecision(product({ is_hidden: true }), plain(709_990), POSTED, NOW)).toEqual({
      ok: false,
      reason: 'fuera_del_sitio',
    });
    expect(channelPriceDecision(product({ deleted_at: '2026-11-01T00:00:00Z' }), plain(709_990), POSTED, NOW)).toEqual({
      ok: false,
      reason: 'fuera_del_sitio',
    });
  });

  it('un aviso con condiciones, sin fecha o del futuro no cambia nada', () => {
    expect(channelPriceDecision(product(), { ...plain(650_000), conditional: true }, POSTED, NOW)).toEqual({
      ok: false,
      reason: 'con_condiciones',
    });
    expect(channelPriceDecision(product(), plain(709_990), 'ayer', NOW)).toEqual({ ok: false, reason: 'sin_fecha' });
    expect(channelPriceDecision(product(), plain(709_990), '2026-11-26T21:01:13Z', NOW)).toEqual({ ok: false, reason: 'sin_fecha' });
  });

  it('un aviso de hace días igual sirve: el precio queda con su fecha', () => {
    const now = Date.parse('2026-11-28T15:00:00Z');
    const decision = channelPriceDecision(product(), plain(699_990), POSTED, now);
    if (!decision.ok) throw new Error(decision.reason);
    expect(priceState(decision.postedAt, now)).toBe('referencia');
  });
});
