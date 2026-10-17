import { readLiveCheck, type LiveCheck } from '@/lib/social/live-price';
import { RECHECK_AFTER_MS, inBatches, type CardCheck, type CheckTarget } from './rules';

/**
 * La revisión en vivo de /admin/historias: le pregunta al servidor si lo que
 * muestra cada tarjeta sigue siendo lo que muestra Mercado Libre, y guarda la
 * respuesta en memoria.
 *
 * Se revisa al cargar la lista y al volver a la pestaña (si la última
 * revisión tiene más de 5 minutos). Nunca dentro del toque de Compartir: el
 * teléfono abre la hoja de compartir solo si se llama dentro del toque, sin
 * esperar al servidor. Por eso Compartir mira lo que ya está acá.
 *
 * Va fuera del componente y recibe de afuera la acción, el reloj y los
 * temporizadores, para probarlo con dobles.
 */

/**
 * Si el servidor no contesta en este rato, la tanda queda como "no se pudo
 * revisar". La acción se corta sola antes (no empieza productos nuevos pasados
 * 36 s, y cada uno espera 8 s como mucho): esto es para una conexión que se cayó.
 */
export const CHECK_TIMEOUT_MS = 55_000;

export interface CheckerDeps {
  /** La acción del servidor (checkLivePrices). */
  check(items: CheckTarget[]): Promise<Record<string, LiveCheck>>;
  now(): number;
  later(run: () => void, ms: number): void;
  /** La pantalla recibe el estado completo cada vez que cambia. */
  publish(state: Record<string, CardCheck>): void;
}

export interface LiveChecker {
  /** Lo que se sabe ahora de un producto. */
  get(productId: string): CardCheck | undefined;
  /** Revisa todo lo pedido, en tandas. Si ya hay una revisión viajando, no hace nada. */
  run(targets: CheckTarget[]): Promise<void>;
  /** La pestaña volvió a verse: revisa si la última revisión tiene más de 5 minutos. */
  visible(targets: CheckTarget[]): void;
  /**
   * Cada medio minuto con la pestaña a la vista: revisa antes de que el
   * "mismo precio" venza (15 minutos), para que Compartir no se trabe.
   */
  tick(targets: CheckTarget[]): void;
  running(): boolean;
}

/** Con la pestaña a la vista se revisa sola cada este rato: antes de que venza el "mismo precio". */
export const AUTO_RECHECK_MS = 12 * 60_000;

/** Lo que llega del servidor, solo si tiene la forma acordada; si no, "no se pudo revisar". Puro. */
export const readResult: (value: unknown) => LiveCheck = readLiveCheck;

export function createLiveChecker(deps: CheckerDeps): LiveChecker {
  let state: Record<string, CardCheck> = {};
  let inFlight = false;
  /** Cuándo empezó la última revisión (reloj de este teléfono), o null si nunca. */
  let lastStart: number | null = null;

  function update(productIds: string[], next: (prev: CardCheck | undefined) => CardCheck) {
    const copy = { ...state };
    for (const id of productIds) copy[id] = next(state[id]);
    state = copy;
    deps.publish(state);
  }

  /** La tanda, o un error si el servidor no contesta a tiempo. */
  function withTimeout(batch: CheckTarget[]): Promise<Record<string, LiveCheck>> {
    return new Promise((resolve, reject) => {
      deps.later(() => reject(new Error('sin respuesta')), CHECK_TIMEOUT_MS);
      let call: Promise<Record<string, LiveCheck>>;
      try {
        call = deps.check(batch);
      } catch (err) {
        call = Promise.reject(err);
      }
      call.then(resolve, reject);
    });
  }

  async function run(targets: CheckTarget[]) {
    if (inFlight || targets.length === 0) return;
    inFlight = true;
    lastStart = deps.now();
    // Lo ya sabido se conserva mientras viaja la nueva: un "cambió" no se borra por revisar otra vez.
    update(
      targets.map((t) => t.productId),
      (prev) => ({ last: prev?.last ?? null, pending: true })
    );
    try {
      // De a una tanda: las ofertas van primero en la lista y llegan primero.
      for (const batch of inBatches(targets)) {
        let answer: Record<string, LiveCheck> = {};
        try {
          const got = await withTimeout(batch);
          answer = got && typeof got === 'object' ? got : {};
        } catch {
          /* la tanda queda como "no se pudo revisar" */
        }
        const at = deps.now();
        const copy = { ...state };
        for (const t of batch) copy[t.productId] = { last: { result: readResult(answer[t.productId]), at }, pending: false };
        state = copy;
        deps.publish(state);
      }
    } finally {
      inFlight = false;
    }
  }

  /** Revisa si la última revisión empezó hace más de `afterMs` (o nunca). */
  function runIfOlder(targets: CheckTarget[], afterMs: number) {
    if (inFlight) return;
    if (lastStart !== null && deps.now() - lastStart <= afterMs) return;
    void run(targets);
  }

  return {
    get: (productId) => state[productId],
    run,
    visible: (targets) => runIfOlder(targets, RECHECK_AFTER_MS),
    tick: (targets) => runIfOlder(targets, AUTO_RECHECK_MS),
    running: () => inFlight,
  };
}
