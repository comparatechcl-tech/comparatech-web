import { describe, expect, it } from 'vitest';
import { carouselExpiry, carouselPath, type CarouselItem, type CarouselSet, type CarouselSlide } from './carousel-url';
import { IN_FLIGHT_MS, carouselPublishTarget, parseNetworks, publishState, verifyCarouselSlides } from './carousel-publish';

/**
 * Qué carrusel se publica desde el admin con la app de Meta: solo láminas
 * firmadas por el sitio, todas del mismo carrusel y en orden; y nunca dos
 * veces en la misma red.
 */

const KEY = Buffer.from('k'.repeat(40));
const NOW = new Date('2026-10-24T23:00:00Z');
const NOW_S = Math.floor(NOW.getTime() / 1000);
const IDS = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333'];
const SET: CarouselSet = { kind: 'bajas', day: 20261024, ids: IDS, expiresAt: carouselExpiry(NOW) };

function item(rank: number, price: number): CarouselItem {
  return { rank, price, dropAmount: 5000 * rank, dropSince: NOW_S - 86_400, checkedAt: NOW_S - 600, freeShipping: true, full: false };
}

function slides(set: CarouselSet = SET, prices = [100_000, 200_000, 300_000]): string[] {
  const list: CarouselSlide[] = [
    { type: 'portada', set },
    ...set.ids.map((_, i) => ({ type: 'producto' as const, set, item: item(i + 1, prices[i]) })),
    { type: 'cierre', set },
  ];
  return list.map((slide) => carouselPath(slide, KEY) as string);
}

describe('verifyCarouselSlides', () => {
  it('acepta el carrusel firmado y devuelve productos, precios y bajas en orden', () => {
    const paths = slides();
    const result = verifyCarouselSlides(paths, KEY, NOW_S);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.carousel.set.ids).toEqual(IDS);
    expect(result.carousel.items.map((i) => [i.rank, i.price, i.dropAmount])).toEqual([
      [1, 100_000, 5000],
      [2, 200_000, 10_000],
      [3, 300_000, 15_000],
    ]);
    expect(result.carousel.paths).toEqual(paths);
  });

  it('rechaza una lámina con la firma tocada (otro precio)', () => {
    const paths = slides();
    paths[1] = paths[1].replace('-100000-', '-99000-');
    expect(verifyCarouselSlides(paths, KEY, NOW_S)).toEqual({ ok: false, error: expect.stringMatching(/no es válido/) });
  });

  it('rechaza láminas firmadas con otra clave', () => {
    expect(verifyCarouselSlides(slides(), Buffer.from('z'.repeat(40)), NOW_S).ok).toBe(false);
  });

  it('rechaza el orden cambiado, una lámina de más o de menos, y mezclas de dos carruseles', () => {
    const paths = slides();
    expect(verifyCarouselSlides([paths[0], paths[2], paths[1], paths[3], paths[4]], KEY, NOW_S).ok).toBe(false);
    expect(verifyCarouselSlides([paths[0], paths[1], paths[2], paths[4]], KEY, NOW_S).ok).toBe(false);
    expect(verifyCarouselSlides([paths[4], ...paths.slice(1, 4), paths[0]], KEY, NOW_S).ok).toBe(false);
    const other = slides({ ...SET, day: 20261023 });
    expect(verifyCarouselSlides([paths[0], other[1], paths[2], paths[3], paths[4]], KEY, NOW_S).ok).toBe(false);
  });

  it('rechaza lo que no es una lámina del sitio', () => {
    expect(verifyCarouselSlides('x', KEY, NOW_S).ok).toBe(false);
    expect(verifyCarouselSlides([], KEY, NOW_S).ok).toBe(false);
    const paths = slides();
    expect(verifyCarouselSlides([`https://otro.cl${paths[0]}`, ...paths.slice(1)], KEY, NOW_S).ok).toBe(false);
    expect(verifyCarouselSlides([paths[0], 42, ...paths.slice(2)], KEY, NOW_S).ok).toBe(false);
  });

  it('avisa cuando las láminas ya vencieron', () => {
    expect(verifyCarouselSlides(slides(), KEY, SET.expiresAt + 1)).toEqual({ ok: false, error: expect.stringMatching(/vencieron/) });
  });
});

describe('parseNetworks', () => {
  it('Instagram, Facebook o las dos, sin repetir', () => {
    expect(parseNetworks(['instagram', 'facebook'])).toEqual(['instagram', 'facebook']);
    expect(parseNetworks(['facebook'])).toEqual(['facebook']);
    expect(parseNetworks([])).toBeNull();
    expect(parseNetworks(['instagram', 'instagram'])).toBeNull();
    expect(parseNetworks(['tiktok'])).toBeNull();
    expect(parseNetworks('instagram')).toBeNull();
  });
});

describe('publishState: nunca dos veces en la misma red', () => {
  const now = NOW.getTime();
  const at = (msAgo: number) => new Date(now - msAgo).toISOString();

  it('sin eventos, se puede publicar', () => {
    expect(publishState([], 'instagram', now)).toEqual({ kind: 'nuevo' });
  });

  it('ya publicado en esa red: no se repite, aunque haya pasado tiempo', () => {
    const events = [{ at: at(3 * 86_400_000), after: { red: 'instagram', estado: 'publicado', permalink: 'https://instagram.com/p/x' } }];
    expect(publishState(events, 'instagram', now)).toEqual({ kind: 'publicado', permalink: 'https://instagram.com/p/x' });
    expect(publishState(events, 'facebook', now)).toEqual({ kind: 'nuevo' });
  });

  it('un intento en curso o sin respuesta bloquea un rato; un error no', () => {
    expect(publishState([{ at: at(60_000), after: { red: 'facebook', estado: 'publicando' } }], 'facebook', now)).toEqual({
      kind: 'en-curso',
      uncertain: false,
    });
    expect(publishState([{ at: at(60_000), after: { red: 'facebook', estado: 'incierto' } }], 'facebook', now)).toEqual({
      kind: 'en-curso',
      uncertain: true,
    });
    expect(publishState([{ at: at(IN_FLIGHT_MS + 1000), after: { red: 'facebook', estado: 'publicando' } }], 'facebook', now)).toEqual({
      kind: 'nuevo',
    });
    expect(publishState([{ at: at(1000), after: { red: 'facebook', estado: 'error' } }], 'facebook', now)).toEqual({ kind: 'nuevo' });
  });

  it('manda el evento más nuevo, aunque lleguen desordenados', () => {
    const events = [
      { at: at(120_000), after: { red: 'instagram', estado: 'publicando' } },
      { at: at(60_000), after: { red: 'instagram', estado: 'publicado', permalink: null } },
    ];
    expect(publishState(events, 'instagram', now)).toEqual({ kind: 'publicado', permalink: null });
  });

  it('el mismo carrusel da siempre la misma marca en la actividad', () => {
    expect(carouselPublishTarget(SET)).toBe(`carrusel:bajas:20261024:${IDS.join('.')}`);
  });
});
