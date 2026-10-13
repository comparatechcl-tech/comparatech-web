import { beforeEach, describe, expect, it, vi } from 'vitest';

// La lectura del historial va a Supabase: acá se entrega ya leída.
vi.mock('@/lib/queries/price-history', () => {
  const getPriceStatsMany = vi.fn(async (_ids: string[]) => new Map());
  // La lectura que avisa lo que no pudo leer se arma sobre la misma de mentira: acá se lee todo.
  const getPriceStatsManyChecked = vi.fn(async (ids: string[]) => ({ stats: await getPriceStatsMany(ids), unread: new Set<string>() }));
  return { getPriceStatsMany, getPriceStatsManyChecked };
});

import type { PriceStats } from '@/lib/deals';
import { getPriceStatsMany, getPriceStatsManyChecked } from '@/lib/queries/price-history';
import { countUnreadHistory, readInterestEvidence } from '@/lib/social/drops';

const NOW = new Date('2026-10-12T15:00:00Z');
const NO_HISTORY = { drop: null, min30: null, daysTracked: 0, historyUnread: false };
/** Lo que el historial agrega cuando el precio está quieto. */
const CALM = { recentChanges: 0, seesaw: false, changedFromUnknown: false, historyUnread: false };

let seq = 0;
function row(price: number, original_price: number | null) {
  seq++;
  return { id: `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`, price, original_price };
}

/** Un historial de 20 días en que el precio de hoy rige desde hace dos, tras bajar desde `previous`. */
function stats(price: number, previous: number, over: Partial<PriceStats> = {}): PriceStats {
  return {
    min30: price,
    median30: previous,
    max30: previous,
    minTracked: price,
    maxTracked: previous,
    daysTracked: 20,
    lastPrice: price,
    previousPrice: previous,
    lastChangeAt: new Date(NOW.getTime() - 2 * 86_400_000).toISOString(),
    lastPriceSeenRecently: false,
    changesLast48h: 0,
    previousIsFirstRecord: false,
    lastPriceNearRecent: false,
    ...over,
    // Salvo que el test diga otra cosa: el mínimo se sostuvo y el precio anterior era el habitual.
    min30Held: over.min30Held ?? over.min30 ?? price,
    usualPriceBefore: 'usualPriceBefore' in over ? over.usualPriceBefore ?? null : 'previousPrice' in over ? over.previousPrice ?? null : previous,
    firstSeenAt: over.firstSeenAt ?? new Date(NOW.getTime() - 20 * 86_400_000).toISOString(),
    trackedBeforeChangeMs:
      'trackedBeforeChangeMs' in over ? over.trackedBeforeChangeMs ?? null : ('previousPrice' in over ? over.previousPrice ?? null : previous) === null ? null : 18 * 86_400_000,
  };
}

beforeEach(() => {
  vi.mocked(getPriceStatsMany).mockReset();
  vi.mocked(getPriceStatsMany).mockResolvedValue(new Map());
});

describe('readInterestEvidence', () => {
  it('lee el historial de todos, también de los que ya traen un buen descuento de lista', async () => {
    const deal = row(60_000, 100_000);
    const flat = row(90_000, null);
    vi.mocked(getPriceStatsMany).mockResolvedValueOnce(
      new Map([
        // El de 40% de lista estuvo a $45.000 hace poco: sin leerlo, se publicaría como oferta.
        [deal.id, stats(60_000, 45_000, { min30: 45_000, minTracked: 45_000, max30: 60_000, maxTracked: 60_000, daysTracked: 25 })],
        [flat.id, stats(90_000, 100_000)],
      ])
    );

    const evidence = await readInterestEvidence([deal, flat], NOW);
    expect(vi.mocked(getPriceStatsMany)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(getPriceStatsMany)).toHaveBeenLastCalledWith([deal.id, flat.id]);

    // Subió: no hay baja que contar, pero sí el mínimo de 30 días.
    expect(evidence.get(deal.id)).toEqual({ drop: null, min30: 45_000, daysTracked: 25, ...CALM });
    const seen = evidence.get(flat.id)!;
    expect(seen.min30).toBe(90_000);
    expect(seen.daysTracked).toBe(20);
    expect(seen.drop?.amount).toBe(10_000);
    expect(seen.drop?.pct).toBeCloseTo(10);
  });

  it('cada producto pedido tiene su entrada; sin historial, no se afirma nada', async () => {
    const tracked = row(80_000, 100_000);
    const unseen = row(50_000, 70_000);
    vi.mocked(getPriceStatsMany).mockResolvedValueOnce(new Map([[tracked.id, stats(80_000, 80_000, { previousPrice: null, lastChangeAt: null })]]));

    const evidence = await readInterestEvidence([tracked, unseen], NOW);
    expect([...evidence.keys()]).toEqual([tracked.id, unseen.id]);
    expect(evidence.get(tracked.id)).toEqual({ drop: null, min30: 80_000, daysTracked: 20, ...CALM });
    expect(evidence.get(unseen.id)).toEqual(NO_HISTORY);
  });

  it('no lee el historial de lo que igual no puede salir', async () => {
    const posted = row(60_000, 100_000);
    const candidate = row(70_000, 100_000);

    const evidence = await readInterestEvidence([posted, candidate], NOW, new Set([posted.id]));
    expect(vi.mocked(getPriceStatsMany)).toHaveBeenLastCalledWith([candidate.id]);
    expect(evidence.has(posted.id)).toBe(false);
    expect(evidence.has(candidate.id)).toBe(true);

    // Sin nada que pueda salir, ni siquiera consulta.
    vi.mocked(getPriceStatsMany).mockClear();
    expect((await readInterestEvidence([posted], NOW, new Set([posted.id]))).size).toBe(0);
    expect((await readInterestEvidence([], NOW)).size).toBe(0);
    expect(vi.mocked(getPriceStatsMany)).not.toHaveBeenCalled();
  });

  it('nunca lanza: si el historial no se pudo leer, la evidencia lo dice', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const a = row(60_000, 100_000);
    const b = row(90_000, null);
    vi.mocked(getPriceStatsMany).mockRejectedValueOnce(new Error('sin conexión'));

    const evidence = await readInterestEvidence([a, b], NOW);
    // No es "sin historial": de estos no se sabe si estuvieron más baratos.
    expect(evidence.get(a.id)).toEqual({ ...NO_HISTORY, historyUnread: true });
    expect(evidence.get(b.id)).toEqual({ ...NO_HISTORY, historyUnread: true });
    expect(countUnreadHistory(evidence)).toBe(2);
    warn.mockRestore();
  });

  it('si solo una tanda no se pudo leer, solo esos productos quedan marcados', async () => {
    const read = row(60_000, 100_000);
    const lost = row(70_000, 100_000);
    const unseen = row(50_000, 70_000);
    vi.mocked(getPriceStatsManyChecked).mockResolvedValueOnce({
      stats: new Map([[read.id, stats(60_000, 60_000, { previousPrice: null, lastChangeAt: null })]]),
      unread: new Set([lost.id]),
    });

    const evidence = await readInterestEvidence([read, lost, unseen], NOW);
    expect(evidence.get(read.id)?.historyUnread).toBe(false);
    expect(evidence.get(lost.id)).toEqual({ ...NO_HISTORY, historyUnread: true });
    // Leído y sin registros: ese sí es "sin historial".
    expect(evidence.get(unseen.id)).toEqual(NO_HISTORY);
    expect(countUnreadHistory(evidence)).toBe(1);
  });

  it('un primer registro reciente que no es el de partida es un cambio desde un precio que no se conoce', async () => {
    const hoursAgo = (hours: number) => new Date(NOW.getTime() - hours * 3_600_000).toISOString();
    const single = { firstSeenAt: hoursAgo(5), previousPrice: null, lastChangeAt: null, daysTracked: 0 };
    // Agregado hace tres días; su único registro es de hace cinco horas: cambió, y no se sabe desde cuánto.
    const changed = { ...row(60_000, 100_000), created_at: hoursAgo(72) };
    // Agregado hace cinco horas: ese registro es su precio de partida.
    const fresh = { ...row(60_000, 100_000), created_at: hoursAgo(5) };
    // Sin la fecha de alta se supone lo prudente.
    const undated = row(60_000, 100_000);
    // El mismo caso con el registro de hace tres días: ya no es un cambio reciente, pero sigue sin saberse desde cuánto.
    const settled = { ...row(60_000, 100_000), created_at: hoursAgo(200) };
    // Y con el registro de hace 31 días: pasó la ventana en que se mira si estuvo más barato.
    const aged = { ...row(60_000, 100_000), created_at: hoursAgo(60 * 24) };
    // Primer cambio desde un precio desconocido hace 30 horas y otro hace 5: dos cambios recientes.
    const twice = { ...row(60_000, 100_000), created_at: hoursAgo(200) };
    vi.mocked(getPriceStatsMany).mockResolvedValueOnce(
      new Map([
        [changed.id, stats(60_000, 60_000, single)],
        [fresh.id, stats(60_000, 60_000, single)],
        [undated.id, stats(60_000, 60_000, single)],
        [settled.id, stats(60_000, 60_000, { ...single, firstSeenAt: hoursAgo(72), daysTracked: 3 })],
        [aged.id, stats(60_000, 60_000, { ...single, firstSeenAt: hoursAgo(31 * 24), daysTracked: 31 })],
        [twice.id, stats(60_000, 65_000, { firstSeenAt: hoursAgo(30), changesLast48h: 1, lastChangeAt: hoursAgo(5) })],
      ])
    );

    const evidence = await readInterestEvidence([changed, fresh, undated, settled, aged, twice], NOW);
    expect(evidence.get(changed.id)).toMatchObject({ changedFromUnknown: true, recentChanges: 1 });
    expect(evidence.get(fresh.id)).toMatchObject({ changedFromUnknown: false, recentChanges: 0 });
    expect(evidence.get(undated.id)).toMatchObject({ changedFromUnknown: true, recentChanges: 1 });
    expect(evidence.get(settled.id)).toMatchObject({ changedFromUnknown: true, recentChanges: 0 });
    expect(evidence.get(aged.id)).toMatchObject({ changedFromUnknown: false, recentChanges: 0 });
    // Ya hay un precio anterior conocido: no es "desde no se sabe cuánto", pero sí precio movido.
    expect(evidence.get(twice.id)).toMatchObject({ changedFromUnknown: false, recentChanges: 2 });
  });

  it('un resumen guardado sin la fecha del primer registro se trata como cambio reciente', async () => {
    const old = { ...row(60_000, 100_000), created_at: new Date(NOW.getTime() - 30 * 86_400_000).toISOString() };
    const stale = { ...stats(60_000, 60_000, { previousPrice: null, lastChangeAt: null }), firstSeenAt: undefined as unknown as string };
    vi.mocked(getPriceStatsMany).mockResolvedValueOnce(new Map([[old.id, stale]]));
    expect((await readInterestEvidence([old], NOW)).get(old.id)).toMatchObject({ changedFromUnknown: true, recentChanges: 1 });
  });

  it('un precio que fue y volvió deja de contar como movido cuando lleva una semana quieto', async () => {
    const daysAgo = (days: number) => new Date(NOW.getTime() - days * 86_400_000).toISOString();
    const recent = row(60_000, 100_000);
    const old = row(60_000, 100_000);
    vi.mocked(getPriceStatsMany).mockResolvedValueOnce(
      new Map([
        [recent.id, stats(60_000, 65_000, { lastPriceSeenRecently: true, lastChangeAt: daysAgo(3) })],
        [old.id, stats(60_000, 65_000, { lastPriceSeenRecently: true, lastChangeAt: daysAgo(25) })],
      ])
    );
    const evidence = await readInterestEvidence([recent, old], NOW);
    expect(evidence.get(recent.id)?.seesaw).toBe(true);
    expect(evidence.get(old.id)?.seesaw).toBe(false);
  });

  it('el mínimo es el que se sostuvo, y el precio movido viaja en la evidencia', async () => {
    const blip = row(60_000, 100_000);
    const moving = row(60_000, 100_000);
    const pending = row(58_000, 100_000);
    vi.mocked(getPriceStatsMany).mockResolvedValueOnce(
      new Map([
        // Estuvo dos horas a $45.000: baja el mínimo de 30 días, pero no el sostenido.
        [blip.id, stats(60_000, 45_000, { min30: 45_000, min30Held: 60_000 })],
        [moving.id, stats(60_000, 65_000, { changesLast48h: 5, lastPriceSeenRecently: true })],
        // El historial todavía dice $60.000 y la ficha ya está en $58.000: un cambio que falta anotar.
        [pending.id, stats(60_000, 65_000, { changesLast48h: 1 })],
      ])
    );

    const evidence = await readInterestEvidence([blip, moving, pending], NOW);
    expect(evidence.get(blip.id)?.min30).toBe(60_000);
    expect(evidence.get(moving.id)).toMatchObject({ recentChanges: 5, seesaw: true });
    expect(evidence.get(pending.id)?.recentChanges).toBe(2);
  });

  it('una baja de hace más de 30 días ya no cuenta como baja', async () => {
    const p = row(90_000, null);
    const old = new Date(NOW.getTime() - 40 * 86_400_000).toISOString();
    vi.mocked(getPriceStatsMany).mockResolvedValueOnce(new Map([[p.id, stats(90_000, 100_000, { lastChangeAt: old, daysTracked: 60 })]]));
    expect((await readInterestEvidence([p], NOW)).get(p.id)).toEqual({ drop: null, min30: 90_000, daysTracked: 60, ...CALM });
  });
});
