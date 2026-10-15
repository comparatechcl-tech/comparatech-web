import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

/**
 * Cómo dice el admin la cifra tachada, dibujado a HTML estático: las
 * tarjetas de /admin/videos, /admin/historias y la cola de candidatos.
 *
 * El dueño (14-10-2026) sacó "precio de lista" también del admin: la cifra
 * tachada va como "sin descuento $99.990", igual que en las piezas. Una baja
 * medida con el historial propio no es un descuento y se sigue diciendo así.
 */

// Las acciones escriben en la base: acá solo se mira lo que se dibuja.
vi.mock('@/app/admin/historias/actions', () => ({ markStoryPublished: vi.fn(), undoStoryPublished: vi.fn() }));
vi.mock('@/app/admin/videos/actions', () => ({ markVideoPosted: vi.fn(), undoVideoPosted: vi.fn() }));
vi.mock('@/app/admin/candidatos/actions', () => ({ approveCandidate: vi.fn() }));
vi.mock('@/lib/actions/catalog-admin', () => ({ checkAffiliateLink: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ getSupabaseAdmin: () => ({}) }));
vi.mock('@/lib/queries/price-history', () => {
  const getPriceStatsMany = vi.fn(async (_ids: string[]) => new Map());
  const getPriceStatsManyChecked = async (ids: string[]) => ({ stats: await getPriceStatsMany(ids), unread: new Set<string>() });
  return { getPriceStatsMany, getPriceStatsManyChecked };
});
// lib/settings usa cache() de React, que solo existe dentro de Next.
vi.mock('@/lib/settings', () => ({ readAffiliateSettings: vi.fn() }));
// Las listas de historias se entregan ya armadas.
vi.mock('@/lib/social/stories', async (original) => ({
  ...(await original<typeof import('@/lib/social/stories')>()),
  readStoryPicks: vi.fn(async () => []),
  readPostedStories: vi.fn(async () => []),
}));

import { CandidateCard } from '@/app/admin/candidatos/CandidateCard';
import HistoriasPage from '@/app/admin/historias/page';
import { StoryList } from '@/app/admin/historias/StoryList';
import { VideoList } from '@/app/admin/videos/VideoList';
import type { CandidateGroup } from '@/lib/candidate-sort';
import type { StoryItem } from '@/lib/social/stories';
import type { ReadyVideo } from '@/lib/social/videos';

const NOW = new Date('2026-10-14T15:00:00Z');

/** Lo que el admin ya no dice en nada que se lea. "Sin descuento" sí: es la cifra tachada. */
const AVOIDED = /precio de lista|lista \$|lista <s>|antes \$|antes <span|rebajad|precio normal|ahorra/i;

/** El texto que se lee: sin etiquetas. Las etiquetas de énfasis y la cifra tachada no cortan la frase. */
function text(html: string): string {
  return html
    .replace(/<\/?(?:strong|s|a|em|span)\b[^>]*>/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ');
}

function story(over: Partial<StoryItem> = {}): StoryItem {
  const id = '00000000-0000-4000-8000-000000000001';
  return {
    id,
    slug: 'parlante-jbl-go-4',
    name: 'Parlante Bluetooth JBL Go 4',
    brand: 'JBL',
    price: 49_990,
    listPrice: 99_990,
    discount: 50,
    drop: null,
    checkedAt: new Date(NOW.getTime() - 20 * 60_000).toISOString(),
    again: null,
    reason: 'Parlante JBL, de tienda oficial',
    warning: null,
    points: 62.5,
    image: `/social/pieza/${id}/story-49990-99990-1-1-1-abc.jpg`,
    link: 'https://www.mercadolibre.cl/p/MLC1?matt_word=comparatech',
    fileName: 'comparatech-parlante-jbl-go-4-historia.jpg',
    ...over,
  };
}

const STORAGE = 'https://abcd1234.supabase.co/storage/v1/object/public/reels';

function video(over: Partial<ReadyVideo> = {}): ReadyVideo {
  const id = '00000000-0000-4000-8000-000000000002';
  return {
    id,
    slug: 'parlante-jbl-go-4',
    name: 'Parlante Bluetooth JBL Go 4',
    brand: 'JBL',
    price: 49_990,
    listPrice: 99_990,
    discount: 50,
    checkedAt: new Date(NOW.getTime() - 20 * 60_000).toISOString(),
    template: 'estudio',
    videoUrl: `${STORAGE}/2026-10-14/${id}-49990-estudio-0a1b2c3d.mp4`,
    coverUrl: `${STORAGE}/2026-10-14/${id}-49990-estudio-0a1b2c3d.jpg`,
    fileName: 'comparatech-parlante-jbl-go-4-reel.mp4',
    renderedAt: '2026-10-14T11:05:00.000Z',
    points: 62.5,
    reason: 'Parlante JBL, de tienda oficial',
    link: 'https://www.mercadolibre.cl/p/MLC1?matt_word=comparatech',
    texts: {
      instagram: 'Texto de Instagram',
      tiktok: 'Texto de TikTok',
      facebook: 'Texto de Facebook',
      youtubeTitle: 'Título de YouTube',
      youtubeDescription: 'Descripción de YouTube',
    },
    posted: {},
    ...over,
  };
}

function candidate(over: Partial<CandidateGroup> = {}): CandidateGroup {
  return {
    id: 'cand-1',
    ml_product_id: 'MLC123',
    ml_family_id: null,
    name: 'Parlante Bluetooth JBL Go 4',
    brand: 'JBL',
    category: 'audio',
    price: 49_990,
    original_price: 99_990,
    image_url: 'https://http2.mlstatic.com/D_NQ_NP_1-MLA1_1-F.webp',
    seller_nickname: 'JBL TIENDA',
    seller_reputation: 'verde',
    seller_sales_count: 1200,
    prospected_at: '2026-10-14T12:00:00.000Z',
    siblings: [],
    ...over,
  };
}

describe('/admin/historias', () => {
  const render = (items: StoryItem[]) =>
    renderToStaticMarkup(<StoryList items={items} posted={[]} maxPriceAgeMs={6 * 3600_000} renderedAt={NOW.getTime()} />);

  it('la tarjeta dice "sin descuento" junto a la cifra tachada y el porcentaje', () => {
    const html = render([story()]);
    expect(text(html)).toContain('sin descuento $99.990 · -50%');
    expect(html).toContain('<s>$99.990</s>');
    expect(html).not.toMatch(AVOIDED);
  });

  it('una baja del historial se dice como baja, no como descuento', () => {
    const read = text(render([story({ listPrice: null, discount: 0, drop: 12 })]));
    expect(read).toContain('bajó 12% según el historial');
    expect(read).not.toContain('descuento');
  });

  describe('la página sin ofertas', () => {
    beforeAll(() => {
      vi.stubEnv('CRON_SECRET', 'un-secreto-de-prueba-de-mas-de-32-caracteres');
    });
    afterAll(() => {
      vi.unstubAllEnvs();
    });

    it('explica el piso con "de descuento" y deja la baja del historial aparte', async () => {
      const html = renderToStaticMarkup(await HistoriasPage());
      expect(text(html)).toContain(
        'tienen que venir con 20% o más de descuento (o con una baja confirmada por el historial)'
      );
      expect(html).not.toMatch(AVOIDED);
    });
  });
});

describe('/admin/videos', () => {
  const render = (videos: ReadyVideo[]) =>
    renderToStaticMarkup(<VideoList videos={videos} maxPriceAgeMs={6 * 3600_000} renderedAt={NOW.getTime()} />);

  it('la tarjeta dice "sin descuento" junto a la cifra tachada y el porcentaje, en un solo bloque', () => {
    const html = render([video()]);
    expect(text(html)).toContain('sin descuento $99.990 · -50%');
    // No se parte en el punto: el bloque entero baja de renglón.
    expect(html).toMatch(/<span class="[^"]*whitespace-nowrap[^"]*">sin descuento <s>\$99\.990<\/s> · -50%<\/span>/);
    expect(html).not.toMatch(AVOIDED);
  });

  it('sin descuento real no muestra la cifra tachada', () => {
    const html = render([video({ listPrice: null, discount: 0 })]);
    expect(text(html)).not.toContain('sin descuento $');
    expect(html).not.toContain('<s>');
  });
});

describe('/admin/candidatos', () => {
  const render = (c: CandidateGroup) =>
    renderToStaticMarkup(<CandidateCard candidate={c} now={NOW.getTime()} onReject={async () => null} onDone={() => {}} />);

  it('la cifra tachada va como "sin descuento", no como "antes"', () => {
    const html = render(candidate());
    const read = text(html);
    expect(read).toContain('-50%');
    expect(read).toContain('sin descuento $99.990');
    expect(html).toContain('<span class="line-through">$99.990</span>');
    expect(html).not.toMatch(AVOIDED);
  });

  it('sin descuento real no muestra la cifra tachada', () => {
    const read = text(render(candidate({ original_price: null })));
    expect(read).not.toContain('sin descuento');
    expect(read).not.toContain('-0%');
  });
});
