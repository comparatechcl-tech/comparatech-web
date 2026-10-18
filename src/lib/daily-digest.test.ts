import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  buildDigestHtml,
  buildDigestSubject,
  buildDigestText,
  errorsLine,
  healthLine,
  linkModeLine,
  pickTopToApprove,
  rankForApproval,
  type DigestCandidate,
  type DigestInput,
} from '@/lib/daily-digest';
import { gatherDigestInput } from '@/lib/digest-data';
import { minCommissionFromEnv, passesCommissionFloor } from '@/lib/prospect-filter';
import type { SourceProblem } from '@/lib/prospect-source';
import { parseRecipients, sendEmail, toBase64, toCsv } from '@/lib/email';

// cache() de React solo existe en el runtime de servidor de Next (lo usa
// lib/settings, que lee el modo de links).
vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  cache: <T,>(fn: T) => fn,
}));

/*
 * Tests del correo diario y de lo que lo rodea (piso de comisión de la
 * prospección, adjuntos y CSV del respaldo). Nunca hay red: Supabase y
 * fetch son falsos.
 */

function candidate(overrides: Partial<DigestCandidate> = {}): DigestCandidate {
  return {
    name: 'Audífonos Redmi Buds 6',
    price: 30_000,
    category: 'audio',
    image_url: 'https://http2.mlstatic.com/D_1.jpg',
    seller_nickname: 'TIENDA',
    original_price: null,
    ml_root_category: 'MLC1000',
    ...overrides,
  };
}

function input(overrides: Partial<DigestInput> = {}): DigestInput {
  return {
    newCandidates: [],
    topToApprove: [],
    pendingTotal: 0,
    publishedTotal: 120,
    needsLink: [],
    pausedCount: 0,
    adminUrl: 'https://comparatech.cl',
    daysSinceLastApproval: 0,
    linkMode: { directLinks: false, word: 'comparatech' },
    attribution: 'pendiente',
    lastPriceCheckMinutes: 12,
    clicsAyer: null,
    errors: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Asunto
// ---------------------------------------------------------------------------

describe('buildDigestSubject', () => {
  it('avisa los días sin publicar cuando pasan de 3', () => {
    expect(buildDigestSubject(input({ daysSinceLastApproval: 5, pendingTotal: 42 }))).toBe(
      'ComparaTech · 5 días sin publicar · 42 listos para aprobar'
    );
  });

  it('usa singular con un solo candidato listo', () => {
    expect(buildDigestSubject(input({ daysSinceLastApproval: 4, pendingTotal: 1 }))).toBe(
      'ComparaTech · 4 días sin publicar · 1 listo para aprobar'
    );
  });

  it('con 3 días o menos mantiene el asunto de siempre', () => {
    const subject = buildDigestSubject(
      input({ daysSinceLastApproval: 3, pendingTotal: 7, newCandidates: [candidate()] })
    );
    expect(subject).toBe('ComparaTech · 1 producto nuevo · 7 por revisar');
  });

  it('pluraliza los productos nuevos y los links por arreglar', () => {
    const subject = buildDigestSubject(
      input({
        newCandidates: [candidate(), candidate()],
        pendingTotal: 2,
        needsLink: [{ name: 'A' }],
      })
    );
    expect(subject).toBe('ComparaTech · 2 productos nuevos · 2 por revisar · 1 necesita link nuevo');
    expect(buildDigestSubject(input({ needsLink: [{ name: 'A' }, { name: 'B' }] }))).toContain(
      '2 necesitan link nuevo'
    );
  });

  it('sin días conocidos (nunca se aprobó nada) no inventa el aviso', () => {
    expect(buildDigestSubject(input({ daysSinceLastApproval: null }))).toBe('ComparaTech · sin novedades hoy');
  });
});

// ---------------------------------------------------------------------------
// Cuerpo
// ---------------------------------------------------------------------------

describe('buildDigestHtml', () => {
  it('escapa los nombres: un <script> en un producto no llega crudo al correo', () => {
    const html = buildDigestHtml(
      input({
        pendingTotal: 1,
        topToApprove: [candidate({ name: '<script>alert(1)</script>', seller_nickname: '"><img>' })],
        needsLink: [{ name: '<script>x</script>' }],
      })
    );
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toContain('"><img>');
  });

  it('muestra el top con comisión estimada y descuento', () => {
    const html = buildDigestHtml(
      input({
        pendingTotal: 3,
        topToApprove: [candidate({ price: 80_000, original_price: 100_000, ml_root_category: 'MLC1574' })],
      })
    );
    expect(html).toContain('Top 10 para aprobar hoy');
    // 11% de Hogar y Muebles sobre $80.000.
    expect(html).toContain('Comisión est. $8.800');
    expect(html).toContain('-20%');
  });

  it('el botón lleva a la cola ordenada por valor', () => {
    const html = buildDigestHtml(input({ pendingTotal: 3 }));
    expect(html).toContain('Aprobar la tanda de hoy');
    expect(html).toContain('https://comparatech.cl/admin/candidatos?orden=valor');
  });

  it('con la cola vacía no ofrece aprobar', () => {
    const html = buildDigestHtml(input({ pendingTotal: 0 }));
    expect(html).toContain('Cola de revisión al día');
    expect(html).not.toContain('Aprobar la tanda de hoy');
  });

  it('incluye modo de links, salud y aviso de datos incompletos', () => {
    const html = buildDigestHtml(input({ errors: ['clics de ayer'], lastPriceCheckMinutes: 34 }));
    expect(html).toContain('Modo de links: meli.la · matt_word=comparatech');
    expect(html).toContain('Salud: precios revisados hace 34 min');
    expect(html).toContain('⚠ Datos incompletos: falló clics de ayer');
  });

  it('dice los días sin publicar en el cuerpo', () => {
    expect(buildDigestHtml(input({ pendingTotal: 9, daysSinceLastApproval: 6 }))).toContain(
      '6 días sin publicar productos nuevos'
    );
  });

  it('pluraliza producto y productos en el texto', () => {
    expect(buildDigestHtml(input({ pendingTotal: 1 }))).toContain('producto listo para aprobar');
    expect(buildDigestHtml(input({ pendingTotal: 2 }))).toContain('productos listos para aprobar');
    expect(buildDigestText(input({ publishedTotal: 1, clicsAyer: 1 }))).toContain('1 producto publicado');
    expect(buildDigestText(input({ publishedTotal: 1, clicsAyer: 1 }))).toContain('1 clic hacia Mercado Libre ayer');
  });
});

// ---------------------------------------------------------------------------
// Cuando Mercado Libre no deja buscar productos nuevos
// ---------------------------------------------------------------------------

describe('aviso de la búsqueda de productos nuevos', () => {
  // Lo que pasa desde el 14-10-2026: 403 en la lista de más vendidos de todas las categorías.
  const blocked: SourceProblem = {
    etapa: 'destacados',
    tipo: 'bloqueo',
    consultas: 288,
    fallidas: 288,
    estado: '403',
    codigo_ml: 'PA_UNAUTHORIZED_RESULT_FROM_POLICIES',
  };
  const LINE = 'Mercado Libre bloqueó la lista de más vendidos: hoy no se pudo buscar productos nuevos.';

  it('el asunto lo dice primero: explica los días sin publicar y no se arregla aprobando', () => {
    expect(buildDigestSubject(input({ sourceProblem: blocked, daysSinceLastApproval: 5, pendingTotal: 3 }))).toBe(
      'ComparaTech · Falló la búsqueda de productos nuevos · 3 por revisar'
    );
    expect(buildDigestSubject(input({ sourceProblem: blocked }))).toBe(
      'ComparaTech · Falló la búsqueda de productos nuevos'
    );
    // Sin problema (o sin saberlo, como en la vista previa), el de siempre.
    expect(buildDigestSubject(input({ sourceProblem: null }))).toBe('ComparaTech · sin novedades hoy');
  });

  it('el cuerpo lo pone antes que todo y no culpa a los filtros de que no entrara nada', () => {
    const html = buildDigestHtml(input({ sourceProblem: blocked, pendingTotal: 3 }));
    expect(html).toContain(LINE);
    expect(html.indexOf(LINE)).toBeLessThan(html.indexOf('productos listos para aprobar'));
    expect(html).toContain('Hoy no entraron productos nuevos.');
    expect(html).not.toContain('no pasó los filtros');

    expect(buildDigestHtml(input())).not.toContain('Mercado Libre bloqueó');
    expect(buildDigestHtml(input())).toContain('no pasó los filtros');
  });

  it('el texto plano también, en la primera línea después del título', () => {
    const text = buildDigestText(input({ sourceProblem: blocked, errors: ['clics de ayer'] }));
    expect(text.split('\n').slice(0, 5)).toEqual([
      'ComparaTech — qué aprobar hoy',
      '',
      `⚠ ${LINE}`,
      '',
      '⚠ Datos incompletos: falló clics de ayer',
    ]);
    expect(buildDigestText(input())).not.toContain('⚠');
  });
});

describe('líneas fijas', () => {
  it('modo de links', () => {
    expect(linkModeLine({ linkMode: { directLinks: false, word: 'comparatech' }, attribution: 'pendiente' })).toBe(
      'Modo de links: meli.la · matt_word=comparatech'
    );
    expect(linkModeLine({ linkMode: { directLinks: true, word: 'comparatech' }, attribution: 'pendiente' })).toBe(
      'Modo de links: directos (sin comprobar) · matt_word=comparatech'
    );
    expect(linkModeLine({ linkMode: { directLinks: true, word: null }, attribution: 'confirmada' })).toBe(
      'Modo de links: directos (atribución confirmada)'
    );
  });

  it('salud y errores', () => {
    expect(healthLine(5)).toBe('Salud: precios revisados hace 5 min');
    expect(healthLine(null)).toContain('no se sabe');
    expect(healthLine(5, 40)).toBe('Salud: precios revisados hace 5 min · el más viejo de lo que está a la venta, hace 40 min');
    expect(healthLine(5, 300)).toBe(
      'Salud: precios revisados hace 5 min · ⚠ hay productos a la venta con el precio de hace 5 h'
    );
    expect(errorsLine([])).toBe('');
    expect(errorsLine(['candidatos por revisar', 'clics de ayer'])).toBe(
      '⚠ Datos incompletos: falló candidatos por revisar, clics de ayer'
    );
  });
});

describe('rankForApproval', () => {
  it('ordena por comisión estimada y, a igual comisión, por descuento', () => {
    const cheapTech = candidate({ name: 'barato', price: 20_000, ml_root_category: 'MLC1000' }); // $800
    const hogar = candidate({ name: 'hogar', price: 60_000, ml_root_category: 'MLC1574' }); // $4.800
    const tech = candidate({ name: 'tech', price: 120_000, ml_root_category: 'MLC1648' }); // $4.800
    const techOnSale = candidate({
      name: 'tech oferta',
      price: 120_000,
      original_price: 150_000,
      ml_root_category: 'MLC1648',
    }); // $4.800, -20%
    const ranked = rankForApproval([cheapTech, tech, hogar, techOnSale]).map((c) => c.name);
    expect(ranked[0]).toBe('tech oferta');
    expect(ranked.slice(1, 3).sort()).toEqual(['hogar', 'tech']);
    expect(ranked[3]).toBe('barato');
  });
});

describe('pickTopToApprove', () => {
  it('deja un solo color por familia y respeta el tope', () => {
    const list = [
      candidate({ name: 'iPhone negro', ml_family_id: 'F1' }),
      candidate({ name: 'iPhone verde', ml_family_id: 'F1' }),
      candidate({ name: 'Sin familia', ml_family_id: null }),
      candidate({ name: 'Galaxy', ml_family_id: 'F2' }),
    ];
    expect(pickTopToApprove(list).map((c) => c.name)).toEqual(['iPhone negro', 'Sin familia', 'Galaxy']);
    expect(pickTopToApprove(list, 2).map((c) => c.name)).toEqual(['iPhone negro', 'Sin familia']);
  });
});

// ---------------------------------------------------------------------------
// Datos del correo: nunca lanza, junta los errores
// ---------------------------------------------------------------------------

type Res = { data?: unknown; error?: { code?: string; message: string } | null; count?: number | null };
interface QueryState {
  table: string;
  columns: string;
  head: boolean;
  filters: string[];
}

function fakeAdmin(handler: (q: QueryState) => Res): SupabaseClient {
  return {
    from(table: string) {
      const state: QueryState = { table, columns: '', head: false, filters: [] };
      const builder: Record<string, unknown> = {};
      for (const m of ['eq', 'not', 'gte', 'lt', 'order', 'limit', 'range', 'in', 'maybeSingle']) {
        builder[m] = (...args: unknown[]) => {
          state.filters.push(`${m}:${JSON.stringify(args)}`);
          return builder;
        };
      }
      builder.select = (columns: string, opts?: { head?: boolean }) => {
        state.columns = columns;
        state.head = Boolean(opts?.head);
        return builder;
      };
      builder.then = (resolve: (r: Res) => unknown, reject: (e: unknown) => unknown) =>
        Promise.resolve()
          .then(() => ({ data: null, error: null, count: null, ...handler(state) }))
          .then(resolve, reject);
      return builder;
    },
  } as unknown as SupabaseClient;
}

const MISSING = { code: 'PGRST205', message: 'no existe' };

describe('gatherDigestInput', () => {
  const now = new Date('2026-10-04T15:00:00Z');

  it('ordena por comisión, calcula la salud y omite los clics si falta la tabla', async () => {
    const admin = fakeAdmin((q) => {
      if (q.table === 'product_candidates' && q.columns.includes('ml_root_category')) {
        return {
          data: [
            { ...candidate({ name: 'viejo barato', price: 15_000 }), prospected_at: '2026-09-01T00:00:00Z' },
            {
              ...candidate({ name: 'nuevo hogar', price: 90_000, ml_root_category: 'MLC1574' }),
              prospected_at: '2026-10-04T12:00:00Z',
            },
          ],
        };
      }
      if (q.table === 'product_candidates') return { data: [{ reviewed_at: '2026-09-28T15:00:00Z' }] };
      if (q.table === 'products' && q.head) return { count: 80 };
      if (q.table === 'products' && q.columns === 'price_checked_at') {
        // La más vieja de lo visible se pide de menor a mayor.
        const oldest = q.filters.some((f) => f === 'order:["price_checked_at",{"ascending":true}]');
        return { data: [{ price_checked_at: oldest ? '2026-10-04T13:30:00Z' : '2026-10-04T14:40:00Z' }] };
      }
      if (q.table === 'products') {
        return {
          data: [
            { name: 'Link roto', inactive_reason: 'link_otro_producto' },
            { name: 'En pausa', inactive_reason: 'sin_ganador' },
          ],
        };
      }
      if (q.table === 'outbound_clicks') return { error: MISSING };
      return { data: null };
    });

    const result = await gatherDigestInput(admin, now);
    expect(result.errors).toEqual([]);
    expect(result.topToApprove.map((c) => c.name)).toEqual(['nuevo hogar', 'viejo barato']);
    expect(result.newCandidates.map((c) => c.name)).toEqual(['nuevo hogar']);
    expect(result.pendingTotal).toBe(2);
    expect(result.publishedTotal).toBe(80);
    expect(result.needsLink).toEqual([{ name: 'Link roto' }]);
    expect(result.pausedCount).toBe(1);
    expect(result.lastPriceCheckMinutes).toBe(20);
    expect(result.oldestPriceMinutes).toBe(90);
    expect(result.daysSinceLastApproval).toBe(6);
    expect(result.clicsAyer).toBeNull();
    expect(result.linkMode.directLinks).toBe(false);
    expect(result.attribution).toBe('pendiente');
  });

  it('si fallan consultas, las nombra en errors y no lanza', async () => {
    const admin = fakeAdmin((q) => {
      if (q.table === 'product_candidates') return { error: { code: '500', message: 'caída' } };
      if (q.table === 'products' && q.head) throw new Error('red');
      if (q.table === 'outbound_clicks' && !q.head) return { data: [] };
      if (q.table === 'outbound_clicks') return { count: 17 };
      return { data: [] };
    });

    const result = await gatherDigestInput(admin, now);
    expect(result.errors).toContain('candidatos por revisar');
    expect(result.errors).toContain('productos publicados');
    expect(result.errors).toContain('última aprobación');
    expect(result.clicsAyer).toBe(17);
    expect(result.topToApprove).toEqual([]);
    expect(buildDigestSubject(result)).toBe('ComparaTech · sin novedades hoy');
  });

  it('sin la columna ml_root_category reintenta sin ella', async () => {
    const admin = fakeAdmin((q) => {
      if (q.table === 'product_candidates' && q.columns.includes('ml_root_category')) {
        return { error: { code: '42703', message: 'column does not exist' } };
      }
      if (q.table === 'product_candidates' && q.columns.includes('image_url')) {
        return { data: [{ ...candidate({ ml_root_category: undefined }), prospected_at: null }] };
      }
      return { data: [] };
    });
    const result = await gatherDigestInput(admin, now);
    expect(result.errors).not.toContain('candidatos por revisar');
    expect(result.pendingTotal).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Piso de comisión de la prospección
// ---------------------------------------------------------------------------

describe('passesCommissionFloor', () => {
  it('compara la comisión estimada con el piso', () => {
    // Tecnología 7%: $10.000 → $700 justo en el piso.
    expect(passesCommissionFloor(10_000, 'MLC1000', 700)).toBe(true);
    expect(passesCommissionFloor(9_900, 'MLC1000', 700)).toBe(false);
    // Hogar 11%: pasa con un precio más bajo.
    expect(passesCommissionFloor(6_500, 'MLC1574', 700)).toBe(true);
  });

  it('sin raíz conocida usa la tasa más baja', () => {
    expect(passesCommissionFloor(9_000, null, 700)).toBe(false);
    expect(passesCommissionFloor(20_000, null, 700)).toBe(true);
  });

  it('un precio inválido no pasa un piso positivo', () => {
    expect(passesCommissionFloor(0, 'MLC1574', 700)).toBe(false);
    expect(passesCommissionFloor(Number.NaN, 'MLC1574', 1)).toBe(false);
    expect(passesCommissionFloor(0, 'MLC1574', 0)).toBe(true);
  });

  it('lee el piso del entorno con 700 por defecto', () => {
    expect(minCommissionFromEnv(undefined)).toBe(700);
    expect(minCommissionFromEnv('1200')).toBe(1200);
    expect(minCommissionFromEnv('abc')).toBe(700);
    expect(minCommissionFromEnv('-5')).toBe(700);
  });
});

// ---------------------------------------------------------------------------
// Correo: destinatarios, adjuntos y CSV del respaldo
// ---------------------------------------------------------------------------

describe('email', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('acepta DIGEST_TO con varias casillas separadas por coma', () => {
    expect(parseRecipients(' a@x.cl, b@x.cl ,,a@x.cl')).toEqual(['a@x.cl', 'b@x.cl']);
    expect(parseRecipients(['c@x.cl'])).toEqual(['c@x.cl']);
    expect(parseRecipients(undefined)).toEqual([]);
  });

  it('manda la lista y los adjuntos a Resend; la firma de antes sigue funcionando', async () => {
    vi.stubEnv('RESEND_API_KEY', 'test-key');
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: 'abc' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const single = await sendEmail({ to: 'a@x.cl', subject: 'S', html: '<p>h</p>' });
    expect(single).toEqual({ ok: true, id: 'abc' });
    const firstBody = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(firstBody.to).toEqual(['a@x.cl']);
    expect(firstBody.attachments).toBeUndefined();

    await sendEmail({
      to: 'a@x.cl, b@x.cl',
      subject: 'S',
      html: '<p>h</p>',
      attachments: [{ filename: 'p.csv', content: toBase64('a,b') }],
    });
    const secondBody = JSON.parse((fetchMock.mock.calls[1] as unknown as [string, RequestInit])[1].body as string);
    expect(secondBody.to).toEqual(['a@x.cl', 'b@x.cl']);
    expect(secondBody.attachments).toEqual([{ filename: 'p.csv', content: Buffer.from('a,b').toString('base64') }]);
  });

  it('sin destinatarios no llama a Resend', async () => {
    vi.stubEnv('RESEND_API_KEY', 'test-key');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    expect(await sendEmail({ to: ' , ', subject: 'S', html: 'h' })).toEqual({ ok: false, error: 'Sin destinatarios' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('el CSV escapa comillas, comas y saltos de línea', () => {
    const csv = toCsv(
      ['name', 'price', 'url', 'active'],
      [
        { name: 'Monitor 27" 144Hz, IPS', price: 199990, url: 'https://meli.la/abc', active: true },
        { name: 'Línea 1\nLínea 2', price: 1, url: null, active: false },
      ]
    );
    expect(csv.startsWith('﻿')).toBe(true);
    const lines = csv.slice(1).split('\r\n');
    expect(lines[0]).toBe('name,price,url,active');
    expect(lines[1]).toBe('"Monitor 27"" 144Hz, IPS",199990,https://meli.la/abc,true');
    expect(lines[2]).toBe('"Línea 1\nLínea 2",1,,false');
  });
});
