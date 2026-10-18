import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { SupabaseClient } from '@supabase/supabase-js';

/*
 * Limpiar el catálogo (/admin/productos/limpiar): qué se sugiere sacar, qué
 * nunca se sugiere, y las acciones de sacar y reponer en bloque. Nunca hay
 * red ni base de verdad.
 */

const mocks = vi.hoisted(() => ({
  admin: null as unknown,
  logged: [] as Record<string, unknown>[],
}));

vi.mock('@/lib/supabase/server', () => ({ getSupabaseAdmin: () => mocks.admin }));
vi.mock('@/lib/admin-auth', () => ({ requireAdmin: async () => 'cristopher' }));
vi.mock('@/lib/admin-audit', () => ({
  logAdminEvent: async (_admin: unknown, event: Record<string, unknown>) => {
    mocks.logged.push(event);
  },
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));

import {
  analyzeCatalog,
  cleanupView,
  reasonText,
  typeCounts,
  type CleanupItem,
  type CleanupRow,
} from '@/lib/catalog-cleanup';
import { removeProducts, restoreProducts } from '@/app/admin/productos/limpiar/actions';
import { CleanupList, CleanupRowCard } from '@/app/admin/productos/limpiar/CleanupList';

const NOW = new Date('2026-10-18T15:00:00Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();

let seq = 0;
function row(over: Partial<CleanupRow> = {}): CleanupRow {
  seq++;
  return {
    id: `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`,
    slug: `producto-${seq}`,
    name: `Producto ${seq}`,
    image_url: 'https://http2.mlstatic.com/D_1.jpg',
    price: 100_000,
    category: 'audio',
    ml_domain_id: 'MLC-HEADPHONES',
    ml_root_category: 'MLC1000',
    ml_family_id: null,
    is_active: true,
    inactive_since: null,
    inactive_reason: null,
    created_at: daysAgo(30),
    is_featured: false,
    ...over,
  };
}

const analyze = (rows: CleanupRow[], over: { clicks?: Map<string, number>; posted?: Set<string> } = {}) =>
  analyzeCatalog(rows, { clicks: over.clicks ?? new Map(), recentlyPosted: over.posted ?? new Set(), now: NOW });

const byName = (items: CleanupItem[]) => Object.fromEntries(items.map((i) => [i.name, i]));

describe('analyzeCatalog', () => {
  it('sugiere lo que lleva más de 7 días en pausa, no lo que recién se pausó', () => {
    const items = byName(
      analyze([
        row({ name: 'larga', is_active: false, inactive_since: daysAgo(12), inactive_reason: 'sin_ganador' }),
        row({ name: 'corta', is_active: false, inactive_since: daysAgo(3), inactive_reason: 'sin_ganador' }),
      ])
    );
    expect(items.larga.reasons).toEqual(['pausa_larga']);
    expect(items.larga.pausedDays).toBe(12);
    expect(items.corta.reasons).toEqual([]);
    expect(items.corta.pausedDays).toBe(3);
  });

  it('sugiere lo que deja menos de $1.000 por venta', () => {
    const items = byName(analyze([row({ name: 'pilas', price: 9_990 }), row({ name: 'audífonos', price: 49_990 })]));
    expect(items.pilas.reasons).toEqual(['comision_baja']);
    expect(items.pilas.commission).toBe(699);
    expect(items['audífonos'].reasons).toEqual([]);
  });

  it('de cada modelo con varios colores se queda el más barato a la venta; los otros se sugieren', () => {
    const items = byName(
      analyze([
        row({ name: 'negro', ml_family_id: 'F1', price: 60_000 }),
        row({ name: 'rojo', ml_family_id: 'F1', price: 55_000 }),
        // El más barato está sin vendedor: se queda el más barato de los que se venden.
        row({ name: 'azul', ml_family_id: 'F1', price: 50_000, is_active: false, inactive_since: daysAgo(1) }),
        row({ name: 'solo', ml_family_id: 'F2' }),
      ])
    );
    expect(items.rojo.reasons).toEqual([]);
    expect(items.negro.reasons).toEqual(['color_repetido']);
    expect(items.azul.reasons).toEqual(['color_repetido']);
    expect(items.solo.reasons).toEqual([]);
  });

  it('otra capacidad de la misma familia no es otro color: cada capacidad se queda con su más barato', () => {
    // Mercado Libre pone las capacidades de un celular en la misma familia que los colores.
    const items = byName(
      analyze([
        row({ name: 'Celular X (256 GB) - Negro', ml_family_id: 'F1', price: 1_000_000, ml_domain_id: 'MLC-CELLPHONES' }),
        row({ name: 'Celular X (256 GB) - Azul', ml_family_id: 'F1', price: 1_050_000, ml_domain_id: 'MLC-CELLPHONES' }),
        row({ name: 'Celular X (512 GB) - Negro', ml_family_id: 'F1', price: 1_300_000, ml_domain_id: 'MLC-CELLPHONES' }),
        row({ name: 'Celular X 8GB RAM 2 TB Plata', ml_family_id: 'F1', price: 2_500_000, ml_domain_id: 'MLC-CELLPHONES' }),
      ])
    );
    expect(items['Celular X (256 GB) - Negro'].reasons).toEqual([]);
    expect(items['Celular X (256 GB) - Azul'].reasons).toEqual(['color_repetido']);
    expect(items['Celular X (512 GB) - Negro'].reasons).toEqual([]);
    expect(items['Celular X 8GB RAM 2 TB Plata'].reasons).toEqual([]);
  });

  it('la capacidad que dice el nombre es la cifra más grande en GB o TB', async () => {
    const { storageOf } = await import('@/lib/catalog-cleanup');
    expect(storageOf('Apple iPhone 18 Pro Max (2 TB) - Color plata')).toBe(2048);
    expect(storageOf('Moto G86 Power 5g 8+256gb Azul')).toBe(256);
    expect(storageOf('Teléfono Samsung Galaxy A57 5G de 128 GB, 8 GB de RAM')).toBe(128);
    expect(storageOf('Parlante Jbl Charge 6 Negro')).toBeNull();
  });

  it('protege las versiones de un modelo con página propia: esa página las muestra todas', () => {
    const items = byName(
      analyze([
        row({ name: 'Apple iPhone 17 (256 GB) - Blanco', ml_family_id: 'F7', price: 1_074_804, ml_domain_id: 'MLC-CELLPHONES', category: 'celulares' }),
        row({ name: 'Apple iPhone 17 (256 GB) - Negro', ml_family_id: 'F7', price: 1_050_296, ml_domain_id: 'MLC-CELLPHONES', category: 'celulares' }),
      ])
    );
    const blanco = items['Apple iPhone 17 (256 GB) - Blanco'];
    expect(blanco.reasons).toEqual(['color_repetido']);
    expect(blanco.keep).toBe('Versión de iPhone 17, que tiene su página');
    expect(cleanupView(Object.values(items), 'sugeridos', NOW)).toEqual([]);
    expect(cleanupView(Object.values(items), 'colores', NOW)).toEqual([]);
  });

  it('protege lo fijado en portada, lo que tuvo clics este mes y lo publicado hace poco', () => {
    const featured = row({ name: 'portada', price: 5_000, is_featured: true });
    const clicked = row({ name: 'con clics', price: 5_000 });
    const posted = row({ name: 'en redes', price: 5_000 });
    const items = byName(
      analyze([featured, clicked, posted], { clicks: new Map([[clicked.id, 3]]), posted: new Set([posted.id]) })
    );
    expect(items.portada.keep).toBe('Fijado en la portada');
    expect(items['con clics'].keep).toBe('3 clics este mes');
    expect(items['en redes'].keep).toBe('Publicado en redes hace poco');
    // Tienen motivo, pero no aparecen entre los sugeridos.
    expect(cleanupView(Object.values(items), 'sugeridos', NOW)).toEqual([]);
  });
});

describe('cleanupView', () => {
  const items = analyze([
    row({ name: 'dos motivos', price: 5_000, is_active: false, inactive_since: daysAgo(20) }),
    row({ name: 'barato', price: 12_000 }),
    row({ name: 'normal', price: 200_000 }),
    row({ name: 'nuevo protegido', price: 3_000, created_at: daysAgo(1), is_featured: true }),
    row({ name: 'nuevo', created_at: daysAgo(2), ml_domain_id: 'MLC-CELLPHONES' }),
  ]);

  it('sugeridos: primero lo que tiene más motivos, después lo que menos comisión deja', () => {
    expect(cleanupView(items, 'sugeridos', NOW).map((i) => i.name)).toEqual(['dos motivos', 'barato']);
    expect(cleanupView(items, 'pausa', NOW).map((i) => i.name)).toEqual(['dos motivos']);
    expect(cleanupView(items, 'comision', NOW).map((i) => i.name)).toEqual(['dos motivos', 'barato']);
  });

  it('recién agregados muestra todo lo de la semana (lo protegido también), lo más nuevo primero', () => {
    expect(cleanupView(items, 'recientes', NOW).map((i) => i.name)).toEqual(['nuevo protegido', 'nuevo']);
  });

  it('por tipo filtra un tipo de producto y cuenta cuántos hay de cada uno', () => {
    expect(cleanupView(items, 'tipo', NOW, 'MLC-CELLPHONES').map((i) => i.name)).toEqual(['nuevo']);
    expect(typeCounts(items)).toEqual([
      { domainId: 'MLC-HEADPHONES', label: 'Audífonos', count: 4 },
      { domainId: 'MLC-CELLPHONES', label: expect.any(String), count: 1 },
    ]);
  });

  it('dice cada motivo en simple', () => {
    const item = items.find((i) => i.name === 'dos motivos')!;
    expect(reasonText(item, 'pausa_larga')).toBe('Lleva 20 días en pausa');
    expect(reasonText(item, 'comision_baja')).toBe('Deja ~$350 por venta');
    expect(reasonText(item, 'color_repetido')).toBe('Otro color de un modelo que ya está');
  });
});

// ---------------------------------------------------------------------------
// Las acciones
// ---------------------------------------------------------------------------

type Call = { patch: Record<string, unknown>; filters: string[] };

function fakeAdmin(respond: (call: Call) => { data?: unknown; error?: { code?: string; message: string } | null }) {
  const calls: Call[] = [];
  const client = {
    from(table: string) {
      expect(table).toBe('products');
      const call: Call = { patch: {}, filters: [] };
      const builder: Record<string, unknown> = {};
      builder.update = (patch: Record<string, unknown>) => {
        call.patch = patch;
        calls.push(call);
        return builder;
      };
      for (const m of ['in', 'eq', 'not', 'select']) {
        builder[m] = (...args: unknown[]) => {
          call.filters.push(`${m}:${JSON.stringify(args)}`);
          return builder;
        };
      }
      builder.then = (resolve: (v: unknown) => unknown) =>
        Promise.resolve({ data: null, error: null, ...respond(call) }).then(resolve);
      return builder;
    },
  } as unknown as SupabaseClient;
  return { client, calls };
}

const A = '00000000-0000-4000-8000-00000000000a';
const B = '00000000-0000-4000-8000-00000000000b';

describe('removeProducts y restoreProducts', () => {
  beforeEach(() => {
    mocks.logged.length = 0;
  });
  afterEach(() => {
    mocks.admin = null;
  });

  it('saca del sitio solo lo que estaba visible, lo anota y devuelve lo que cambió', async () => {
    const { client, calls } = fakeAdmin(() => ({ data: [{ id: A, name: 'Pilas' }] }));
    mocks.admin = client;

    expect(await removeProducts([A, B, 'no-es-un-id', A])).toEqual({ ok: true, ids: [A] });
    expect(calls[0].patch).toMatchObject({ is_hidden: true });
    expect(typeof calls[0].patch.deleted_at).toBe('string');
    expect(calls[0].filters).toContain(`in:${JSON.stringify(['id', [A, B]])}`);
    expect(calls[0].filters).toContain('eq:["is_hidden",false]');
    expect(mocks.logged).toEqual([
      { actor: 'cristopher', action: 'limpiar_catalogo', target: '1 productos', after: { count: 1, ids: [A], names: ['Pilas'] } },
    ]);
  });

  it('sin la migración 0017 lo deja solo oculto, que para el sitio es lo mismo', async () => {
    let n = 0;
    const { client, calls } = fakeAdmin(() =>
      ++n === 1 ? { error: { code: '42703', message: 'column "deleted_at" does not exist' } } : { data: [{ id: A, name: 'x' }] }
    );
    mocks.admin = client;
    expect(await removeProducts([A])).toEqual({ ok: true, ids: [A] });
    expect(calls[1].patch).toEqual({ is_hidden: true });
  });

  it('no acepta tandas de más de 200', async () => {
    mocks.admin = fakeAdmin(() => ({ data: [] })).client;
    const many = Array.from({ length: 201 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`);
    expect(await removeProducts(many)).toEqual({ ok: false, error: 'Máximo 200 productos por tanda' });
  });

  it('"Deshacer" repone solo lo marcado como eliminado y lo anota', async () => {
    const { client, calls } = fakeAdmin(() => ({ data: [{ id: A }, { id: B }] }));
    mocks.admin = client;
    expect(await restoreProducts([A, B])).toEqual({ ok: true, ids: [A, B] });
    expect(calls[0].patch).toEqual({ is_hidden: false, deleted_at: null });
    expect(calls[0].filters).toContain('not:["deleted_at","is",null]');
    expect(mocks.logged[0]).toMatchObject({ action: 'reponer_productos', after: { count: 2 } });
  });
});

// ---------------------------------------------------------------------------
// Lo que se dibuja
// ---------------------------------------------------------------------------

describe('la lista', () => {
  const [lowItem] = analyze([row({ name: 'Cable HDMI', price: 5_990, ml_domain_id: 'MLC-AUDIO_AND_VIDEO_CABLES_AND_ADAPTERS' })]);

  it('cada fila dice precio, tipo, comisión y por qué se sugiere', () => {
    const html = renderToStaticMarkup(
      <CleanupRowCard item={lowItem} selected={false} onToggle={() => {}} view="sugeridos" />
    );
    expect(html).toContain('Cable HDMI');
    expect(html).toContain('Deja ~$419 por venta');
    expect(html).toContain('comisión ~$419');
    expect(html).toContain('href="/producto/');
  });

  it('ofrece elegir todos, y si no hay nada lo dice', () => {
    expect(renderToStaticMarkup(<CleanupList items={[lowItem]} total={1} view="sugeridos" />)).toContain(
      'Seleccionar todos (1)'
    );
    expect(renderToStaticMarkup(<CleanupList items={[]} total={0} view="pausa" />)).toContain(
      'Nada lleva tantos días en pausa.'
    );
  });
});
