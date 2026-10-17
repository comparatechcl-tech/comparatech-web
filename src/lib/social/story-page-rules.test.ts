import { describe, expect, it } from 'vitest';

/**
 * Las reglas puras de /admin/historias (app/admin/historias/rules): qué dice
 * cada tarjeta, cuándo deja subir, qué avisa una historia ya subida, en qué
 * grupo va cada oferta y qué se le pide revisar al servidor. Lo que pasa al
 * tocar está en story-page-gestures.test.ts; lo dibujado, en story-list.test.tsx.
 */

import { readResult } from '@/app/admin/historias/live-checks';
import {
  CHECKING_LINE,
  CHECKING_WAIT,
  CHECK_BATCH_SIZE,
  LIST_MAX_AGE_MS,
  OLD_LIST,
  RECHECK_AFTER_MS,
  SAME_MAX_AGE_MS,
  STALE_SAME,
  UNKNOWN_LINE,
  UNKNOWN_LINE_NO_BUTTON,
  changedText,
  checkTargets,
  coverText,
  groupOffers,
  inBatches,
  liveLine,
  minutesAgo,
  oldPriceText,
  postedAlert,
  safeMlUrl,
  shareGate,
  shownOf,
  waitingText,
  type CardCheck,
  type GateContext,
} from '@/app/admin/historias/rules';
import * as livePrice from '@/lib/social/live-price';
import { LIVE_LINE, LIVE_TEXT, type LiveCheck } from '@/lib/social/live-price';
import type { PostedStory, StoryItem } from '@/lib/social/stories';

const T0 = new Date('2026-10-17T15:00:00Z').getTime();
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

let seq = 0;
function story(over: Partial<StoryItem> = {}): StoryItem {
  seq++;
  const id = `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`;
  return {
    id,
    slug: `producto-${seq}`,
    name: `Parlante ${seq}`,
    brand: 'JBL',
    price: 49_990,
    listPrice: 99_990,
    discount: 50,
    drop: null,
    checkedAt: new Date(T0 - 20 * MINUTE).toISOString(),
    again: null,
    reason: 'Parlante JBL',
    warning: null,
    points: 60,
    image: `/social/pieza/${id}/story.jpg`,
    link: `https://www.mercadolibre.cl/p/MLC${seq}?matt_word=comparatech`,
    fileName: `f-${seq}.jpg`,
    mlUrl: `https://www.mercadolibre.cl/p/MLC${seq}`,
    freeShipping: true,
    full: false,
    ...over,
  };
}

function posted(over: Partial<PostedStory> = {}): PostedStory {
  return { ...story(), postId: 900 + seq, postedAt: new Date(T0 - 2 * HOUR).toISOString(), postedPrice: 49_990, onSale: true, ...over };
}

const answered = (result: LiveCheck, at = T0, pending = false): CardCheck => ({ last: { result, at }, pending });
const SAME = (at = T0, pending = false) => answered({ status: 'same', checkedAt: new Date(at).toISOString() }, at, pending);
const CHANGED = (price = 45_990, saved = false): CardCheck =>
  answered({
    status: 'changed',
    checkedAt: new Date(T0).toISOString(),
    price,
    listPrice: 99_990,
    freeShipping: true,
    full: false,
    saved,
    what: 'El precio cambió de $49.990 a $45.990.',
  });
const UNAVAILABLE = () => answered({ status: 'unavailable', checkedAt: new Date(T0).toISOString(), what: LIVE_TEXT.notGreen });
const UNKNOWN = (what: string = LIVE_TEXT.mlDown) => answered({ status: 'unknown', what });

describe('lo que viene de lib/social/live-price', () => {
  it('las líneas, los plazos y las ayudas son las mismas que en Videos', () => {
    expect(CHECKING_LINE).toBe(LIVE_LINE.checking);
    expect(UNKNOWN_LINE).toBe(LIVE_LINE.unknown);
    expect(UNKNOWN_LINE_NO_BUTTON).toBe(LIVE_LINE.unknownNoButton);
    expect(SAME_MAX_AGE_MS).toBe(15 * MINUTE);
    expect(RECHECK_AFTER_MS).toBe(5 * MINUTE);
    expect(LIST_MAX_AGE_MS).toBe(HOUR);
    expect(CHECK_BATCH_SIZE).toBe(16);
    expect(minutesAgo).toBe(livePrice.minutesAgo);
    expect(safeMlUrl).toBe(livePrice.safeMlUrl);
    expect(readResult).toBe(livePrice.readLiveCheck);
  });

  it('changedText es el de "la" (historia)', () => {
    expect(changedText(CHANGED(45_990, true).last!.result as Extract<LiveCheck, { status: 'changed' }>)).toBe(
      'El precio cambió de $49.990 a $45.990. No la subas: toca Actualizar. El sitio ya tiene el precio nuevo.'
    );
  });
});

describe('liveLine: la línea junto al precio', () => {
  it('cada estado con su tono', () => {
    expect(liveLine(undefined, T0)).toEqual({ tone: 'checking', text: CHECKING_LINE, detail: null });
    expect(liveLine({ last: null, pending: true }, T0).tone).toBe('checking');
    expect(liveLine(SAME(T0 - 2 * MINUTE), T0)).toEqual({ tone: 'same', text: '✓ Mismo precio que en Mercado Libre (hace 2 min)', detail: null });
    expect(liveLine(SAME(T0 - 20 * MINUTE), T0)).toEqual({
      tone: 'unknown',
      text: 'Mismo precio hace 20 min: como pasaron más de 15 minutos, lo reviso de nuevo al tocar Compartir.',
      detail: null,
    });
    expect(liveLine(SAME(T0 - 20 * MINUTE, true), T0).tone).toBe('checking');
    // Un "mismo precio" reciente sigue en verde aunque se esté revisando de nuevo.
    expect(liveLine(SAME(T0 - 2 * MINUTE, true), T0).tone).toBe('same');
    expect(liveLine(CHANGED(), T0)).toEqual({ tone: 'bad', text: '✗ El precio cambió de $49.990 a $45.990. No la subas: toca Actualizar.', detail: null });
    // Un cambio se sigue mostrando mientras se repite la revisión: es lo seguro.
    expect(liveLine({ ...CHANGED(), pending: true }, T0).tone).toBe('bad');
    expect(liveLine(UNAVAILABLE(), T0).tone).toBe('bad');
  });

  it('no se pudo revisar: con o sin botón, y el motivo solo si agrega algo', () => {
    expect(liveLine(UNKNOWN(LIVE_TEXT.offline), T0)).toEqual({ tone: 'unknown', text: UNKNOWN_LINE, detail: LIVE_TEXT.offline });
    expect(liveLine(UNKNOWN(LIVE_TEXT.mlDown), T0)).toEqual({ tone: 'unknown', text: UNKNOWN_LINE, detail: null });
    expect(liveLine(UNKNOWN('Sin punto final'), T0, false)).toEqual({ tone: 'unknown', text: UNKNOWN_LINE_NO_BUTTON, detail: 'Sin punto final.' });
    // Revisando de nuevo después de un "no pude": dice que revisa.
    expect(liveLine({ ...UNKNOWN(), pending: true }, T0).tone).toBe('checking');
  });
});

describe('shareGate y coverText: ¿se puede compartir o guardar?', () => {
  const ctx = (over: Partial<GateContext> = {}): GateContext => ({
    now: T0,
    openedAt: T0 - 10 * MINUTE,
    checkedAt: new Date(T0 - HOUR).toISOString(),
    maxPriceAgeMs: 6 * HOUR,
    ...over,
  });

  it('con "mismo precio" de 15 minutos o menos, sí, sin aviso', () => {
    expect(shareGate(SAME(T0 - 15 * MINUTE), ctx())).toEqual({ ok: true, caution: null });
    expect(coverText({ ok: true, caution: null })).toBeNull();
  });

  it('vencido: pide otra revisión, salvo que ya haya una en camino', () => {
    expect(shareGate(SAME(T0 - 16 * MINUTE), ctx())).toEqual({ ok: false, kind: 'stale', message: STALE_SAME, recheck: true });
    expect(shareGate(SAME(T0 - 16 * MINUTE, true), ctx())).toEqual({ ok: false, kind: 'checking', message: CHECKING_WAIT, recheck: false });
  });

  it('sin respuesta todavía: espera; si nadie la pidió, la pide', () => {
    expect(shareGate(undefined, ctx())).toEqual({ ok: false, kind: 'checking', message: CHECKING_WAIT, recheck: true });
    expect(shareGate({ last: null, pending: true }, ctx())).toEqual({ ok: false, kind: 'checking', message: CHECKING_WAIT, recheck: false });
  });

  it('cambió o ya no está a la venta: nunca, y la miniatura lo tapa', () => {
    const gate = shareGate(CHANGED(), ctx());
    expect(gate).toEqual({ ok: false, kind: 'changed', message: 'El precio cambió de $49.990 a $45.990. No la subas: toca Actualizar.', recheck: false });
    expect(coverText(gate)).toBe('Cambió en Mercado Libre: no la guardes ni la subas.');
    expect(shareGate(UNAVAILABLE(), ctx())).toMatchObject({ ok: false, kind: 'changed' });
  });

  it('sin poder revisar, la regla de antes, con el aviso ámbar; cada falta con su mensaje', () => {
    expect(shareGate(UNKNOWN(), ctx({ openedAt: T0 - HOUR, checkedAt: new Date(T0 - 6 * HOUR).toISOString() }))).toEqual({
      ok: true,
      caution: UNKNOWN_LINE,
    });
    const oldList = shareGate(UNKNOWN(), ctx({ openedAt: T0 - HOUR - 1 }));
    expect(oldList).toEqual({ ok: false, kind: 'old-list', message: OLD_LIST, recheck: true });
    expect(coverText(oldList)).toBe('Toca Actualizar antes de guardarla.');
    const oldPrice = shareGate(UNKNOWN(), ctx({ checkedAt: new Date(T0 - 6 * HOUR - 1).toISOString() }));
    expect(oldPrice).toEqual({ ok: false, kind: 'old-price', message: oldPriceText(6 * HOUR), recheck: true });
    expect(oldPriceText(6 * HOUR)).toBe('El precio de esta oferta se revisó hace más de 6 horas. Toca Actualizar, arriba.');
    expect(coverText(oldPrice)).toBe('Toca Actualizar antes de guardarla.');
    // Sin hora de revisión del sitio, solo cuenta la lista.
    expect(shareGate(UNKNOWN(), ctx({ checkedAt: null }))).toEqual({ ok: true, caution: UNKNOWN_LINE });
    // Esperando no se tapa la imagen: no hay nada malo todavía.
    expect(coverText(shareGate(undefined, ctx()))).toBeNull();
    expect(coverText(shareGate(SAME(T0 - 16 * MINUTE), ctx()))).toBeNull();
  });
});

describe('postedAlert: lo que avisa una historia ya subida', () => {
  it('más cara desde 1%: rojo; con el precio de la revisión en vivo si encontró otro', () => {
    expect(postedAlert(posted({ price: 50_490 }), undefined)).toEqual({
      tone: 'bad',
      text: 'Tu historia en Instagram dice $49.990 y ahora está más cara, a $50.490: bórrala o súbela de nuevo.',
    });
    expect(postedAlert(posted({ price: 50_400 }), undefined)).toBeNull();
    expect(postedAlert(posted({ price: 49_990 }), CHANGED(55_990))).toMatchObject({ tone: 'bad', text: expect.stringContaining('a $55.990') });
    // "Mismo precio" confirma el de la base (el de la tarjeta de ahora): ese es el que se compara con lo subido.
    expect(postedAlert(posted({ price: 55_990 }), SAME())).toMatchObject({ tone: 'bad', text: expect.stringContaining('a $55.990') });
  });

  it('más barata desde 3%: aviso suave, para subirla de nuevo', () => {
    expect(postedAlert(posted({ price: 48_490 }), undefined)).toEqual({
      tone: 'info',
      text: 'Tu historia dice $49.990 y ahora está más barata, a $48.490: puedes subirla de nuevo con la imagen de ahora.',
    });
    expect(postedAlert(posted({ price: 48_600 }), undefined)).toBeNull();
  });

  it('ya no está a la venta (en el sitio o en Mercado Libre): rojo, para borrarla', () => {
    const gone = 'Tu historia en Instagram dice $49.990 y ya no está a la venta: bórrala.';
    expect(postedAlert(posted({ onSale: false }), undefined)).toEqual({ tone: 'bad', text: gone });
    expect(postedAlert(posted(), UNAVAILABLE())).toEqual({ tone: 'bad', text: gone });
    expect(postedAlert(posted({ onSale: false, postedPrice: null }), undefined)).toEqual({
      tone: 'bad',
      text: 'El producto de tu historia en Instagram ya no está a la venta: bórrala.',
    });
  });

  it('sin precio anotado no hay con qué comparar', () => {
    expect(postedAlert(posted({ postedPrice: null, price: 99_990 }), undefined)).toBeNull();
    expect(postedAlert(posted({ postedPrice: 0, price: 99_990 }), undefined)).toBeNull();
  });
});

describe('groupOffers, shownOf, checkTargets e inBatches', () => {
  it('los grupos, sin cambiar el orden: las que bajaron, las de ahora y al final las que traen "Ojo" (aunque hayan bajado)', () => {
    const fresh1 = story();
    const again = story({ again: { price: 59_990, at: '2026-10-10T12:00:00.000Z' } });
    const warned = story({ warning: 'la oferta es chica' });
    const both = story({ warning: 'no es nuevo', again: { price: 59_990, at: '2026-10-10T12:00:00.000Z' } });
    const fresh2 = story();
    const groups = groupOffers([fresh1, again, warned, both, fresh2]);
    expect(groups.again.map((item) => item.id)).toEqual([again.id]);
    expect(groups.fresh.map((item) => item.id)).toEqual([fresh1.id, fresh2.id]);
    expect(groups.warned.map((item) => item.id)).toEqual([warned.id, both.id]);
  });

  it('shownOf: lo que la pieza lleva dibujado', () => {
    expect(shownOf(story({ price: 9_990, listPrice: null, freeShipping: false, full: true }))).toEqual({
      price: 9_990,
      listPrice: null,
      freeShipping: false,
      full: true,
    });
  });

  it('checkTargets: las ofertas primero, después las subidas vivas en Instagram y a la venta, una vez por producto', () => {
    const a = story();
    const b = story();
    const alive = posted();
    const sameAsOffer = { ...posted(), id: a.id };
    const expired = posted({ postedAt: new Date(T0 - 25 * HOUR).toISOString() });
    const notOnSale = posted({ onSale: false });
    const badDate = posted({ postedAt: 'no es una fecha' });
    const targets = checkTargets([a, b], [alive, sameAsOffer, expired, notOnSale, badDate], T0, 24 * HOUR);
    expect(targets.map((target) => target.productId)).toEqual([a.id, b.id, alive.id]);
    expect(targets[0]).toEqual({ productId: a.id, shown: shownOf(a) });
    // A las 24 horas justas todavía está viva.
    const edge = posted({ postedAt: new Date(T0 - 24 * HOUR).toISOString() });
    expect(checkTargets([], [edge], T0, 24 * HOUR).map((target) => target.productId)).toEqual([edge.id]);
  });

  it('inBatches: en tandas de 16, en el mismo orden', () => {
    const list = Array.from({ length: 35 }, (_, i) => i);
    expect(inBatches(list).map((batch) => batch.length)).toEqual([16, 16, 3]);
    expect(inBatches(list).flat()).toEqual(list);
    expect(inBatches([])).toEqual([]);
    expect(inBatches([1, 2, 3], 2)).toEqual([[1, 2], [3]]);
  });
});

describe('waitingText: cuántas más esperan', () => {
  it('ninguna, una o varias', () => {
    expect(waitingText(0, 14)).toBe(
      'Ahora no hay más ofertas esperando: aparecen nuevas cuando cambian los precios o cuando se cumplen 14 días de una historia ya subida.'
    );
    expect(waitingText(1, 14)).toBe('Hay 1 oferta más esperando: marca las que ya subiste y toca Actualizar para verla.');
    expect(waitingText(5, 14)).toBe('Hay 5 ofertas más esperando: marca las que ya subiste y toca Actualizar para verlas.');
  });

  it('un número que no sirve cuenta como ninguna', () => {
    for (const n of [-3, Number.NaN, Number.POSITIVE_INFINITY]) expect(waitingText(n, 14)).toContain('Ahora no hay más ofertas esperando');
  });
});
