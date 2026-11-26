import { beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * Las acciones de "Recomendaciones del canal": que el producto se ubique por
 * su link antes de buscarlo por nombre; que guardar los precios del aviso
 * pase por las reglas de lib/channel-sync, firme quien lo hizo, rearme el
 * sitio solo si algo quedó escrito y no escriba fuera del sitio publicado; y
 * que un producto que falta se pueda agregar con el precio del aviso.
 * Todo lo de alrededor es falso: no hay red ni base.
 */

const requireAdmin = vi.fn(async () => 'cristopher');
const processNotices = vi.fn();
const resolveShortLink = vi.fn();
const reviewDeal = vi.fn();
const revalidateTag = vi.fn();
const revalidatePath = vi.fn();
const notifyIndexNow = vi.fn(async (_urls: string[]) => ({ omitido: 'prueba' }));
const inspectCatalogProduct = vi.fn();
const saveManualCandidate = vi.fn();
const approveCandidate = vi.fn();
const logAdminEvent = vi.fn(async (_admin: unknown, _event: Record<string, unknown>) => {});
let production = true;

/** Lo que se escribió en products: el patch y sus filtros. */
const updates: { patch: unknown; filters: [string, unknown][] }[] = [];
const admin = {
  from(_table: string) {
    const op = { patch: undefined as unknown, filters: [] as [string, unknown][] };
    const b: Record<string, unknown> = {
      update: (patch: unknown) => {
        op.patch = patch;
        updates.push(op);
        return b;
      },
      eq: (column: string, value: unknown) => {
        op.filters.push([column, value]);
        return b;
      },
      then: (ok: (r: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(ok),
    };
    return b;
  },
};

vi.mock('next/cache', () => ({
  revalidateTag: (...a: unknown[]) => revalidateTag(...a),
  revalidatePath: (...a: unknown[]) => revalidatePath(...a),
}));
vi.mock('@/lib/supabase/server', () => ({ getSupabaseAdmin: () => admin }));
vi.mock('@/lib/admin-auth', () => ({ requireAdmin: () => requireAdmin() }));
vi.mock('@/lib/admin-audit', () => ({ logAdminEvent: (a: unknown, e: Record<string, unknown>) => logAdminEvent(a, e) }));
vi.mock('@/lib/runtime-env', () => ({ isProductionRuntime: () => production }));
vi.mock('@/lib/indexnow', () => ({ notifyIndexNow: (urls: string[]) => notifyIndexNow(urls) }));
vi.mock('@/lib/short-links', () => ({ resolveShortLink: (...a: unknown[]) => resolveShortLink(...a) }));
vi.mock('@/lib/site', () => ({ SITE_URL: 'https://www.comparatech.cl' }));
vi.mock('@/lib/channel-sync', () => ({
  processNotices: (...a: unknown[]) => processNotices(...a),
  dealOutcomeText: (d: { status: string }, test: boolean) => `${d.status}${test ? ' (prueba)' : ''}`,
}));
vi.mock('@/lib/manual-add', () => ({
  UNKNOWN_SELLER_ID: 0,
  inspectCatalogProduct: (...a: unknown[]) => inspectCatalogProduct(...a),
  saveManualCandidate: (...a: unknown[]) => saveManualCandidate(...a),
}));
vi.mock('@/app/admin/candidatos/actions', () => ({ approveCandidate: (...a: unknown[]) => approveCandidate(...a) }));
vi.mock('@/lib/ml-enrichment', () => ({ getMlToken: async () => 'token', mlTokenError: () => null }));
vi.mock('@/lib/ml-catalog', () => ({
  mapWithConcurrency: async <T, R>(items: T[], _n: number, fn: (item: T) => Promise<R>) => Promise.all(items.map(fn)),
}));
vi.mock('@/lib/admin-settings', () => ({ directLinksUsable: async () => false }));
vi.mock('@/lib/settings', () => ({ readAffiliateSettings: async () => ({ word: 'w', tool: 't' }) }));
vi.mock('@/lib/prospect-filter', () => ({ minCommissionFromEnv: () => 0 }));
vi.mock('@/lib/social/piece-url', () => ({ pieceKey: () => Buffer.alloc(32) }));
vi.mock('@/lib/social/deal-notice-review', () => ({
  dealContext: (review: unknown) => review,
  reviewDeal: (...a: unknown[]) => reviewDeal(...a),
}));

import { CHANNEL_OFFER_INFO } from '@/lib/channel-price';
import { addFromNotice, reviewNotice, saveNoticePrices } from './actions';

const NOTICE = [
  '🎧 Auriculares inalámbricos Pulse Elite Sony',
  '💰 Precio: $109.990',
  '👉 https://tinyurl.com/3vvdnnpn',
  '',
  '🎮 Consola PlayStation 5 Digital Slim',
  '💰 Precio: $709.990',
  '👉 https://tinyurl.com/yc8hrkdp',
].join('\n');

beforeEach(() => {
  vi.clearAllMocks();
  updates.length = 0;
  production = true;
});

describe('reviewNotice', () => {
  it('ubica cada producto por su link antes de revisarlo; si el link no se resuelve, queda para buscarlo por nombre', async () => {
    resolveShortLink.mockImplementation(async (link: string) =>
      link.endsWith('yc8hrkdp') ? { status: 'ficha', mlId: 'MLC61403702' } : { status: 'sin_resolver', reason: 'timeout' }
    );
    reviewDeal.mockImplementation(async (deal: { name: string }) => ({ kind: 'sin_ficha', deal, message: 'x' }));

    const res = await reviewNotice(NOTICE);
    expect(res.ok).toBe(true);
    expect(requireAdmin).toHaveBeenCalledTimes(1);
    const reviewed = reviewDeal.mock.calls.map(([deal]) => [(deal as { name: string }).name, (deal as { mlId: string | null }).mlId]);
    expect(reviewed).toEqual([
      ['Auriculares inalámbricos Pulse Elite Sony', null],
      ['Consola PlayStation 5 Digital Slim', 'MLC61403702'],
    ]);
  });
});

describe('saveNoticePrices', () => {
  const result = (over: Record<string, unknown> = {}) => ({
    products: 2,
    saved: 1,
    changed: 1,
    skipped: {},
    missing: [],
    pending: new Set<number>(),
    written: [{ id: 'p1', slug: 'consola-playstation-5-digital-slim', name: 'PS5', price: 709_990, changed: true }],
    deals: [
      { name: 'Auriculares inalámbricos Pulse Elite Sony', price: 109_990, mlId: 'MLC50000001', status: 'no_esta_en_el_sitio' },
      { name: 'Consola PlayStation 5 Digital Slim', price: 709_990, mlId: 'MLC61403702', status: 'guardado', changed: true },
    ],
    ...over,
  });

  it('guarda con la hora de ahora, firma quien lo pegó, rearma el sitio y avisa las fichas que cambiaron', async () => {
    processNotices.mockResolvedValue(result());
    const before = Date.now();
    const res = await saveNoticePrices(NOTICE);

    expect(requireAdmin).toHaveBeenCalledTimes(1);
    const [, notices, opts] = processNotices.mock.calls[0] as [unknown, { id: number; postedAt: string; text: string }[], { now: number; write: boolean; actor: string }];
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({ id: 0, text: NOTICE });
    expect(Date.parse(notices[0].postedAt)).toBeGreaterThanOrEqual(before);
    expect(opts).toMatchObject({ write: true, actor: 'cristopher' });
    expect(opts.now).toBe(Date.parse(notices[0].postedAt));

    expect(revalidateTag).toHaveBeenCalledWith('catalog');
    expect(revalidatePath).toHaveBeenCalledWith('/', 'layout');
    expect(notifyIndexNow).toHaveBeenCalledWith(['https://www.comparatech.cl/producto/consola-playstation-5-digital-slim']);
    expect(res).toEqual({
      ok: true,
      saved: 1,
      test: false,
      lines: [
        { name: 'Auriculares inalámbricos Pulse Elite Sony', text: 'no_esta_en_el_sitio', saved: false },
        { name: 'Consola PlayStation 5 Digital Slim', text: 'guardado', saved: true },
      ],
    });
  });

  it('si nada quedó escrito, no rearma el sitio ni avisa', async () => {
    processNotices.mockResolvedValue(result({ saved: 0, changed: 0, written: [] }));
    const res = await saveNoticePrices(NOTICE);
    expect(res).toMatchObject({ ok: true, saved: 0 });
    expect(revalidateTag).not.toHaveBeenCalled();
    expect(notifyIndexNow).not.toHaveBeenCalled();
  });

  it('fuera del sitio publicado corre en modo prueba: no escribe y lo dice', async () => {
    production = false;
    processNotices.mockResolvedValue(result({ written: [] }));
    const res = await saveNoticePrices(NOTICE);
    const [, , opts] = processNotices.mock.calls[0] as [unknown, unknown, { write: boolean }];
    expect(opts.write).toBe(false);
    expect(res).toMatchObject({ ok: true, test: true });
    if (res.ok) expect(res.lines[1].text).toBe('guardado (prueba)');
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  it('sin productos en lo pegado, o si la base falla, responde un error claro', async () => {
    expect(await saveNoticePrices('Hola, mañana hay ofertas')).toEqual({
      ok: false,
      error: 'No encontré productos con su link en lo que pegaste.',
    });
    expect(processNotices).not.toHaveBeenCalled();

    processNotices.mockRejectedValue(new Error('no se pudo leer el catálogo: caída'));
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await saveNoticePrices(NOTICE)).toEqual({
      ok: false,
      error: 'No se pudieron guardar los precios. Intenta de nuevo.',
    });
    errors.mockRestore();
  });

  it('sin sesión de admin no hace nada', async () => {
    requireAdmin.mockRejectedValueOnce(new Error('No autorizado'));
    await expect(saveNoticePrices(NOTICE)).rejects.toThrow('No autorizado');
    expect(processNotices).not.toHaveBeenCalled();
  });
});

describe('addFromNotice', () => {
  // Lo que la página manda de vuelta: el producto del aviso, con la ficha ya ubicada por su link.
  const deal = (over: Record<string, unknown> = {}) => ({
    name: 'Auriculares inalámbricos Pulse Elite Sony',
    price: 109_990,
    coupon: null,
    mlId: 'MLC50000001',
    amounts: [109_990],
    discountPct: null,
    conditional: false,
    ...over,
  });
  const ready = () => ({
    preview: { state: 'listo', name: 'Auriculares Pulse Elite', price: 109_990 },
    candidate: { ml_product_id: 'MLC50000001', name: 'Auriculares Pulse Elite' },
  });

  beforeEach(() => {
    inspectCatalogProduct.mockResolvedValue(ready());
    saveManualCandidate.mockResolvedValue({ ok: true, id: 'cand-1' });
    approveCandidate.mockResolvedValue({ ok: true, outcome: 'publicado', reason: 'pendiente', slug: 'auriculares-pulse-elite' });
  });

  it('publica el producto con el precio del aviso y deja su oferta marcada como del canal', async () => {
    const before = Date.now();
    const res = await addFromNotice(deal(), true);
    expect(res).toEqual({ ok: true, outcome: 'publicado', slug: 'auriculares-pulse-elite', reason: 'pendiente' });

    // La revisión recibe el precio del aviso y la hora en que se vio.
    const [id, raw, , known] = inspectCatalogProduct.mock.calls[0] as [string, string, unknown, { price: number; listPrice: number | null; seenAt: string }];
    expect([id, raw]).toEqual(['MLC50000001', 'MLC50000001']);
    expect(known).toMatchObject({ price: 109_990, listPrice: null });
    expect(Date.parse(known.seenAt)).toBeGreaterThanOrEqual(before);

    expect(saveManualCandidate).toHaveBeenCalledTimes(1);
    expect(approveCandidate).toHaveBeenCalledWith('cand-1', '');
    // Solo el producto que entró sin vendedor conocido.
    expect(updates).toEqual([
      {
        patch: { offer_info: CHANNEL_OFFER_INFO },
        filters: [
          ['ml_product_id', 'MLC50000001'],
          ['seller_id', 0],
        ],
      },
    ]);
    expect(revalidateTag).toHaveBeenCalledWith('catalog');
    expect(logAdminEvent.mock.calls[0][1]).toMatchObject({
      actor: 'cristopher',
      action: 'agregar_desde_ml',
      target: 'cand-1',
      after: { ml_product_id: 'MLC50000001', price: 109_990, origen: 'aviso del canal', publish: true },
    });
  });

  it('con "de $A a $B" lleva también el precio sin descuento', async () => {
    await addFromNotice(deal({ price: 79_990, amounts: [159_990, 79_990], discountPct: 50 }), false);
    const [, , , known] = inspectCatalogProduct.mock.calls[0] as [string, string, unknown, { price: number; listPrice: number | null }];
    expect(known).toMatchObject({ price: 79_990, listPrice: 159_990 });
  });

  it('sin publicar, queda en la cola y no toca products', async () => {
    expect(await addFromNotice(deal(), false)).toEqual({ ok: true, outcome: 'en_cola' });
    expect(approveCandidate).not.toHaveBeenCalled();
    expect(updates).toHaveLength(0);
  });

  it('si no se puede publicar, queda en la cola y dice por qué', async () => {
    approveCandidate.mockResolvedValue({ ok: false, error: 'Falta el link de afiliado.' });
    expect(await addFromNotice(deal(), true)).toEqual({ ok: true, outcome: 'en_cola', notPublished: 'Falta el link de afiliado.' });
    expect(updates).toHaveLength(0);
  });

  it('un precio con cupón, sin precio, o un producto sin ficha no se agregan', async () => {
    expect(await addFromNotice(deal({ coupon: 'PICK11' }), true)).toEqual({
      ok: false,
      error: expect.stringContaining('cupón'),
    });
    expect(await addFromNotice(deal({ conditional: true }), true)).toMatchObject({ ok: false });
    expect(await addFromNotice(deal({ price: null, amounts: [] }), true)).toEqual({
      ok: false,
      error: 'El aviso no trae el precio de este producto.',
    });
    expect(await addFromNotice(deal({ amounts: [219, 84_875] }), true)).toMatchObject({ ok: false });
    expect(await addFromNotice(deal({ mlId: null }), true)).toEqual({
      ok: false,
      error: 'No se sabe a qué ficha apunta este producto del aviso.',
    });
    expect(await addFromNotice('cualquier cosa', true)).toMatchObject({ ok: false });
    expect(inspectCatalogProduct).not.toHaveBeenCalled();
    expect(saveManualCandidate).not.toHaveBeenCalled();
  });

  it('lo que la revisión no deja pasar no se guarda', async () => {
    inspectCatalogProduct.mockResolvedValue({ preview: { state: 'en_sitio' }, candidate: null });
    expect(await addFromNotice(deal(), true)).toEqual({ ok: false, error: 'Este producto ya está en el sitio.' });
    inspectCatalogProduct.mockResolvedValue({ preview: { state: 'no_se_puede', reason: 'El sitio no tiene una categoría.' }, candidate: null });
    expect(await addFromNotice(deal(), true)).toEqual({ ok: false, error: 'El sitio no tiene una categoría.' });
    inspectCatalogProduct.mockResolvedValue({ notFound: true });
    expect(await addFromNotice(deal(), true)).toMatchObject({ ok: false, error: expect.stringContaining('MLC50000001') });
    expect(saveManualCandidate).not.toHaveBeenCalled();
  });

  it('sin sesión de admin no hace nada', async () => {
    requireAdmin.mockRejectedValueOnce(new Error('No autorizado'));
    await expect(addFromNotice(deal(), true)).rejects.toThrow('No autorizado');
    expect(inspectCatalogProduct).not.toHaveBeenCalled();
  });
});
