import { describe, expect, it, vi } from 'vitest';

/**
 * La revisión en vivo de /admin/videos (app/admin/videos/live), sin React ni
 * navegador: qué dice la tarjeta, cuándo deja subir el video, qué se revisa y
 * cómo viaja la revisión al servidor (con una acción de mentira). Y los
 * textos de la página (app/admin/videos/texts): la próxima pasada, lo ya
 * subido cuyo precio cambió y los videos que dejaron de mostrarse.
 */

import {
  AUTO_RECHECK_MS,
  CALL_FAILED,
  CALL_TIMEOUT_MS,
  CHECKING_LINE,
  CHECKING_NOTE,
  MAX_LIST_AGE_MS,
  MAX_LIVE_ITEMS,
  OLD_LIST,
  OLD_PRICE,
  RECHECK_AFTER_MS,
  SAME_FRESH_MS,
  SKIPPED_LINE,
  UNKNOWN_LINE,
  agoText,
  createLiveChecker,
  isLiveCheck,
  isPriceOff,
  liveLine,
  liveTargets,
  offText,
  oldPriceText,
  shownOffer,
  uploadGate,
  wantsRecheck,
  type GateContext,
  type LiveEntry,
} from '@/app/admin/videos/live';
import { NETWORK_KEYS, NETWORK_LABELS, changedAfterPostingText, networkList, nextPassText, staleText } from '@/app/admin/videos/texts';
import { isEverywhere, type PostedByNetwork } from '@/app/admin/videos/VideoList';
import { LIVE_TEXT, type LiveCheck } from '@/lib/social/live-price';
import type { ReadyVideo } from '@/lib/social/videos';

// VideoList trae la acción de verdad, que lee la configuración con cache() de React (no existe fuera de Next).
vi.mock('@/app/admin/videos/actions', () => ({ markVideoPosted: vi.fn(), undoVideoPosted: vi.fn() }));
vi.mock('@/app/admin/live-price-actions', () => ({ checkLivePrices: vi.fn(async () => ({})) }));

const T0 = new Date('2026-10-17T15:00:00Z').getTime();
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

let seq = 0;
function video(over: Partial<ReadyVideo> = {}): ReadyVideo {
  seq++;
  const id = `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`;
  return {
    id,
    slug: `producto-${seq}`,
    name: `Parlante Bluetooth JBL Go ${seq}`,
    brand: 'JBL',
    price: 49_990,
    listPrice: 99_990,
    discount: 50,
    checkedAt: new Date(T0 - 20 * MINUTE).toISOString(),
    template: 'estudio',
    videoUrl: `https://x.supabase.co/storage/v1/object/public/reels/2026-10-17/${id}.mp4`,
    coverUrl: `https://x.supabase.co/storage/v1/object/public/reels/2026-10-17/${id}.jpg`,
    fileName: `comparatech-producto-${seq}-reel.mp4`,
    renderedAt: '2026-10-17T11:05:00.000Z',
    points: 62.5,
    reason: 'Parlante JBL, 50% de descuento',
    link: `https://www.mercadolibre.cl/p/MLC${seq}?matt_word=comparatech`,
    texts: { instagram: 'i', tiktok: 't', facebook: 'f', youtubeTitle: 'yt', youtubeDescription: 'yd' },
    posted: {},
    mlUrl: `https://www.mercadolibre.cl/p/MLC${seq}`,
    freeShipping: true,
    full: false,
    ...over,
  };
}

const answered = (check: LiveCheck, at = T0, checking = false): LiveEntry => ({ result: { check, at }, checking });
const SAME = (at = T0, checking = false) => answered({ status: 'same', checkedAt: new Date(at).toISOString() }, at, checking);
const CHANGED = (saved = false, at = T0): LiveEntry =>
  answered(
    {
      status: 'changed',
      checkedAt: new Date(at).toISOString(),
      price: 45_990,
      listPrice: 99_990,
      freeShipping: true,
      full: false,
      saved,
      what: 'El precio cambió de $49.990 a $45.990.',
    },
    at
  );
const UNAVAILABLE = (at = T0) => answered({ status: 'unavailable', checkedAt: new Date(at).toISOString(), what: LIVE_TEXT.noWinner }, at);
const UNKNOWN = (what: string = LIVE_TEXT.mlDown, at = T0) => answered({ status: 'unknown', what }, at);
const SKIPPED: LiveEntry = { result: null, checking: false, skipped: true };

const OFF = '✗ El precio cambió de $49.990 a $45.990. No lo subas: toca Actualizar.';

describe('lo que la tarjeta muestra y lo que se compara', () => {
  it('shownOffer: el precio, la cifra tachada, el envío y Full que el video lleva escritos', () => {
    expect(shownOffer(video({ price: 129_990, listPrice: null, freeShipping: false, full: true }))).toEqual({
      price: 129_990,
      listPrice: null,
      freeShipping: false,
      full: true,
    });
  });

  it('isPriceOff y offText: solo "cambió" y "ya no está a la venta" dicen que lo del video ya no es cierto', () => {
    expect(isPriceOff(CHANGED())).toBe(true);
    expect(isPriceOff(UNAVAILABLE())).toBe(true);
    for (const entry of [SAME(), UNKNOWN(), SKIPPED, { result: null, checking: true }, undefined]) expect(isPriceOff(entry)).toBe(false);
    expect(offText(CHANGED().result!.check)).toBe(OFF);
    expect(offText(CHANGED(true).result!.check)).toBe(`${OFF} El sitio ya tiene el precio nuevo.`);
    expect(offText(UNAVAILABLE().result!.check)).toBe(
      '✗ Ya no está a la venta en Mercado Libre: la ficha no tiene vendedor. No lo subas: toca Actualizar.'
    );
    expect(offText({ status: 'same', checkedAt: '' })).toBe('');
    expect(offText({ status: 'unknown', what: 'x' })).toBe('');
  });

  it('agoText cuenta con el reloj del teléfono', () => {
    expect(agoText(T0, T0 + 30_000)).toBe('hace menos de 1 min');
    expect(agoText(T0, T0 + 7 * MINUTE)).toBe('hace 7 min');
  });
});

describe('liveLine: la línea junto al precio', () => {
  it('sin respuesta, revisando', () => {
    expect(liveLine(undefined, T0)).toEqual({ tone: 'checking', text: CHECKING_LINE });
    expect(liveLine({ result: null, checking: true }, T0)).toEqual({ tone: 'checking', text: CHECKING_LINE });
  });

  it('mismo precio: verde hasta los 15 minutos, después ámbar (o revisando si ya se pidió otra)', () => {
    expect(SAME_FRESH_MS).toBe(15 * MINUTE);
    expect(liveLine(SAME(T0 - 3 * MINUTE), T0)).toEqual({ tone: 'ok', text: '✓ Mismo precio que en Mercado Libre (hace 3 min)' });
    expect(liveLine(SAME(T0 - 3 * MINUTE, true), T0).text).toBe('✓ Mismo precio que en Mercado Libre (hace 3 min) · revisando de nuevo…');
    expect(liveLine(SAME(T0 - 15 * MINUTE), T0).tone).toBe('ok');
    expect(liveLine(SAME(T0 - 15 * MINUTE - 1), T0)).toEqual({
      tone: 'warn',
      text: 'Mismo precio hace 15 min: como pasaron más de 15 minutos, lo reviso de nuevo al tocar Compartir.',
    });
    expect(liveLine(SAME(T0 - 40 * MINUTE, true), T0)).toEqual({ tone: 'checking', text: CHECKING_LINE });
  });

  it('cambió o ya no está a la venta: en rojo, aunque se esté revisando de nuevo', () => {
    expect(liveLine(CHANGED(), T0)).toEqual({ tone: 'bad', text: OFF });
    expect(liveLine({ ...CHANGED(), checking: true }, T0)).toEqual({ tone: 'bad', text: OFF });
    expect(liveLine(UNAVAILABLE(), T0).tone).toBe('bad');
  });

  it('no se pudo revisar: ámbar, con el motivo del servidor si agrega algo', () => {
    expect(liveLine(UNKNOWN(LIVE_TEXT.offline), T0)).toEqual({ tone: 'warn', text: UNKNOWN_LINE, detail: LIVE_TEXT.offline });
    expect(liveLine(UNKNOWN(CALL_FAILED), T0)).toEqual({ tone: 'warn', text: UNKNOWN_LINE });
    expect(liveLine(UNKNOWN('   '), T0)).toEqual({ tone: 'warn', text: UNKNOWN_LINE });
  });

  it('lo que no se revisa lo dice', () => {
    expect(liveLine(SKIPPED, T0)).toEqual({ tone: 'warn', text: SKIPPED_LINE });
  });
});

describe('uploadGate: ¿se puede compartir, guardar o copiar el texto?', () => {
  const ctx = (over: Partial<GateContext> = {}): GateContext => ({
    openedAt: T0 - 10 * MINUTE,
    checkedAt: new Date(T0 - HOUR).toISOString(),
    maxPriceAgeMs: 6 * HOUR,
    ...over,
  });

  it('con "mismo precio" de 15 minutos o menos, sí, aunque la lista y el precio del sitio sean viejos', () => {
    expect(uploadGate(SAME(T0 - 15 * MINUTE), T0, ctx())).toEqual({ ok: true });
    expect(uploadGate(SAME(T0 - MINUTE), T0, ctx({ openedAt: T0 - 5 * HOUR, checkedAt: new Date(T0 - 9 * HOUR).toISOString() }))).toEqual({
      ok: true,
    });
  });

  it('con "mismo precio" vencido, no: dice que está revisando y pide otra (si no hay una en camino)', () => {
    expect(uploadGate(SAME(T0 - 16 * MINUTE), T0, ctx())).toEqual({ ok: false, text: CHECKING_NOTE, recheck: true });
    expect(uploadGate(SAME(T0 - 16 * MINUTE, true), T0, ctx())).toEqual({ ok: false, text: CHECKING_NOTE, recheck: false });
  });

  it('con un cambio o ya no a la venta, nunca, y otra revisión no sirve: hay que actualizar', () => {
    expect(uploadGate(CHANGED(), T0, ctx())).toEqual({ ok: false, text: OFF, recheck: false });
    expect(uploadGate(UNAVAILABLE(), T0, ctx())).toMatchObject({ ok: false, recheck: false });
  });

  it('sin respuesta todavía, no: dice que está revisando', () => {
    expect(uploadGate(undefined, T0, ctx())).toEqual({ ok: false, text: CHECKING_NOTE, recheck: true });
    expect(uploadGate({ result: null, checking: true }, T0, ctx())).toEqual({ ok: false, text: CHECKING_NOTE, recheck: false });
  });

  it('sin poder revisar, la regla de siempre: lista de una hora o menos y precio de 6 horas o menos', () => {
    expect(MAX_LIST_AGE_MS).toBe(HOUR);
    const unknown = UNKNOWN(LIVE_TEXT.offline);
    expect(uploadGate(unknown, T0, ctx({ openedAt: T0 - HOUR, checkedAt: new Date(T0 - 6 * HOUR).toISOString() }))).toEqual({ ok: true });
    expect(uploadGate(unknown, T0, ctx({ openedAt: T0 - HOUR - 1 }))).toEqual({ ok: false, text: OLD_LIST, recheck: true });
    expect(uploadGate(unknown, T0, ctx({ checkedAt: new Date(T0 - 6 * HOUR - 1).toISOString() }))).toEqual({
      ok: false,
      text: OLD_PRICE,
      recheck: true,
    });
    // Sin hora de revisión del sitio, solo cuenta la edad de la lista.
    expect(uploadGate(unknown, T0, ctx({ checkedAt: null }))).toEqual({ ok: true });
  });

  it('el mensaje del precio viejo dice el plazo de verdad y no habla de la lista', () => {
    expect(OLD_PRICE).toBe(oldPriceText(6 * HOUR));
    expect(OLD_PRICE).toBe(
      'El precio de este video se revisó hace más de 6 horas y ahora no pude revisarlo en Mercado Libre. Toca Actualizar, arriba, antes de subirlo.'
    );
    expect(uploadGate(UNKNOWN(), T0, ctx({ maxPriceAgeMs: 3 * HOUR, checkedAt: new Date(T0 - 4 * HOUR).toISOString() }))).toMatchObject({
      text: oldPriceText(3 * HOUR),
    });
    expect(oldPriceText(3 * HOUR)).toContain('hace más de 3 horas');
    expect(OLD_PRICE).not.toContain('lista');
  });

  it('lo que no se revisa en vivo (ya subido a todo) sigue la regla de siempre, sin pedir revisión', () => {
    expect(uploadGate(SKIPPED, T0, ctx())).toEqual({ ok: true });
    expect(uploadGate(SKIPPED, T0, ctx({ openedAt: T0 - 2 * HOUR }))).toEqual({ ok: false, text: OLD_LIST, recheck: false });
  });
});

describe('wantsRecheck: ¿conviene otra revisión?', () => {
  it('sin respuesta, o con una más vieja que el plazo', () => {
    expect(wantsRecheck(undefined, T0, RECHECK_AFTER_MS)).toBe(true);
    expect(wantsRecheck({ result: null, checking: false }, T0, RECHECK_AFTER_MS)).toBe(true);
    expect(wantsRecheck(SAME(T0 - 6 * MINUTE), T0, RECHECK_AFTER_MS)).toBe(true);
    expect(wantsRecheck(SAME(T0 - 4 * MINUTE), T0, RECHECK_AFTER_MS)).toBe(false);
    expect(wantsRecheck(UNKNOWN(LIVE_TEXT.mlDown, T0 - 6 * MINUTE), T0, RECHECK_AFTER_MS)).toBe(true);
  });

  it('nunca si ya va una en camino, si no se revisa, o si ya cambió (no vuelve atrás)', () => {
    expect(wantsRecheck({ result: null, checking: true }, T0, RECHECK_AFTER_MS)).toBe(false);
    expect(wantsRecheck(SKIPPED, T0, RECHECK_AFTER_MS)).toBe(false);
    expect(wantsRecheck(CHANGED(false, T0 - HOUR), T0, RECHECK_AFTER_MS)).toBe(false);
    expect(wantsRecheck(UNAVAILABLE(T0 - HOUR), T0, RECHECK_AFTER_MS)).toBe(false);
  });
});

describe('isLiveCheck: lo que llega del servidor', () => {
  it('acepta solo la forma acordada', () => {
    expect(isLiveCheck({ status: 'same', checkedAt: 'x' })).toBe(true);
    expect(isLiveCheck(CHANGED().result!.check)).toBe(true);
    for (const value of [null, undefined, 'same', { status: 'igual' }, { status: 'changed', what: 'x' }, { status: 'unknown' }]) {
      expect(isLiveCheck(value), JSON.stringify(value)).toBe(false);
    }
  });
});

describe('liveTargets: qué se revisa en vivo', () => {
  const marks = (at: number): PostedByNetwork => ({
    instagram: { postId: 1, at: new Date(at).toISOString() },
    tiktok: { postId: 2, at: new Date(at - HOUR).toISOString() },
    youtube: { postId: 3, at: new Date(at - HOUR).toISOString() },
    facebook: { postId: 4, at: new Date(at - HOUR).toISOString() },
  });

  it('todo, menos lo que está en las cuatro redes desde hace más de un día (contado desde la marca más nueva)', () => {
    const [fresh, everywhereOld, everywhereNew, three] = [video(), video(), video(), video()];
    const posted = {
      [everywhereOld.id]: marks(T0 - 25 * HOUR),
      [everywhereNew.id]: marks(T0 - 23 * HOUR),
      [three.id]: { instagram: { postId: 9, at: new Date(T0 - 3 * 24 * HOUR).toISOString() } },
    };
    expect(liveTargets([fresh, everywhereOld, everywhereNew, three], posted, isEverywhere, T0)).toEqual({
      check: [fresh.id, everywhereNew.id, three.id],
      skip: [everywhereOld.id],
    });
  });

  it('como mucho lo que acepta una llamada', () => {
    const many = Array.from({ length: 20 }, () => video());
    const { check, skip } = liveTargets(many, {}, isEverywhere, T0);
    expect(MAX_LIVE_ITEMS).toBe(16);
    expect(check).toEqual(many.slice(0, 16).map((v) => v.id));
    expect(skip).toEqual([]);
  });
});

describe('createLiveChecker: la revisión viaja de a una llamada', () => {
  function setup(videos: ReadyVideo[], targets?: { check: string[]; skip: string[] }) {
    let now = T0;
    const timers: { run: () => void; ms: number }[] = [];
    const calls: { productId: string; shown: unknown }[][] = [];
    const pending: { resolve: (value: Record<string, LiveCheck>) => void; reject: (err: unknown) => void }[] = [];
    const check = vi.fn(
      (items: { productId: string; shown: unknown }[]) =>
        new Promise<Record<string, LiveCheck>>((resolve, reject) => {
          calls.push(items);
          pending.push({ resolve, reject });
        })
    );
    const published: Record<string, LiveEntry>[] = [];
    const settled: string[][] = [];
    const checker = createLiveChecker(videos, targets ?? { check: videos.map((v) => v.id), skip: [] }, {
      check,
      now: () => now,
      publish: (entries) => published.push(entries),
      settled: (ids) => settled.push(ids),
      later: (run, ms) => timers.push({ run, ms }),
    });
    return {
      checker,
      check,
      calls,
      pending,
      published,
      settled,
      timers,
      advance: (ms: number) => (now += ms),
      /** Contesta la llamada `i` con "mismo precio" para todos los de esa llamada. */
      answerSame: (i: number) =>
        pending[i].resolve(Object.fromEntries(calls[i].map((item) => [item.productId, { status: 'same', checkedAt: 'x' } as LiveCheck]))),
    };
  }
  const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

  it('al empezar pide todos, con lo que muestra cada uno, y mientras viaja dice "revisando"', async () => {
    const [a, b] = [video(), video({ price: 9_990, listPrice: null, freeShipping: false, full: true })];
    const t = setup([a, b]);
    t.checker.start();
    expect(t.calls).toEqual([
      [
        { productId: a.id, shown: { price: 49_990, listPrice: 99_990, freeShipping: true, full: false } },
        { productId: b.id, shown: { price: 9_990, listPrice: null, freeShipping: false, full: true } },
      ],
    ]);
    expect(t.checker.entry(a.id)).toEqual({ result: null, checking: true });
    expect(t.published).toHaveLength(1);

    t.advance(2_000);
    t.answerSame(0);
    await settle();
    expect(t.checker.entry(a.id)).toEqual({ result: { check: { status: 'same', checkedAt: 'x' }, at: T0 + 2_000 }, checking: false });
    expect(t.settled).toEqual([[a.id, b.id]]);
    expect(t.published.length).toBeGreaterThan(1);
  });

  it('si ya hay respuestas de todos, empezar no vuelve a preguntar', async () => {
    const a = video();
    const t = setup([a]);
    t.checker.start();
    t.answerSame(0);
    await settle();
    t.checker.start();
    expect(t.check).toHaveBeenCalledTimes(1);
  });

  it('una llamada a la vez: lo pedido mientras viaja espera, sin repetir lo que ya va', async () => {
    const [a, b, c] = [video(), video(), video()];
    const t = setup([a, b, c], { check: [a.id, b.id], skip: [] });
    t.checker.start();
    t.checker.recheck([a.id, c.id, c.id]);
    expect(t.check).toHaveBeenCalledTimes(1);
    t.answerSame(0);
    await settle();
    // Después de la primera, la que quedó esperando: solo c (a ya iba).
    expect(t.calls[1].map((item) => item.productId)).toEqual([c.id]);
  });

  it('lo que no está en la lista o no se revisa en vivo no se pide nunca', () => {
    const [a, b] = [video(), video()];
    const t = setup([a, b], { check: [a.id], skip: [b.id] });
    expect(t.checker.entry(b.id)).toEqual({ result: null, checking: false, skipped: true });
    t.checker.start();
    t.checker.recheck([b.id, 'otro-producto']);
    expect(t.calls.flat().map((item) => item.productId)).toEqual([a.id]);
  });

  it('si la llamada falla, contesta algo raro o no contesta a tiempo, queda "no pude revisar", nunca "mismo precio"', async () => {
    const a = video();
    const failed = setup([a]);
    failed.checker.start();
    failed.pending[0].reject(new Error('sin conexión'));
    await settle();
    expect(failed.checker.entry(a.id)?.result?.check).toEqual({ status: 'unknown', what: CALL_FAILED });

    const weird = setup([a]);
    weird.checker.start();
    weird.pending[0].resolve({ [a.id]: { status: 'changed', what: 'sin precio' } as unknown as LiveCheck });
    await settle();
    expect(weird.checker.entry(a.id)?.result?.check).toEqual({ status: 'unknown', what: CALL_FAILED });

    const slow = setup([a]);
    slow.checker.start();
    expect(slow.timers.map((timer) => timer.ms)).toEqual([CALL_TIMEOUT_MS]);
    expect(CALL_TIMEOUT_MS).toBe(55_000);
    slow.timers[0].run();
    await settle();
    expect(slow.checker.entry(a.id)).toEqual({ result: { check: { status: 'unknown', what: CALL_FAILED }, at: T0 }, checking: false });
    // Una respuesta que llega después del plazo ya no cambia nada.
    slow.answerSame(0);
    await settle();
    expect(slow.checker.entry(a.id)?.result?.check.status).toBe('unknown');
  });

  it('mientras se revisa de nuevo, la respuesta anterior sigue valiendo', async () => {
    const a = video();
    const t = setup([a]);
    t.checker.start();
    t.pending[0].resolve({ [a.id]: CHANGED().result!.check });
    await settle();
    t.checker.recheck([a.id]);
    expect(t.checker.entry(a.id)).toMatchObject({ checking: true, result: { check: { status: 'changed' } } });
  });

  it('al volver a la pestaña revisa todo solo si la respuesta más vieja tiene más de 5 minutos; sola, a los 12', async () => {
    expect(RECHECK_AFTER_MS).toBe(5 * MINUTE);
    expect(AUTO_RECHECK_MS).toBe(12 * MINUTE);
    const [a, b] = [video(), video()];
    const t = setup([a, b]);
    t.checker.start();
    t.answerSame(0);
    await settle();

    t.advance(5 * MINUTE);
    t.checker.visible();
    expect(t.check).toHaveBeenCalledTimes(1);
    t.advance(1);
    t.checker.visible();
    expect(t.check).toHaveBeenCalledTimes(2);
    t.answerSame(1);
    await settle();

    t.advance(12 * MINUTE);
    t.checker.tick();
    expect(t.check).toHaveBeenCalledTimes(2);
    t.advance(1);
    t.checker.tick();
    expect(t.check).toHaveBeenCalledTimes(3);
  });

  it('sin nada que revisar, volver a la pestaña no llama al servidor', () => {
    const a = video();
    const t = setup([a], { check: [], skip: [a.id] });
    t.checker.start();
    t.checker.visible();
    t.checker.tick();
    expect(t.check).not.toHaveBeenCalled();
  });

  it('fuera de pantalla no dibuja ni avisa lo que llega después', async () => {
    const a = video();
    const t = setup([a]);
    t.checker.start();
    const before = t.published.length;
    t.checker.stop();
    t.answerSame(0);
    await settle();
    expect(t.published).toHaveLength(before);
    expect(t.settled).toEqual([]);
  });

  it('16 como mucho por llamada, lo que acepta el servidor; lo que sobra va en la llamada siguiente', async () => {
    const many = Array.from({ length: 18 }, () => video());
    const t = setup(many);
    t.checker.recheck(many.map((v) => v.id));
    expect(t.calls).toHaveLength(1);
    expect(t.calls[0].map((item) => item.productId)).toEqual(many.slice(0, 16).map((v) => v.id));
    // Mientras viaja la primera, los dos que sobran todavía no tienen respuesta.
    expect(t.checker.entry(many[16].id)).toBeUndefined();
    t.answerSame(0);
    await settle();
    // Como las tandas de Historias: los que pasan de 16 se piden después, no se pierden.
    expect(t.calls).toHaveLength(2);
    expect(t.calls[1].map((item) => item.productId)).toEqual(many.slice(16).map((v) => v.id));
  });

  it('entries entrega una copia', () => {
    const a = video();
    const t = setup([a]);
    const copy = t.checker.entries();
    copy[a.id] = SAME();
    expect(t.checker.entry(a.id)).toBeUndefined();
  });
});

describe('los textos de /admin/videos', () => {
  it('las redes, en el orden de la tarjeta', () => {
    expect(NETWORK_KEYS).toEqual(['instagram', 'tiktok', 'youtube', 'facebook']);
    expect(NETWORK_LABELS).toEqual({ instagram: 'Instagram', tiktok: 'TikTok', youtube: 'YouTube', facebook: 'Facebook' });
    expect(networkList([])).toBe('una red');
    expect(networkList(['tiktok'])).toBe('TikTok');
    expect(networkList(['facebook', 'instagram'])).toBe('Instagram y Facebook');
    expect(networkList(['facebook', 'youtube', 'tiktok', 'instagram'])).toBe('Instagram, TikTok, YouTube y Facebook');
  });

  it('lo ya subido cuyo precio cambió: más caro, ya no a la venta, y un producto que ya no está', () => {
    expect(changedAfterPostingText({ name: 'Parlante JBL Go 4', networks: ['instagram', 'tiktok'], postedPrice: 49_990, price: 52_990 })).toBe(
      'Subiste Parlante JBL Go 4 en Instagram y TikTok a $49.990 y ahora está más caro, a $52.990: bórralo o archívalo en esa red.'
    );
    expect(changedAfterPostingText({ name: 'Parlante JBL Go 4', networks: ['youtube'], postedPrice: 49_990, price: null })).toBe(
      'Subiste Parlante JBL Go 4 en YouTube a $49.990 y ya no está a la venta: bórralo o archívalo en esa red.'
    );
    expect(changedAfterPostingText({ name: null, networks: ['facebook'], postedPrice: 9_990, price: null })).toBe(
      'Subiste un producto que ya no está en el sitio en Facebook a $9.990 y ya no está a la venta: bórralo o archívalo en esa red.'
    );
  });

  it('los videos que dejaron de mostrarse: sin prometer que se rehacen', () => {
    expect(staleText(1, 14)).toBe(
      '1 video ya no se muestra porque el producto cambió (de precio, de oferta o salió del sitio). Si no lo habías marcado en ninguna red y sigue entre los sugeridos, se arma uno nuevo en una próxima pasada; si ya lo marcaste en alguna, no se vuelve a armar en 14 días.'
    );
    expect(staleText(3, 14)).toMatch(/^3 videos ya no se muestran porque/);
    expect(staleText(3, 14)).not.toMatch(/se rehacen? solos?/);
  });

  describe('nextPassText: la próxima pasada', () => {
    const line = (when: string) =>
      `Los videos se arman solos 6 veces al día, unas cada 3 horas de día. Próxima pasada: ${when}, aunque GitHub suele atrasarla entre 1 y 4 horas. Para que entren productos nuevos, marca en qué redes subiste los de hoy: lo marcado deja su lugar al siguiente.`;

    it('de día, la siguiente, en hora de Chile', () => {
      expect(nextPassText(new Date('2026-10-17T13:30:00Z'))).toBe(line('programada a las 13:10'));
      expect(nextPassText(new Date('2026-10-17T19:10:00Z'))).toBe(line('programada a las 19:10'));
    });

    it('"de mañana" según el día de Chile, no el de UTC', () => {
      // 23:30 del 17 en Chile (02:30 del 18 en UTC): la próxima es la de las 07:10 del 18.
      expect(nextPassText(new Date('2026-10-18T02:30:00Z'))).toBe(line('programada a las 07:10 de mañana'));
      // 00:30 del 18 en Chile: la de las 07:10 ya es de hoy.
      expect(nextPassText(new Date('2026-10-18T03:30:00Z'))).toBe(line('programada a las 07:10'));
      // 21:30 del 17 en Chile: la de las 22:10 es de hoy, aunque en UTC ya sea el 18.
      expect(nextPassText(new Date('2026-10-18T00:30:00Z'))).toBe(line('programada a las 22:10'));
    });

    it('en invierno las mismas pasadas, una hora antes', () => {
      expect(nextPassText(new Date('2026-06-17T09:00:00Z'))).toBe(line('programada a las 06:10'));
      expect(nextPassText(new Date('2026-06-18T02:30:00Z'))).toBe(line('programada a las 06:10 de mañana'));
    });
  });
});
