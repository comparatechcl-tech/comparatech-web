import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { SupabaseClient } from '@supabase/supabase-js';

/*
 * Pedir que se armen los videos cuando hay algo por armar: sin nada por armar
 * no se le pide nada a GitHub, una copia de prueba no pide, y el admin dice
 * claro en qué estado está.
 */

// lib/social/videos lee Supabase y el almacén: acá solo importa cuántos videos faltan.
vi.mock('@/lib/social/videos', () => ({ readVideoPicks: vi.fn() }));
vi.mock('@/app/admin/videos/build', () => ({ buildVideosNow: vi.fn() }));

import { readVideoPicks } from '@/lib/social/videos';
import { BuildNow } from '@/app/admin/videos/BuildNow';
import { nextPassText } from '@/app/admin/videos/texts';
import {
  MAX_REQUESTS,
  pendingVideos,
  recentBuildRequests,
  requestVideoBuild,
  videoCronActive,
  type BuildDeps,
} from './video-build';

const NOW = new Date('2026-11-26T17:12:00Z');
const admin = {} as SupabaseClient;

function deps(over: Partial<BuildDeps> = {}): BuildDeps & { dispatch: ReturnType<typeof vi.fn> } {
  return {
    pending: async () => 4,
    hasToken: () => true,
    dispatch: vi.fn(async () => ({ ok: true as const })),
    ...over,
  } as BuildDeps & { dispatch: ReturnType<typeof vi.fn> };
}

describe('requestVideoBuild', () => {
  it('con videos por armar, le pide a GitHub que los arme', async () => {
    const d = deps();
    await expect(requestVideoBuild(admin, NOW, { write: true }, d)).resolves.toEqual({ ok: true, pedido: true, porArmar: 4 });
    expect(d.dispatch).toHaveBeenCalledTimes(1);
  });

  it('sin nada por armar no le pide nada a GitHub', async () => {
    const d = deps({ pending: async () => 0 });
    await expect(requestVideoBuild(admin, NOW, { write: true }, d)).resolves.toEqual({
      ok: true,
      pedido: false,
      porArmar: 0,
      motivo: 'nada_por_armar',
    });
    expect(d.dispatch).not.toHaveBeenCalled();
  });

  it('fuera del sitio publicado cuenta lo que falta y no pide, tenga o no la llave', async () => {
    const d = deps({ hasToken: () => false });
    await expect(requestVideoBuild(admin, NOW, { write: false }, d)).resolves.toEqual({ ok: true, pedido: false, porArmar: 4, motivo: 'prueba' });
    expect(d.dispatch).not.toHaveBeenCalled();
  });

  it('sin la llave no lee el plan ni pide', async () => {
    const pending = vi.fn(async () => 4);
    const d = deps({ hasToken: () => false, pending });
    await expect(requestVideoBuild(admin, NOW, { write: true }, d)).resolves.toMatchObject({ ok: false, pedido: false, motivo: 'sin_llave' });
    expect(pending).not.toHaveBeenCalled();
    expect(d.dispatch).not.toHaveBeenCalled();
  });

  it('si GitHub no acepta el pedido, lo dice con el motivo', async () => {
    const d = deps({ dispatch: vi.fn(async () => ({ ok: false as const, reason: 'rechazada' as const, detail: 'GitHub no aceptó la llave' })) });
    await expect(requestVideoBuild(admin, NOW, { write: true }, d)).resolves.toEqual({
      ok: false,
      pedido: false,
      porArmar: 4,
      motivo: 'rechazada',
      detalle: 'GitHub no aceptó la llave',
    });
  });

  it('si no se puede leer el plan, no pide a ciegas', async () => {
    const d = deps({
      pending: async () => {
        throw new Error('No se pudo leer el catálogo: caída');
      },
    });
    await expect(requestVideoBuild(admin, NOW, { write: true }, d)).resolves.toMatchObject({ ok: false, pedido: false, motivo: 'plan' });
    expect(d.dispatch).not.toHaveBeenCalled();
  });
});

describe('pendingVideos', () => {
  it('cuenta los videos propuestos que todavía no están armados', async () => {
    vi.mocked(readVideoPicks).mockResolvedValue({
      date: '2026-11-26',
      unreadHistory: 0,
      picks: [{ exists: false }, { exists: true }, { exists: false }],
    } as never);
    await expect(pendingVideos(admin, NOW)).resolves.toBe(2);
  });
});

function runsAdmin(result: { data?: unknown; count?: number | null; error?: { message: string } | null }) {
  const filters: Array<[string, string, unknown]> = [];
  const query: Record<string, unknown> = {};
  for (const method of ['select', 'eq', 'gte']) {
    query[method] = (column: string, value: unknown) => {
      filters.push([method, column, value]);
      return query;
    };
  }
  query.limit = async () => ({ data: result.data ?? [], error: result.error ?? null });
  query.then = (ok: (r: unknown) => unknown) => Promise.resolve({ count: result.count ?? null, error: result.error ?? null }).then(ok);
  return { client: { from: () => query } as unknown as SupabaseClient, filters };
}

describe('videoCronActive', () => {
  it('está corriendo si hay una pasada anotada en los últimos 45 minutos', async () => {
    const { client, filters } = runsAdmin({ data: [{ id: 1 }] });
    await expect(videoCronActive(client, NOW)).resolves.toBe(true);
    expect(filters).toContainEqual(['eq', 'job', 'videos']);
    expect(filters).toContainEqual(['gte', 'started_at', '2026-11-26T16:27:00.000Z']);
  });

  it('sin pasadas recientes, o si la base falla, no', async () => {
    await expect(videoCronActive(runsAdmin({ data: [] }).client, NOW)).resolves.toBe(false);
    await expect(videoCronActive(runsAdmin({ error: { message: 'x' } }).client, NOW)).resolves.toBe(false);
    await expect(videoCronActive({ from: () => { throw new Error('caída'); } } as unknown as SupabaseClient, NOW)).resolves.toBe(false);
  });
});

describe('recentBuildRequests', () => {
  it('cuenta los pedidos hechos a GitHub en las últimas 3 horas', async () => {
    const { client, filters } = runsAdmin({ count: MAX_REQUESTS });
    await expect(recentBuildRequests(client, NOW)).resolves.toBe(MAX_REQUESTS);
    expect(filters).toContainEqual(['eq', 'summary->>pedido', 'true']);
    expect(filters).toContainEqual(['gte', 'started_at', '2026-11-26T14:12:00.000Z']);
  });

  it('si no se puede contar, no frena nada', async () => {
    await expect(recentBuildRequests(runsAdmin({ error: { message: 'x' } }).client, NOW)).resolves.toBe(0);
  });
});

describe('BuildNow', () => {
  it('sin la llave explica qué falta y no ofrece un botón que no puede funcionar', () => {
    const html = renderToStaticMarkup(<BuildNow ready={false} auto={false} maxAgeHours={6} />);
    expect(html).toContain('una llave de GitHub');
    expect(html).not.toContain('<button');
  });

  it('con la llave ofrece armar ahora, y dice si la revisión de cada media hora está corriendo', () => {
    const manual = renderToStaticMarkup(<BuildNow ready auto={false} maxAgeHours={6} />);
    expect(manual).toContain('Armar los videos ahora');
    expect(manual).toContain('todavía no está corriendo');
    const auto = renderToStaticMarkup(<BuildNow ready auto maxAgeHours={6} />);
    expect(auto).toContain('Armar los videos ahora');
    expect(auto).toContain('dentro de la media hora siguiente');
    expect(auto).toContain('6 horas');
  });
});

describe('nextPassText con la revisión automática', () => {
  it('no habla del horario de GitHub', () => {
    const text = nextPassText(new Date('2026-11-26T17:12:00Z'), true);
    expect(text).toContain('cada media hora');
    expect(text).not.toContain('GitHub');
    expect(text).not.toContain('programada');
  });

  it('sin ella sigue diciendo cuándo es la próxima pasada', () => {
    expect(nextPassText(new Date('2026-11-26T17:12:00Z'))).toContain('programada a las');
  });
});
