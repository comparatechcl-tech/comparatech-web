import { describe, expect, it } from 'vitest';
import type { Product } from '@/lib/types';
import { cardImageLoading, toCardProduct } from '@/lib/card-product';
import { buyUrl } from '@/lib/outbound';

function product(over: Partial<Product> = {}): Product {
  return {
    id: 'p1',
    slug: 'audifono-x',
    name: 'Audífono X',
    brand: 'Marca',
    category: 'audio',
    price: 20000,
    original_price: 40000,
    image_url: 'https://http2.mlstatic.com/D_NQ_NP_1-F.jpg',
    affiliate_url: 'https://meli.la/abc123',
    description: 'Una descripción larga que la tarjeta no muestra.',
    specs: { 'Es inalámbrico': 'Sí', 'Con micrófono': 'Sí', Color: 'Negro', Modelo: 'X-500' },
    seller_reputation: 'verde',
    seller_sales_count: 1200,
    is_featured: false,
    is_active: true,
    is_hidden: false,
    ml_product_id: 'MLC123456',
    ml_domain_id: 'MLC-HEADPHONES',
    ml_family_id: null,
    seller_id: 99,
    rrss_status: 'sin_usar',
    created_at: '2026-01-01T00:00:00Z',
    inactive_reason: null,
    inactive_since: null,
    price_checked_at: '2026-10-01T00:00:00Z',
    winner_item_id: null,
    link_target_product_id: null,
    link_checked_at: null,
    ...over,
  };
}

/** Seis horas después de la revisión del producto de prueba: su precio es el de hoy. */
const NOW = Date.parse('2026-10-01T06:00:00Z');

describe('toCardProduct', () => {
  it('lleva solo lo que la tarjeta muestra', () => {
    expect(toCardProduct(product(), null, NOW)).toEqual({
      id: 'p1',
      slug: 'audifono-x',
      name: 'Audífono X',
      category: 'audio',
      price: 20000,
      original_price: 40000,
      image_url: 'https://http2.mlstatic.com/D_NQ_NP_1-F.jpg',
      href: 'https://meli.la/abc123',
      badges: ['Inalámbrico', 'Con micrófono'],
    });
  });

  it('el link de compra es el mismo que resuelve lib/outbound', () => {
    const direct = product({
      outbound_url: 'https://www.mercadolibre.cl/p/MLC123456?matt_word=comparatech&matt_tool=15629069',
    });
    expect(toCardProduct(direct).href).toBe(buyUrl(direct));
    expect(toCardProduct(direct).href).toContain('matt_tool=15629069');

    // Un link guardado que no pasa la lista cae a la ficha, igual que antes.
    const unsafe = product({ affiliate_url: 'javascript:alert(1)' });
    expect(toCardProduct(unsafe).href).toBe(buyUrl(unsafe));
    expect(toCardProduct(unsafe).href).toBe('https://www.mercadolibre.cl/p/MLC123456');
  });

  it('agrega el chip de envío, el destacado y la baja solo cuando existen', () => {
    const card = toCardProduct(
      product({
        is_featured: true,
        offer_info: {
          free_shipping: false,
          is_full: true,
          sold_by_ml: false,
          official_store: false,
          warranty: null,
          offers_count: 3,
          is_lowest: null,
        },
      }),
      { amount: 5000, pct: 20, since: '2026-10-05T12:00:00Z' },
      NOW
    );
    expect(card.chip).toBe('Full');
    expect(card.is_featured).toBe(true);
    expect(card.drop_amount).toBe(5000);

    const plain = toCardProduct(product({ specs: {} }), null);
    expect(Object.keys(plain)).not.toContain('chip');
    expect(Object.keys(plain)).not.toContain('is_featured');
    expect(Object.keys(plain)).not.toContain('drop_amount');
    expect(Object.keys(plain)).not.toContain('badges');
  });

  it('envío gratis gana a Full', () => {
    const card = toCardProduct(
      product({
        offer_info: {
          free_shipping: true,
          is_full: true,
          sold_by_ml: false,
          official_store: false,
          warranty: null,
          offers_count: null,
          is_lowest: null,
        },
      }),
      null,
      NOW
    );
    expect(card.chip).toBe('Envío gratis');
  });

  /*
   * Desde el 23-11-2026 Mercado Libre no entrega precios y cada producto
   * queda con el de su última revisión. Ese precio no se muestra como el de
   * hoy: va con su fecha y sin nada de la oferta, que también pudo cambiar.
   */
  describe('con el precio sin revisar hoy', () => {
    const offer = {
      free_shipping: true,
      is_full: true,
      sold_by_ml: false,
      official_store: false,
      warranty: null,
      offers_count: 3,
      is_lowest: null,
    };
    const drop = { amount: 5000, pct: 20, since: '2026-09-28T12:00:00Z' };

    it('revisado hace tres días: el precio con su día, sin descuento, envío ni baja', () => {
      // La revisión fue el 30-09 a las 21:00 de Chile.
      const card = toCardProduct(product({ offer_info: offer }), drop, Date.parse('2026-10-04T00:00:00Z'));
      expect(card.price).toBe(20000);
      expect(card.price_date).toBe('30/09');
      expect(card.original_price).toBeNull();
      expect(Object.keys(card)).not.toContain('chip');
      expect(Object.keys(card)).not.toContain('drop_amount');
      expect(Object.keys(card)).not.toContain('no_price');
    });

    it('nunca revisado, o hace más de un mes: no hay precio que mostrar', () => {
      for (const card of [
        toCardProduct(product({ price_checked_at: null, offer_info: offer }), drop, NOW),
        toCardProduct(product({ offer_info: offer }), drop, Date.parse('2026-11-05T00:00:00Z')),
      ]) {
        expect(card.no_price).toBe(true);
        expect(card.original_price).toBeNull();
        expect(Object.keys(card)).not.toContain('price_date');
        expect(Object.keys(card)).not.toContain('chip');
        expect(Object.keys(card)).not.toContain('drop_amount');
      }
    });

    it('revisado hoy no lleva fecha', () => {
      expect(Object.keys(toCardProduct(product(), null, NOW))).not.toContain('price_date');
    });
  });
});

describe('cardImageLoading', () => {
  it('las dos primeras con prioridad, el resto de la primera fila sin esperar, las demás al acercarse', () => {
    expect([0, 1, 2, 3, 4].map((i) => cardImageLoading(i, 4))).toEqual(['priority', 'priority', 'eager', 'eager', 'lazy']);
  });

  it('sin primera fila a la vista, todas al acercarse', () => {
    expect([0, 1].map((i) => cardImageLoading(i, 0))).toEqual(['lazy', 'lazy']);
  });
});
