import { beforeEach, describe, expect, it, vi } from 'vitest';

const search = vi.fn();
const inspect = vi.fn();
const select = vi.fn();

vi.mock('@/lib/ml-catalog', () => ({ searchCatalogProducts: (...a: unknown[]) => search(...a) }));
vi.mock('@/lib/manual-add', () => ({ inspectCatalogProduct: (...a: unknown[]) => inspect(...a) }));
vi.mock('@/lib/social/telegram', () => ({
  selectSocialProducts: (...a: unknown[]) => select(...a),
  isOnSale: (p: { is_active: boolean; is_hidden: boolean; deleted_at: string | null } | null) =>
    Boolean(p && p.is_active && !p.is_hidden && !p.deleted_at),
}));
vi.mock('@/lib/settings', () => ({ readAffiliateSettings: vi.fn() }));
vi.mock('@/lib/social/stories', () => ({
  STORY_RULES: { repeatAfterDays: 14 },
  readStoryHistory: vi.fn(),
  buildStoryItem: (pick: { product: { id: string; price: number } }) => ({ id: pick.product.id, price: pick.product.price, reason: '' }),
}));

import { dealContext, reviewDeal, similarHits, type DealContext } from './deal-notice-review';
import type { NoticeDeal } from './deal-notice';

const hit = (id: string, name: string, domainId = 'MLC-AIR_FRYERS', buyBox = true) => ({ id, name, domainId, buyBox, picture: null });
const product = (ml: string, extra: Record<string, unknown> = {}) => ({
  id: `uuid-${ml}`,
  ml_product_id: ml,
  name: `Producto ${ml}`,
  price: 79_990,
  original_price: 159_990,
  is_active: true,
  is_hidden: false,
  deleted_at: null,
  ...extra,
});
const preview = (id: string, state: string, reason?: string) => ({ kind: 'ficha', id, name: `Ficha ${id}`, state, reason, warnings: [] });

function ctx(): DealContext {
  const base = dealContext({ admin: {} as never, token: 't', affiliate: null, minCommission: 0 }, Buffer.alloc(32), new Date('2026-11-11T17:00:00Z'));
  return { ...base, storyHistory: async () => new Map(), affiliateSettings: async () => ({ word: 'w', tool: 't' }) as never };
}

const deal = (extra: Partial<NoticeDeal> = {}): NoticeDeal => ({
  name: 'Freidora de aire Kitchen-it Max Edition 12 L (Negro)',
  price: 79_990,
  coupon: null,
  mlId: null,
  ...extra,
});

beforeEach(() => {
  search.mockReset();
  inspect.mockReset();
  select.mockReset();
  select.mockResolvedValue({ rows: [], error: null });
});

describe('similarHits', () => {
  it('deja solo las parecidas, de la más a la menos parecida', () => {
    const hits = [
      hit('MLC1', 'Molde Silicon Freidora Aire Almohadilla Rojo', 'MLC-KITCHEN_MOLDS'),
      hit('MLC2', 'Freidora De Aire Max Edition 12l Kitchen-it Gris'),
      hit('MLC3', 'Freidora de aire Kitchen-it Electrodomésticos Max Edition de 12L color negro', 'MLC-AIR_FRYERS', false),
    ];
    expect(similarHits(deal().name, hits).map((h) => h.id)).toEqual(['MLC3', 'MLC2']);
  });
});

describe('reviewDeal', () => {
  it('lo que ya está en el sitio y a la venta sale con su historia y la nota del aviso', async () => {
    search.mockResolvedValue({ status: 'ok', items: [hit('MLC2', 'Freidora De Aire Max Edition 12l Kitchen-it Gris')] });
    select.mockResolvedValue({ rows: [product('MLC2', { price: 78_990 })], error: null });
    const result = await reviewDeal(deal(), ctx());
    expect(result.kind).toBe('historia');
    if (result.kind === 'historia') expect(result.item.reason).toBe('El aviso dice $79.990; hoy está a $78.990');
    expect(inspect).not.toHaveBeenCalled();
  });

  it('lo que falta pasa por la revisión de Agregar, primero las fichas con caja de compra', async () => {
    search.mockResolvedValue({
      status: 'ok',
      items: [
        hit('MLC3', 'Freidora de aire Kitchen-it Electrodomésticos Max Edition de 12L color negro', 'MLC-AIR_FRYERS', false),
        hit('MLC2', 'Freidora De Aire Max Edition 12l Kitchen-it Gris'),
      ],
    });
    inspect.mockResolvedValue({ preview: preview('MLC2', 'listo'), candidate: {} });
    const result = await reviewDeal(deal(), ctx());
    expect(result).toMatchObject({ kind: 'agregar', preview: { id: 'MLC2', state: 'listo' } });
    expect(inspect).toHaveBeenCalledTimes(1);
  });

  it('si la primera no se puede, prueba la siguiente; si ninguna, muestra el porqué de la primera', async () => {
    search.mockResolvedValue({
      status: 'ok',
      items: [hit('MLC3', 'Freidora de aire Kitchen-it Max Edition 12L negro'), hit('MLC2', 'Freidora De Aire Max Edition 12l Kitchen-it Gris')],
    });
    inspect
      .mockResolvedValueOnce({ preview: preview('MLC3', 'no_se_puede', 'Sin ganador'), candidate: null })
      .mockResolvedValueOnce({ preview: preview('MLC2', 'no_se_puede', 'Vendedor sin reputación verde'), candidate: null });
    const result = await reviewDeal(deal(), ctx());
    expect(result).toMatchObject({ kind: 'agregar', preview: { id: 'MLC3', reason: 'Sin ganador' } });
    expect(inspect).toHaveBeenCalledTimes(2);
  });

  it('lo que no es de un tipo que el sitio publica se salta sin revisarlo', async () => {
    search.mockResolvedValue({
      status: 'ok',
      items: [hit('MLC9', 'Aceite 5w30 Liqui Moly Sintético Molygen New Generation 4l', 'MLC-ENGINE_OILS')],
    });
    const result = await reviewDeal(deal({ name: 'Aceite 5W30 Liqui Moly Sintético Molygen New Generation 4 L' }), ctx());
    expect(result).toEqual(expect.objectContaining({ kind: 'fuera', domain: 'MLC-ENGINE_OILS' }));
    expect(inspect).not.toHaveBeenCalled();
  });

  it('en el sitio pero en pausa: se avisa', async () => {
    search.mockResolvedValue({ status: 'ok', items: [hit('MLC9', 'Aceite 5w30 Liqui Moly Molygen 4l', 'MLC-ENGINE_OILS')] });
    select.mockResolvedValue({ rows: [product('MLC9', { is_active: false })], error: null });
    const result = await reviewDeal(deal({ name: 'Aceite 5w30 Liqui Moly Molygen 4l' }), ctx());
    expect(result.kind).toBe('no_a_la_venta');
  });

  it('con un link limpio no busca por nombre', async () => {
    inspect.mockResolvedValue({ preview: preview('MLC63071662', 'listo'), candidate: {} });
    const result = await reviewDeal(deal({ mlId: 'MLC63071662', coupon: 'LOCURASDD' }), ctx());
    expect(search).not.toHaveBeenCalled();
    expect(result).toMatchObject({ kind: 'agregar', preview: { id: 'MLC63071662' } });
  });

  it('si Mercado Libre no responde o no hay nada parecido, lo dice', async () => {
    search.mockResolvedValueOnce({ status: 'error', failure: {} });
    expect((await reviewDeal(deal(), ctx())).kind).toBe('sin_ficha');
    search.mockResolvedValueOnce({ status: 'ok', items: [hit('MLC1', 'Molde Silicon Freidora Aire Almohadilla Rojo')] });
    expect((await reviewDeal(deal(), ctx())).kind).toBe('sin_ficha');
  });
});
