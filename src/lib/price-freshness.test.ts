import { describe, expect, it } from 'vitest';
import {
  buyLabel,
  priceCheckedWithin,
  priceDateLabel,
  priceState,
  priceStateChangedSince,
  withoutStaleOffer,
} from '@/lib/price-freshness';

/*
 * Desde el 23-11-2026 Mercado Libre no entrega precios a la aplicación y cada
 * producto queda con el de su última revisión. Lo que importa: que ese precio
 * no se muestre como el de hoy, ni con un descuento o un envío que nadie
 * volvió a mirar, y que pasado un mes ya no se muestre.
 */

const NOW = Date.parse('2026-11-24T15:00:00Z');
const hoursAgo = (h: number) => new Date(NOW - h * 3_600_000).toISOString();

describe('priceState', () => {
  it('revisado en las últimas 12 horas es el precio de hoy', () => {
    expect(priceState(hoursAgo(0), NOW)).toBe('hoy');
    expect(priceState(hoursAgo(11), NOW)).toBe('hoy');
  });

  it('entre 12 horas y un mes sirve de referencia, con su fecha', () => {
    expect(priceState(hoursAgo(13), NOW)).toBe('referencia');
    // El precio de ayer a las 13:33, visto hoy a las 11: ya no es "el de hoy".
    expect(priceState(hoursAgo(22), NOW)).toBe('referencia');
    expect(priceState(hoursAgo(29 * 24), NOW)).toBe('referencia');
  });

  it('nunca revisado, hace más de un mes o con una fecha que no sirve: sin precio', () => {
    expect(priceState(hoursAgo(31 * 24), NOW)).toBe('sin_precio');
    expect(priceState(null, NOW)).toBe('sin_precio');
    expect(priceState(undefined, NOW)).toBe('sin_precio');
    expect(priceState('no es una fecha', NOW)).toBe('sin_precio');
    // Una revisión "del futuro" por más que un desfase de relojes.
    expect(priceState(new Date(NOW + 3_600_000).toISOString(), NOW)).toBe('sin_precio');
    expect(priceState(new Date(NOW + 60_000).toISOString(), NOW)).toBe('hoy');
  });
});

describe('priceStateChangedSince', () => {
  const twoHoursAgo = NOW - 2 * 3_600_000;

  it('avisa cuando un precio dejó de ser el de hoy o dejó de servir de referencia', () => {
    // Hace 13 horas: hace dos horas todavía era "de hoy".
    expect(priceStateChangedSince([hoursAgo(1), hoursAgo(13)], twoHoursAgo, NOW)).toBe(true);
    // Hace 30 días y una hora: hace dos horas todavía era referencia.
    expect(priceStateChangedSince([hoursAgo(30 * 24 + 1)], twoHoursAgo, NOW)).toBe(true);
  });

  it('sin cambios de estado no avisa', () => {
    expect(priceStateChangedSince([hoursAgo(1), hoursAgo(30), hoursAgo(40 * 24), null], twoHoursAgo, NOW)).toBe(false);
    expect(priceStateChangedSince([], twoHoursAgo, NOW)).toBe(false);
  });
});

describe('textos', () => {
  it('el día de la revisión, en hora de Chile', () => {
    // 23-11 a las 13:33 de Chile.
    expect(priceDateLabel('2026-11-23T16:33:00Z')).toBe('23/11');
    // 01:30 UTC del 24 todavía es 23 en Chile.
    expect(priceDateLabel('2026-11-24T01:30:00Z')).toBe('23/11');
  });

  it('el botón manda a ver el precio de hoy cuando el guardado no lo es', () => {
    expect(buyLabel('hoy')).toBe('Ver en Mercado Libre');
    expect(buyLabel('referencia')).toBe('Ver precio de hoy en Mercado Libre');
    expect(buyLabel('sin_precio')).toBe('Ver precio de hoy en Mercado Libre');
    expect(buyLabel('referencia', true)).toBe('Ver precio de hoy');
    expect(buyLabel('hoy', true)).toBe('Ver en Mercado Libre');
  });
});

describe('withoutStaleOffer', () => {
  const offer = { free_shipping: true, is_full: false };
  const product = (checkedAt: string | null) => ({
    id: 'p1',
    price: 59_990,
    original_price: 79_990 as number | null,
    offer_info: offer as unknown,
    price_checked_at: checkedAt,
  });

  it('con el precio de hoy no toca nada', () => {
    const fresh = product(hoursAgo(1));
    expect(withoutStaleOffer(fresh, NOW)).toBe(fresh);
  });

  it('sin revisar hoy quita el precio de lista y los datos de la oferta, y deja el precio', () => {
    for (const checkedAt of [hoursAgo(30), hoursAgo(40 * 24), null]) {
      expect(withoutStaleOffer(product(checkedAt), NOW)).toEqual({
        id: 'p1',
        price: 59_990,
        original_price: null,
        offer_info: null,
        price_checked_at: checkedAt,
      });
    }
  });

  it('un producto que no trae offer_info (migración sin aplicar) sigue sin traerlo', () => {
    const { offer_info: _offer, ...bare } = product(hoursAgo(30));
    const out = withoutStaleOffer(bare, NOW);
    expect(out.original_price).toBeNull();
    expect('offer_info' in out).toBe(false);
  });
});

describe('priceCheckedWithin: los plazos más cortos que "hoy" (historias y videos)', () => {
  const NOW = Date.parse('2026-11-24T16:00:00Z');
  const SIX_HOURS = 6 * 3_600_000;

  it('revisado dentro del plazo, sí; pasado el plazo, sin fecha o con una fecha que no se entiende, no', () => {
    expect(priceCheckedWithin('2026-11-24T10:00:00Z', SIX_HOURS, NOW)).toBe(true);
    expect(priceCheckedWithin('2026-11-24T09:59:59Z', SIX_HOURS, NOW)).toBe(false);
    expect(priceCheckedWithin('2026-11-23T16:33:00Z', SIX_HOURS, NOW)).toBe(false);
    expect(priceCheckedWithin(null, SIX_HOURS, NOW)).toBe(false);
    expect(priceCheckedWithin(undefined, SIX_HOURS, NOW)).toBe(false);
    expect(priceCheckedWithin('no es una fecha', SIX_HOURS, NOW)).toBe(false);
  });

  it('una fecha del futuro (más que un desfase de relojes) no cuenta como revisada', () => {
    expect(priceCheckedWithin('2026-11-24T16:03:00Z', SIX_HOURS, NOW)).toBe(true);
    expect(priceCheckedWithin('2026-11-24T17:00:00Z', SIX_HOURS, NOW)).toBe(false);
  });

  it('sin plazo (una regla mal armada) no deja pasar nada', () => {
    expect(priceCheckedWithin('2026-11-24T15:59:00Z', undefined as unknown as number, NOW)).toBe(false);
  });
});
