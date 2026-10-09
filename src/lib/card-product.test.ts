import { describe, expect, it } from 'vitest';
import type { Product } from '@/lib/types';
import { toCardProduct } from '@/lib/card-product';
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

describe('toCardProduct', () => {
  it('lleva solo lo que la tarjeta muestra', () => {
    expect(toCardProduct(product())).toEqual({
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
      { amount: 5000, pct: 20, since: '2026-10-05T12:00:00Z' }
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
      })
    );
    expect(card.chip).toBe('Envío gratis');
  });
});
