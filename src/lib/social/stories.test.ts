import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
// La lectura del historial va a Supabase: acá solo se prueba lo puro.
vi.mock('@/lib/queries/price-history', () => ({ getPriceStatsMany: vi.fn(async () => new Map()) }));
// lib/settings usa cache() de React, que solo existe dentro de Next.
vi.mock('@/lib/settings', () => ({ readAffiliateSettings: vi.fn() }));

import { checkPiecePath, pieceKey } from '@/lib/social/piece-url';
import { NETWORK_RULES } from '@/lib/social/networks';
import { STORY_RULES, buildStoryItem } from '@/lib/social/stories';
import { pickByRules, type SocialProduct } from '@/lib/social/telegram';

const NOW = new Date('2026-10-12T15:00:00Z');
const KEY = pieceKey({ CRON_SECRET: 'un-secreto-de-prueba-de-mas-de-32-caracteres' } as unknown as NodeJS.ProcessEnv)!;
const DIRECT = { word: 'comparatech', tool: '12345', directLinks: true };
const MELI_LA = { word: null, tool: null, directLinks: false };

let seq = 0;
function product(over: Partial<SocialProduct> = {}): SocialProduct {
  seq++;
  return {
    id: `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`,
    slug: `producto-${seq}`,
    name: `Audífonos Marca Modelo ${seq}`,
    brand: 'Marca',
    category: 'audio',
    price: 80_000,
    original_price: 100_000,
    image_url: 'https://http2.mlstatic.com/D_NQ_NP_123-O.webp',
    affiliate_url: 'https://meli.la/abc',
    ml_product_id: 'MLC123',
    ml_family_id: null,
    price_checked_at: new Date(NOW.getTime() - 20 * 60_000).toISOString(),
    seller_reputation: 'verde',
    seller_sales_count: 10_000,
    is_active: true,
    is_hidden: false,
    offer_info: { free_shipping: true, is_full: false },
    ml_root_category: null,
    deleted_at: null,
    ...over,
  };
}

function pickOne(p: SocialProduct, drops?: Map<string, number>) {
  const [pick] = pickByRules([p], { now: NOW, recentlyPosted: new Set(), drops }, STORY_RULES);
  return pick;
}

describe('STORY_RULES', () => {
  it('usa las reglas del plan de publicaciones, con más productos', () => {
    expect(STORY_RULES.minDiscount).toBe(NETWORK_RULES.minDiscount);
    expect(STORY_RULES.maxPriceAgeMs).toBe(NETWORK_RULES.maxPriceAgeMs);
    expect(STORY_RULES.repeatAfterDays).toBe(NETWORK_RULES.repeatAfterDays);
    expect(STORY_RULES.maxPosts).toBeGreaterThan(NETWORK_RULES.maxPosts);
  });

  it('no pasa de ocho ni de dos por categoría', () => {
    const rows = [
      ...Array.from({ length: 5 }, () => product({ category: 'audio' })),
      ...Array.from({ length: 5 }, () => product({ category: 'gaming' })),
      ...Array.from({ length: 5 }, () => product({ category: 'hogar' })),
      ...Array.from({ length: 5 }, () => product({ category: 'celulares' })),
      ...Array.from({ length: 5 }, () => product({ category: 'computacion' })),
    ];
    const picks = pickByRules(rows, { now: NOW, recentlyPosted: new Set() }, STORY_RULES);
    expect(picks).toHaveLength(8);
    const perCategory = new Map<string, number>();
    for (const pick of picks) perCategory.set(pick.product.category, (perCategory.get(pick.product.category) ?? 0) + 1);
    expect(Math.max(...perCategory.values())).toBe(2);
  });
});

describe('buildStoryItem', () => {
  it('entrega la pieza de historia firmada, con el precio de ahora', () => {
    const p = product();
    const item = buildStoryItem(pickOne(p), { now: NOW, settings: DIRECT, key: KEY })!;
    expect(item.image.startsWith(`/social/pieza/${p.id}/story-80000-100000-`)).toBe(true);

    const file = item.image.split('/').pop()!;
    const check = checkPiecePath(p.id, file, KEY, Math.floor(NOW.getTime() / 1000));
    expect(check.ok).toBe(true);
    if (check.ok) {
      expect(check.snapshot.format).toBe('story');
      expect(check.snapshot.price).toBe(80_000);
      expect(check.snapshot.listPrice).toBe(100_000);
    }
  });

  it('el link es el mismo destino que el botón del sitio', () => {
    const p = product();
    const direct = buildStoryItem(pickOne(p), { now: NOW, settings: DIRECT, key: KEY })!;
    expect(direct.link).toBe('https://www.mercadolibre.cl/p/MLC123?matt_word=comparatech&matt_tool=12345');
    const saved = buildStoryItem(pickOne(p), { now: NOW, settings: MELI_LA, key: KEY })!;
    expect(saved.link).toBe('https://meli.la/abc');
  });

  it('muestra el descuento y el precio de lista solo cuando hay rebaja', () => {
    const withList = buildStoryItem(pickOne(product()), { now: NOW, settings: DIRECT, key: KEY })!;
    expect(withList).toMatchObject({ discount: 20, listPrice: 100_000, drop: null });

    // Sin precio de lista entra solo por la baja que confirma el historial.
    const p = product({ original_price: null });
    const byDrop = buildStoryItem(pickOne(p, new Map([[p.id, 7.6]])), { now: NOW, settings: DIRECT, key: KEY })!;
    expect(byDrop).toMatchObject({ discount: 0, listPrice: null, drop: 8 });
    expect(byDrop.image).toContain('/story-80000-0-');
  });

  it('acorta el nombre y arma un nombre de archivo sin caracteres raros', () => {
    const p = product({ slug: 'Audífonos_Sony/WH-1000XM5 ', name: `Audífonos Sony WH-1000XM5 ${'muy largo '.repeat(12)}` });
    const item = buildStoryItem(pickOne(p), { now: NOW, settings: DIRECT, key: KEY })!;
    expect(item.fileName).toMatch(/^comparatech-[a-z0-9-]+-historia\.jpg$/);
    expect(item.name.length).toBeLessThanOrEqual(55);
  });

  it('sin precio válido no hay imagen ni historia', () => {
    const pick = pickOne(product());
    const broken = { ...pick, product: { ...pick.product, price: 0 } };
    expect(buildStoryItem(broken, { now: NOW, settings: DIRECT, key: KEY })).toBeNull();
  });
});
