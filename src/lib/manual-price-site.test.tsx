import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

/*
 * Lo que el sitio público muestra cuando un precio se revisó a mano
 * (lib/manual-price): el precio es de hoy, pero de la oferta no se sabe nada,
 * y unos pocos precios de hoy no hacen "de hoy" a una categoría entera.
 */

// lib/queries/products usa cache() de React 19 y lee Supabase: acá solo hace falta el descuento.
vi.mock('@/lib/queries/products', async () => {
  const { MIN_DEAL_DISCOUNT, discountOf } = await import('@/lib/deal-rank');
  return { MIN_DEAL_DISCOUNT, discountPercent: discountOf };
});

import { TrustChips } from '@/components/product/TrustChips';
import { categoryIntro, summarizeCategory } from '@/lib/category-listing';
import { CHANNEL_OFFER_INFO } from '@/lib/channel-price';
import { toCompareDetail } from '@/lib/compare';
import { MANUAL_OFFER_INFO } from '@/lib/manual-price';
import { commonPriceCheck, hasPricesToday, isManualPrice, priceOnlyKnown } from '@/lib/price-freshness';
import type { Product } from '@/lib/types';

const NOW = Date.parse('2026-11-24T21:30:00Z');
const TODAY = '2026-11-24T21:00:00Z';
const YESTERDAY = '2026-11-23T16:33:00Z';

let seq = 0;
function product(over: Partial<Product> = {}): Product {
  seq++;
  return {
    id: `id-${seq}`,
    slug: `producto-${seq}`,
    name: `Producto ${seq}`,
    brand: 'JBL',
    category: 'audio',
    price: 49_990,
    original_price: null,
    image_url: 'https://http2.mlstatic.com/D_1.webp',
    affiliate_url: 'https://meli.la/abc',
    description: '',
    specs: {},
    seller_reputation: 'verde',
    seller_sales_count: 1200,
    is_featured: false,
    is_active: true,
    is_hidden: false,
    ml_product_id: `MLC${seq}`,
    ml_domain_id: 'MLC-SPEAKERS',
    ml_family_id: null,
    seller_id: 99,
    rrss_status: 'sin_usar',
    created_at: '2026-01-01T00:00:00Z',
    inactive_reason: null,
    inactive_since: null,
    price_checked_at: YESTERDAY,
    winner_item_id: null,
    link_target_product_id: null,
    link_checked_at: null,
    ...over,
  };
}

describe('isManualPrice', () => {
  it('reconoce la marca que deja el admin, y nada más', () => {
    expect(isManualPrice({ offer_info: MANUAL_OFFER_INFO })).toBe(true);
    expect(isManualPrice({ offer_info: { source: 'manual' } })).toBe(true);
    expect(isManualPrice({ offer_info: { free_shipping: true } })).toBe(false);
    expect(isManualPrice({ offer_info: null })).toBe(false);
    expect(isManualPrice({ offer_info: 'manual' })).toBe(false);
    expect(isManualPrice({})).toBe(false);
  });
});

describe('commonPriceCheck: de cuándo son los precios de un conjunto', () => {
  const at = (iso: string | null) => ({ price_checked_at: iso });

  it('con unos pocos revisados hoy a mano, el conjunto sigue siendo del día de los demás', () => {
    const set = [...Array.from({ length: 20 }, () => at(YESTERDAY)), at(TODAY), at(TODAY)];
    expect(commonPriceCheck(set)).toBe(YESTERDAY);
    expect(hasPricesToday(set, NOW)).toBe(false);
  });

  it('con pocos productos manda el más antiguo: uno de tres revisado hoy no hace "de hoy" a los tres', () => {
    expect(commonPriceCheck([at(TODAY), at(YESTERDAY), at(TODAY)])).toBe(YESTERDAY);
    expect(commonPriceCheck([at(TODAY)])).toBe(TODAY);
    expect(hasPricesToday([at(TODAY), at(TODAY)], NOW)).toBe(true);
  });

  it('con todos revisados hoy (la revisión automática), es de hoy', () => {
    const set = Array.from({ length: 300 }, (_, i) => at(new Date(Date.parse(TODAY) + i * 100).toISOString()));
    expect(hasPricesToday(set, NOW)).toBe(true);
  });

  it('un puñado atrasado (hasta 1 de cada 10) no cambia la fecha de un conjunto grande', () => {
    const set = [...Array.from({ length: 95 }, () => at(TODAY)), ...Array.from({ length: 5 }, () => at('2026-10-01T00:00:00Z'))];
    expect(commonPriceCheck(set)).toBe(TODAY);
    const many = [...Array.from({ length: 80 }, () => at(TODAY)), ...Array.from({ length: 20 }, () => at(YESTERDAY))];
    expect(commonPriceCheck(many)).toBe(YESTERDAY);
  });

  it('sin ninguna fecha válida no hay fecha', () => {
    expect(commonPriceCheck([])).toBeNull();
    expect(commonPriceCheck([at(null), at('no es una fecha')])).toBeNull();
    expect(hasPricesToday([at(null)], NOW)).toBe(false);
    // Lo que no tiene fecha no cuenta: no arrastra a los que sí.
    expect(commonPriceCheck([at(null), at(TODAY)])).toBe(TODAY);
  });
});

describe('una categoría con unos pocos precios revisados hoy a mano', () => {
  it('sigue diciendo de qué día son sus precios, y no habla de "hoy"', () => {
    const products = [
      ...Array.from({ length: 12 }, () => product()),
      product({ price: 39_990, original_price: 59_990, price_checked_at: TODAY, offer_info: MANUAL_OFFER_INFO }),
    ];
    const summary = summarizeCategory(products, NOW);
    expect(summary.priceDate).toBe('23-11-2026');
    // El descuento del revisado hoy sí cuenta: es un precio de hoy con su tachado.
    expect(summary.dealCount).toBe(1);
    const intro = categoryIntro(summary);
    expect(intro).toContain('en nuestra última revisión de precios, el 23-11-2026');
    expect(intro).not.toMatch(/\bHoy\b/);
  });

  it('si todos se revisaron hoy, vuelve a hablar de hoy', () => {
    const products = Array.from({ length: 5 }, () => product({ price_checked_at: TODAY }));
    expect(summarizeCategory(products, NOW).priceDate).toBeNull();
  });
});

describe('la oferta de un precio revisado a mano', () => {
  const manual = () =>
    product({ price: 39_990, original_price: 59_990, price_checked_at: new Date().toISOString(), offer_info: MANUAL_OFFER_INFO });

  it('la ficha no muestra señales de la oferta: ni envío, ni tienda, ni la reputación del vendedor', () => {
    expect(renderToStaticMarkup(<TrustChips product={manual()} />)).toBe('');
    // Con la revisión automática, las señales de siempre.
    const auto = product({
      price_checked_at: new Date().toISOString(),
      offer_info: { free_shipping: true, is_full: false, sold_by_ml: false, official_store: false, warranty: null, offers_count: 1, is_lowest: null },
    });
    const html = renderToStaticMarkup(<TrustChips product={auto} />);
    expect(html).toContain('Envío gratis');
    expect(html).toContain('Vendedor reputación verde');
  });

  it('el comparador lleva el precio de hoy y su tachado, sin vendedor, envío ni garantía', () => {
    const offer = toCompareDetail(manual(), null).offer;
    expect(offer).toMatchObject({
      list_price: 59_990,
      free_shipping: false,
      is_full: false,
      seller: '',
      warranty: null,
      price_date: null,
      no_price: false,
    });
  });
});

describe('la oferta de un precio informado por el canal de afiliados', () => {
  const channel = () =>
    product({ price: 709_990, original_price: null, price_checked_at: new Date().toISOString(), offer_info: CHANNEL_OFFER_INFO });

  it('se trata igual que el revisado a mano: precio de hoy, sin señales de la oferta ni vendedor', () => {
    expect(priceOnlyKnown({ offer_info: CHANNEL_OFFER_INFO })).toBe(true);
    expect(priceOnlyKnown({ offer_info: MANUAL_OFFER_INFO })).toBe(true);
    expect(priceOnlyKnown({ offer_info: { free_shipping: true } })).toBe(false);
    expect(renderToStaticMarkup(<TrustChips product={channel()} />)).toBe('');
    expect(toCompareDetail(channel(), null).offer).toMatchObject({
      list_price: null,
      free_shipping: false,
      is_full: false,
      seller: '',
      warranty: null,
      price_date: null,
      no_price: false,
    });
  });
});
