import { beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * Las acciones de "Recomendaciones del canal": que el producto se ubique por
 * su link antes de buscarlo por nombre, y que guardar los precios del aviso
 * pase por las reglas de lib/channel-sync, firme quien lo hizo, rearme el
 * sitio solo si algo quedó escrito y no escriba fuera del sitio publicado.
 * Todo lo de alrededor es falso: no hay red ni base.
 */

const requireAdmin = vi.fn(async () => 'cristopher');
const processNotices = vi.fn();
const resolveShortLink = vi.fn();
const reviewDeal = vi.fn();
const revalidateTag = vi.fn();
const revalidatePath = vi.fn();
const notifyIndexNow = vi.fn(async (_urls: string[]) => ({ omitido: 'prueba' }));
let production = true;

vi.mock('next/cache', () => ({
  revalidateTag: (...a: unknown[]) => revalidateTag(...a),
  revalidatePath: (...a: unknown[]) => revalidatePath(...a),
}));
vi.mock('@/lib/supabase/server', () => ({ getSupabaseAdmin: () => ({ fake: 'admin' }) }));
vi.mock('@/lib/admin-auth', () => ({ requireAdmin: () => requireAdmin() }));
vi.mock('@/lib/runtime-env', () => ({ isProductionRuntime: () => production }));
vi.mock('@/lib/indexnow', () => ({ notifyIndexNow: (urls: string[]) => notifyIndexNow(urls) }));
vi.mock('@/lib/short-links', () => ({ resolveShortLink: (...a: unknown[]) => resolveShortLink(...a) }));
vi.mock('@/lib/site', () => ({ SITE_URL: 'https://www.comparatech.cl' }));
vi.mock('@/lib/channel-sync', () => ({
  processNotices: (...a: unknown[]) => processNotices(...a),
  dealOutcomeText: (d: { status: string }, test: boolean) => `${d.status}${test ? ' (prueba)' : ''}`,
}));
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

import { reviewNotice, saveNoticePrices } from './actions';

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
