'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { X } from 'lucide-react';
import {
  MAX_BATCH,
  isPausedOutcome,
  isSavedOutcome,
  type BatchItemResult,
  type BatchResult,
} from '@/lib/batch-result';
import { PAGE_SIZE, REJECT_REASONS, type CandidateGroup, type RejectReason } from '@/lib/candidate-sort';
import { reasonInfo } from '@/lib/inactive-reasons';
import { CandidateCard, type CardDone } from './CandidateCard';
import { approveBatch, rejectCandidates, restoreCandidates, setRejectReason } from './actions';
import { BulkLinkPanel } from '../BulkLinkPanel';

/** Desde cuántos se pide confirmar un rechazo en bloque. */
const CONFIRM_FROM = 5;
const TOAST_MS = 8000;
/** Cuánto dura armado un botón de "toca de nuevo para confirmar". */
const ARM_MS = 5000;
/** Un doble clic no cuenta como confirmación: el segundo toque tiene que ser aparte. */
const ARM_MIN_MS = 400;
/** Con menos tarjetas que esto, el botón de arriba ya está a la vista y no se repite abajo. */
const BOTTOM_BUTTON_FROM = 5;

interface RejectToast {
  ids: string[];
  /** Cambia con cada toque, para reiniciar los 8 segundos. */
  key: number;
  reason: RejectReason | null;
  error: string | null;
}

interface Notice {
  tone: 'good' | 'warn';
  text: string;
}

/** Lo hecho en esta tanda, para el cierre "✓ N publicados". */
interface Tally {
  published: number;
  paused: number;
  rejected: number;
}

const EMPTY_TALLY: Tally = { published: 0, paused: 0, rejected: 0 };

/** Cómo terminó una aprobación en bloque con links directos. */
interface ApprovalSummary {
  published: number;
  /** Publicados con el precio del candidato: ML no respondió a tiempo. */
  unconfirmed: number;
  paused: BatchItemResult[];
  failed: BatchItemResult[];
  /** Los que no se alcanzaron a enviar (se detuvo, o una tanda anterior falló). */
  notSent: number;
  /**
   * La tanda que iba en camino cuando se perdió la respuesta (se cortó la
   * conexión, el teléfono se durmió): el servidor pudo haberla publicado
   * entera, a medias o nada. No se afirma ni "se publicó" ni "sigue en la
   * cola" hasta releer la lista.
   */
  unknownIds: string[];
  /** El servidor rechazó la tanda entera (por ejemplo, se apagaron los links directos). */
  failure: string | null;
  /** `now` de la página al armar el resumen: cuando cambia, la lista ya se releyó. */
  renderedAt: number;
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

function summarize(
  items: BatchItemResult[],
  rest: Pick<ApprovalSummary, 'notSent' | 'unknownIds' | 'failure' | 'renderedAt'>
): ApprovalSummary {
  const saved = items.filter((i) => isSavedOutcome(i.outcome));
  const paused = saved.filter((i) => isPausedOutcome(i.outcome));
  return {
    published: saved.length - paused.length,
    unconfirmed: saved.filter((i) => i.outcome === 'pendiente' || i.outcome === 'error_transitorio').length,
    paused,
    // Otro color de un modelo que sí se publicó no es una falla: sale solo de la cola.
    failed: items.filter((i) => !isSavedOutcome(i.outcome) && i.outcome !== 'omitido_variante'),
    ...rest,
  };
}

function failureText(item: BatchItemResult): string {
  if (item.outcome === 'sin_link') {
    return 'no se pudo armar el link directo: revisa matt_word y matt_tool en Configuración';
  }
  return item.detail ?? 'no se pudo guardar';
}

/**
 * Una tanda de hasta 30 candidatos.
 *
 * Con los links directos comprobados no hay nada que pegar: se rechaza lo
 * que no sirve y el resto se publica de una vez (la página o todo el
 * filtro). Sin ellos, "Aprobar N" abre la carga de links meli.la.
 *
 * Rechazar quita la tarjeta al instante sin releer la página: con 200
 * pendientes, esperar al servidor después de cada toque hacía la revisión el
 * doble de lenta. Después de aprobar en bloque sí se relee, para traer la
 * tanda siguiente sin un clic más.
 */
export function CandidatesList({
  candidates,
  directLinks = false,
  todayReviewed,
  now,
  filterIds = [],
  filterTotal = 0,
  emptyText = 'No hay candidatos en esta página.',
}: {
  candidates: CandidateGroup[];
  /** true solo si los links directos están encendidos y su atribución confirmada. */
  directLinks?: boolean;
  /** Candidatos revisados hoy según la base, al cargar la página. */
  todayReviewed: number;
  now: number;
  /** Los modelos de todas las páginas del filtro, en el orden de la vista (con tope). */
  filterIds?: string[];
  /** Cuántos modelos calzan con el filtro, aunque filterIds venga cortado. */
  filterTotal?: number;
  /** Qué decir si la página llega sin candidatos. */
  emptyText?: string;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [toast, setToast] = useState<RejectToast | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [confirmReason, setConfirmReason] = useState<RejectReason | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [tally, setTally] = useState<Tally>(EMPTY_TALLY);
  // Rechazos que la base todavía no contó en todayReviewed (rechazar no relee la página).
  const [uncountedRejects, setUncountedRejects] = useState(0);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [summary, setSummary] = useState<ApprovalSummary | null>(null);
  const [confirmAll, setConfirmAll] = useState(false);
  // Rechazos que todavía no responden: mientras haya uno, no se aprueba en bloque.
  const [rejecting, setRejecting] = useState(0);
  const [isPending, startTransition] = useTransition();
  const [isRefreshing, startRefresh] = useTransition();
  const stopRef = useRef(false);
  const runningRef = useRef(false);
  const mountedRef = useRef(true);
  // La hora de la última lectura de la página, para lo que termina después de un await.
  const nowRef = useRef(now);
  useEffect(() => {
    nowRef.current = now;
  }, [now]);

  // Al releer la página el conteo de hoy ya incluye los rechazos: el local
  // vuelve a cero para no contarlos dos veces.
  useEffect(() => setUncountedRejects(0), [todayReviewed]);

  // El aviso de "Deshacer" dura 8 segundos desde el último toque.
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), TOAST_MS);
    return () => clearTimeout(timer);
  }, [toast]);

  // Si se sale de la página a mitad de "Aprobar todo", no se mandan más
  // tandas ni se relee una página que ya no es esta.
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      stopRef.current = true;
    };
  }, []);

  const visible = candidates.filter((c) => !hidden.has(c.id));
  const selectedItems = visible
    .filter((c) => selected.has(c.id))
    .map((c) => ({ id: c.id, name: c.name, mlProductId: c.ml_product_id }));
  const count = selectedItems.length;
  const reviewedNow = todayReviewed + uncountedRejects;
  const allSelected = visible.length > 0 && visible.every((c) => selected.has(c.id));
  const busy = progress !== null;
  // Mientras algo está en camino (un rechazo, una relectura de la página) la
  // lista puede cambiar bajo el dedo: no se publica en bloque hasta que asiente.
  const locked = busy || isRefreshing || isPending || rejecting > 0;
  // Todo el filtro, sin lo que ya se rechazó o aprobó en esta visita.
  const allIds = filterIds.filter((id) => !hidden.has(id));
  const moreThanShown = filterTotal > filterIds.length;

  function removeFromList(ids: string[]) {
    setHidden((prev) => new Set([...prev, ...ids]));
    setSelected((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => next.delete(id));
      return next;
    });
  }

  function toggle(id: string) {
    if (!selected.has(id) && selected.size >= MAX_BATCH) {
      setError(`Máximo ${MAX_BATCH} por tanda.`);
      return;
    }
    setError(null);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setError(null);
    setSelected(allSelected ? new Set() : new Set(visible.slice(0, MAX_BATCH).map((c) => c.id)));
  }

  /** Rechaza, quita las tarjetas y deja el aviso con "Deshacer". Devuelve el error, o null. */
  async function reject(ids: string[], reason: RejectReason | null): Promise<string | null> {
    setRejecting((n) => n + 1);
    try {
      const result = await rejectCandidates(ids, reason);
      if (!result.ok) return result.error;
      // Los que ya no estaban pendientes (otra pestaña, otra persona) igual
      // se quitan: en la base ya no están en la cola.
      removeFromList(ids);
      setTally((t) => ({ ...t, rejected: t.rejected + result.ids.length }));
      setUncountedRejects((n) => n + result.ids.length);
      if (result.ids.length > 0) setToast({ ids: result.ids, key: Date.now(), reason, error: null });
      return null;
    } catch {
      return 'No se pudo rechazar. Revisa la conexión e intenta de nuevo.';
    } finally {
      setRejecting((n) => Math.max(0, n - 1));
    }
  }

  function handleBulkReject(reason: RejectReason | null) {
    setError(null);
    setConfirming(false);
    // Cada tarjeta es un modelo: se rechazan también sus otros colores, o el
    // siguiente más barato volvía como tarjeta nueva en la próxima tanda.
    // selectedItems no se toca: el panel de links lo usa para copiar URLs y
    // como ids de approveBatch.
    const ids = visible
      .filter((c) => selected.has(c.id))
      .flatMap((c) => [c.id, ...c.siblings.map((s) => s.id)]);
    startTransition(async () => {
      const failure = await reject(ids, reason);
      if (failure) setError(failure);
    });
  }

  function askBulkReject() {
    if (count > CONFIRM_FROM) {
      setConfirmReason(null);
      setConfirming(true);
    } else handleBulkReject(null);
  }

  function undo() {
    if (!toast) return;
    const { ids } = toast;
    startTransition(async () => {
      try {
        const result = await restoreCandidates(ids);
        if (!result.ok) {
          setToast((t) => (t ? { ...t, key: Date.now(), error: result.error } : t));
          return;
        }
        setHidden((prev) => {
          const next = new Set(prev);
          ids.forEach((id) => next.delete(id));
          return next;
        });
        setTally((t) => ({ ...t, rejected: Math.max(0, t.rejected - result.ids.length) }));
        setUncountedRejects((n) => Math.max(0, n - result.ids.length));
        setToast(null);
        // Si la página se releyó después del rechazo (pasa al aprobar otra
        // tarjeta entre medio), las recuperadas ya no vienen en la lista: se
        // lee de nuevo para que aparezcan. Deshacer es poco frecuente y vale
        // más mostrarlas siempre que ahorrarse la lectura.
        startRefresh(() => router.refresh());
      } catch {
        setToast((t) => (t ? { ...t, key: Date.now(), error: 'No se pudo deshacer. Intenta de nuevo.' } : t));
      }
    });
  }

  function chooseReason(reason: RejectReason) {
    if (!toast) return;
    const { ids } = toast;
    setToast({ ...toast, reason, key: Date.now(), error: null });
    startTransition(async () => {
      try {
        const result = await setRejectReason(ids, reason);
        if (!result.ok) setToast((t) => (t ? { ...t, key: Date.now(), error: result.error } : t));
      } catch {
        setToast((t) => (t ? { ...t, key: Date.now(), error: 'No se pudo guardar el motivo.' } : t));
      }
    });
  }

  function handleCardDone(id: string, result: CardDone) {
    removeFromList([id]);
    if (result.kind === 'rechazado') return; // ya contado en reject()
    if (result.outcome === 'publicado') {
      setTally((t) => ({ ...t, published: t.published + 1 }));
      setNotice({
        tone: 'good',
        text:
          result.reason === 'pendiente'
            ? `✓ Publicado: ${result.name}. Mercado Libre no respondió; el precio se confirma en la próxima revisión.`
            : `✓ Publicado: ${result.name}`,
      });
    } else {
      setTally((t) => ({ ...t, paused: t.paused + 1 }));
      setNotice({
        tone: 'warn',
        text: `En pausa: ${result.name}. ${reasonInfo(result.reason).title}: se publica solo cuando corresponda.`,
      });
    }
  }

  function handleBatchDone(ids: string[], items: BatchItemResult[]) {
    removeFromList(ids);
    // Un candidato aprobado entra visible: solo queda en pausa si la
    // revisión de precio lo sacó (sin ganador, vendedor no verde, otra ficha).
    const saved = new Set(ids);
    const paused = items.filter((i) => saved.has(i.id) && isPausedOutcome(i.outcome)).length;
    setTally((t) => ({ ...t, published: t.published + ids.length - paused, paused: t.paused + paused }));
  }

  /**
   * Aprueba con links directos, de a tandas de MAX_BATCH (lo que el servidor
   * alcanza a publicar y a revisar en ML dentro de su tiempo). Al terminar
   * relee la página: la tanda siguiente aparece sola.
   */
  async function approveDirect(ids: string[]) {
    // Con una referencia y no con el estado: dos toques seguidos llegan antes
    // de que el estado cambie y lanzarían dos corridas a la vez.
    if (ids.length === 0 || runningRef.current) return;
    runningRef.current = true;
    setError(null);
    setNotice(null);
    setSummary(null);
    setConfirmAll(false);
    stopRef.current = false;
    setProgress({ done: 0, total: ids.length });

    const results: BatchItemResult[] = [];
    let sent = 0;
    let failure: string | null = null;
    let unknownIds: string[] = [];
    for (let i = 0; i < ids.length && !stopRef.current; i += MAX_BATCH) {
      const chunk = ids.slice(i, i + MAX_BATCH);
      let res: BatchResult;
      try {
        res = await approveBatch(chunk, '');
      } catch {
        // Se perdió la respuesta, no necesariamente el trabajo: el servidor
        // pudo publicar la tanda igual. No se cuenta como enviada ni como
        // pendiente; el resumen lo aclara cuando se relea la lista.
        unknownIds = chunk;
        break;
      }
      if (!res.ok) {
        failure = res.error;
        break;
      }
      sent += chunk.length;
      results.push(...res.items);
      handleBatchDone(
        res.items.filter((item) => isSavedOutcome(item.outcome)).map((item) => item.id),
        res.items
      );
      // Los que ya no estaban pendientes (se revisaron en otra pestaña) no
      // vuelven en la respuesta: igual se quitan de la lista.
      const answered = new Set(res.items.map((item) => item.id));
      removeFromList(chunk.filter((id) => !answered.has(id)));
      setProgress({ done: sent, total: ids.length });
    }

    runningRef.current = false;
    // Si ya se salió de la página no hay nada que mostrar, y releer acá
    // recargaría la página en la que esté ahora.
    if (!mountedRef.current) return;

    setProgress(null);
    const notSent = Math.max(0, ids.length - sent - unknownIds.length);
    if (results.length > 0 || notSent > 0 || unknownIds.length > 0 || failure) {
      setSummary(summarize(results, { notSent, unknownIds, failure, renderedAt: nowRef.current }));
    }
    // El resumen queda arriba y la lista que viene es otra: se parte desde el comienzo.
    window.scrollTo({ top: 0 });
    startRefresh(() => router.refresh());
  }

  function nextBatch() {
    // `hidden` no se limpia: las tarjetas ya revisadas siguen en la lista
    // hasta que llega la lectura nueva, y volverían a aparecer por un momento
    // con el botón de aprobar la página a mano.
    setTally(EMPTY_TALLY);
    setNotice(null);
    setSummary(null);
    setSheetOpen(false);
    window.scrollTo({ top: 0 });
    startRefresh(() => router.refresh());
  }

  const done = tally.published + tally.paused + tally.rejected;
  const pageIds = visible.map((c) => c.id);
  // Cambia cuando cambia la lista: desarma los botones de dos toques, para que
  // el segundo toque nunca publique algo distinto de lo que se veía en el primero.
  const pageKey = pageIds.join(',');
  const selectedKey = selectedItems.map((item) => item.id).join(',');

  const unknownTotal = summary?.unknownIds.length ?? 0;
  const nothingApproved = summary !== null && summary.published + summary.paused.length === 0;
  // Lo que sigue pendiente según la última lectura de la página.
  const pendingNow = new Set([...candidates.flatMap((c) => [c.id, ...c.siblings.map((s) => s.id)]), ...filterIds]);
  const unknownStill = summary ? summary.unknownIds.filter((id) => pendingNow.has(id)).length : 0;
  const listReread = summary !== null && now !== summary.renderedAt;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
        <span>
          Hoy: <strong className="text-fg">{reviewedNow}</strong> {reviewedNow === 1 ? 'revisado' : 'revisados'}
        </span>
        {visible.length > 0 && (
          <button
            type="button"
            onClick={toggleAll}
            disabled={busy}
            className="min-h-11 rounded-md border border-border px-3 py-2 font-medium text-fg transition hover:border-accent/50 disabled:opacity-40"
          >
            {allSelected ? 'Quitar selección' : `Seleccionar estos ${Math.min(visible.length, MAX_BATCH)}`}
          </button>
        )}
      </div>

      {/* Con links directos no hay nada que pegar: la página entera se publica de una vez. */}
      {directLinks && visible.length > 0 && (
        <div className="flex flex-col gap-3 rounded-xl border border-accent/30 bg-accent/5 p-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-muted">
            <strong className="text-fg">Los links se arman solos.</strong> Rechaza los que no quieras y publica el
            resto de una vez.
          </p>
          <div className="flex shrink-0 flex-col gap-2 sm:items-end">
            <ConfirmButton
              key={`arriba:${pageKey}`}
              label={`Aprobar los ${visible.length} de esta página`}
              confirmLabel={`Toca de nuevo para publicar ${visible.length}`}
              disabled={locked}
              onConfirm={() => approveDirect(pageIds)}
            />
            {allIds.length > visible.length && (
              <button
                type="button"
                onClick={() => setConfirmAll(true)}
                disabled={locked}
                className="min-h-11 px-1 text-left text-xs font-medium text-accent underline-offset-2 hover:underline disabled:opacity-40 sm:text-right"
              >
                {moreThanShown
                  ? `Aprobar los primeros ${allIds.length} de todo el filtro`
                  : `Aprobar los ${allIds.length} de todo el filtro`}
              </button>
            )}
          </div>
        </div>
      )}

      {summary && (
        <div
          role="status"
          className={`rounded-xl border px-3 py-3 text-xs ${
            unknownTotal > 0
              ? 'border-amber-500/40 bg-amber-500/5'
              : nothingApproved
                ? 'border-red-500/30 bg-red-500/5'
                : 'border-accent/30 bg-accent/5'
          }`}
        >
          <div className="flex items-start justify-between gap-2">
            <p className="text-sm font-semibold text-fg">
              {nothingApproved ? (
                unknownTotal > 0 ? (
                  'Se cortó la conexión a mitad de la tanda'
                ) : (
                  'No se aprobó ninguno'
                )
              ) : (
                <>
                  ✓ {plural(summary.published, 'publicado', 'publicados')}
                  {summary.paused.length > 0 ? ` · ${summary.paused.length} en pausa` : ''}
                  {summary.failed.length > 0 ? ` · ${summary.failed.length} sin aprobar` : ''}
                </>
              )}
            </p>
            <button
              type="button"
              onClick={() => setSummary(null)}
              aria-label="Cerrar resumen"
              className="-m-2 shrink-0 p-2 text-muted hover:text-fg"
            >
              <X size={14} />
            </button>
          </div>
          {summary.unconfirmed > 0 && (
            <p className="mt-1 text-muted">
              {summary.unconfirmed === 1 ? '1 quedó' : `${summary.unconfirmed} quedaron`} con el precio por confirmar:
              Mercado Libre no respondió a tiempo y se corrige solo en la próxima revisión (cada 30 minutos).
            </p>
          )}
          {summary.paused.length > 0 && (
            <details className="mt-2">
              <summary className="cursor-pointer py-1 text-amber-400">
                {summary.paused.length} en pausa: se {summary.paused.length === 1 ? 'publica solo' : 'publican solos'}{' '}
                cuando Mercado Libre tenga un vendedor confiable
              </summary>
              <ul className="mt-1 flex flex-col gap-1 border-l border-border pl-3 text-muted">
                {summary.paused.map((item) => (
                  <li key={item.id}>
                    <span className="text-fg">{item.name}</span> · {reasonInfo(item.outcome).title}
                  </li>
                ))}
              </ul>
            </details>
          )}
          {summary.failed.length > 0 && (
            <div className="mt-2 text-red-400">
              <p>No se {summary.failed.length === 1 ? 'aprobó (sigue' : 'aprobaron (siguen'} en la cola):</p>
              <ul className="mt-1 flex flex-col gap-1 border-l border-red-500/30 pl-3">
                {summary.failed.map((item) => (
                  <li key={item.id}>
                    <span className="text-fg">{item.name}</span> · {failureText(item)}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {summary.failure && <p className="mt-2 text-red-400">{summary.failure}</p>}
          {/* La respuesta de una tanda se perdió: se dice lo que muestra la
              cola ahora, nunca "no se aprobó" a ciegas. Si el servidor seguía
              trabajando, la cola puede cambiar todavía: por eso el botón. */}
          {unknownTotal > 0 && (
            <div className="mt-2 text-amber-400">
              <p>
                {!listReread
                  ? `Se perdió la respuesta de una tanda de ${unknownTotal}: puede que se haya publicado igual. ${
                      isRefreshing ? 'Comprobando en la cola…' : 'Todavía no se pudo comprobar en la cola.'
                    }`
                  : unknownStill === 0
                    ? `Se perdió la respuesta de una tanda de ${unknownTotal}, pero sí se aprobó: ya no ${
                        unknownTotal === 1 ? 'está' : 'están'
                      } en la cola.`
                    : unknownStill === unknownTotal
                      ? `Se perdió la respuesta de una tanda de ${unknownTotal} y por ahora ${
                          unknownTotal === 1 ? 'sigue' : 'siguen'
                        } en la cola. Si el servidor todavía la estaba publicando, pueden salir en un momento.`
                      : `Se perdió la respuesta de una tanda de ${unknownTotal}: ${
                          unknownTotal - unknownStill
                        } ya se ${unknownTotal - unknownStill === 1 ? 'aprobó' : 'aprobaron'} y ${unknownStill} ${
                          unknownStill === 1 ? 'sigue' : 'siguen'
                        } en la cola por ahora.`}
              </p>
              <p className="mt-1 text-muted">
                La lista de abajo es la cola como está ahora, no necesariamente la misma tanda: mírala antes de aprobar
                de nuevo.
              </p>
              <button
                type="button"
                onClick={() => startRefresh(() => router.refresh())}
                disabled={isRefreshing}
                className="mt-2 min-h-11 rounded-md border border-border px-3 py-2 font-medium text-fg transition hover:border-accent/50 disabled:opacity-40"
              >
                {isRefreshing ? 'Comprobando…' : 'Comprobar de nuevo'}
              </button>
            </div>
          )}
          {summary.notSent > 0 && (
            <p className="mt-2 text-amber-400">
              {summary.notSent === 1 ? 'Quedó 1' : `Quedaron ${summary.notSent}`} sin enviar:{' '}
              {summary.notSent === 1 ? 'sigue' : 'siguen'} en la cola.
            </p>
          )}
        </div>
      )}

      {notice && (
        <div
          className={`flex items-start justify-between gap-2 rounded-lg border px-3 py-2 text-xs ${
            notice.tone === 'good'
              ? 'border-accent/30 bg-accent/5 text-accent'
              : 'border-amber-500/30 bg-amber-500/5 text-amber-400'
          }`}
        >
          <span>{notice.text}</span>
          <button type="button" onClick={() => setNotice(null)} aria-label="Cerrar aviso" className="shrink-0">
            <X size={14} />
          </button>
        </div>
      )}

      {visible.length === 0 ? (
        busy || isRefreshing ? (
          <p className="text-sm text-muted">Cargando la siguiente tanda…</p>
        ) : done > 0 && candidates.length > 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-xl border border-accent/30 bg-accent/5 px-4 py-8 text-center">
            <p className="text-sm font-semibold text-fg">
              ✓ {plural(tally.published, 'publicado', 'publicados')}
              {tally.paused > 0 ? ` · ${tally.paused} en pausa` : ''}
              {tally.rejected > 0 ? ` · ${plural(tally.rejected, 'rechazado', 'rechazados')}` : ''}
            </p>
            <button
              type="button"
              onClick={nextBatch}
              className="min-h-11 rounded-md bg-accent px-5 py-2 text-sm font-medium text-ink transition hover:bg-accent/90"
            >
              Siguiente tanda ({PAGE_SIZE}) →
            </button>
          </div>
        ) : (
          <p className="text-sm text-muted">{emptyText}</p>
        )
      ) : (
        // Mientras se publica una tanda la lista no se toca: un rechazo o
        // una aprobación suelta se cruzaría con lo que ya se mandó.
        <div
          aria-busy={busy}
          className={`flex flex-col gap-3 transition-opacity ${busy ? 'pointer-events-none opacity-50' : ''}`}
        >
          {visible.map((c) => (
            <CandidateCard
              key={c.id}
              candidate={c}
              selected={selected.has(c.id)}
              onToggleSelect={() => toggle(c.id)}
              directLinks={directLinks}
              now={now}
              // El modelo entero, con sus otros colores (ver handleBulkReject).
              onReject={() => reject([c.id, ...c.siblings.map((s) => s.id)], null)}
              onDone={handleCardDone}
            />
          ))}
        </div>
      )}

      {/* Al final de la lista: después de mirar la página, el botón queda a mano. */}
      {directLinks && visible.length >= BOTTOM_BUTTON_FROM && (
        <ConfirmButton
          key={`abajo:${pageKey}`}
          label={`Aprobar los ${visible.length} que quedan en esta página`}
          confirmLabel={`Toca de nuevo para publicar ${visible.length}`}
          disabled={locked}
          onConfirm={() => approveDirect(pageIds)}
          wide
        />
      )}

      {error && <p className="text-xs text-red-400">{error}</p>}

      {/* Avance de la aprobación en bloque, pegado abajo. */}
      {progress && (
        <div
          role="status"
          className="sticky bottom-0 z-20 -mx-4 border-t border-border bg-surface/95 px-4 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3 backdrop-blur"
        >
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-medium text-fg">
              {progress.total > MAX_BATCH
                ? `Publicando… ${progress.done} de ${progress.total}`
                : `Publicando ${progress.total}…`}
            </p>
            {progress.total > MAX_BATCH && (
              <button
                type="button"
                onClick={() => {
                  stopRef.current = true;
                }}
                className="min-h-11 rounded-md border border-border px-3 py-2 text-sm text-muted transition hover:text-fg"
              >
                Detener
              </button>
            )}
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface2">
            <div
              className="h-full bg-accent transition-all"
              style={{ width: `${Math.max(4, Math.round((progress.done / progress.total) * 100))}%` }}
            />
          </div>
          <p className="mt-2 text-xs text-muted">
            Se revisa el precio de cada uno en Mercado Libre. Deja esta pestaña abierta hasta que termine.
          </p>
        </div>
      )}

      {/* Barra de la selección, pegada abajo y sobre la zona segura del
          teléfono (la barra de gestos del iPhone tapaba los botones). */}
      {count > 0 && !progress && (
        <div className="sticky bottom-0 z-20 -mx-4 border-t border-border bg-surface/95 px-4 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3 backdrop-blur">
          <div className="flex flex-wrap items-center gap-2">
            <span className="mr-auto text-sm font-medium text-fg">{plural(count, 'seleccionado', 'seleccionados')}</span>
            <button
              type="button"
              onClick={askBulkReject}
              disabled={isPending}
              className="min-h-11 rounded-md border border-border px-3 py-2 text-sm text-muted transition hover:text-fg disabled:opacity-40"
            >
              {isPending ? 'Rechazando…' : `Rechazar ${count}`}
            </button>
            {directLinks ? (
              // Con links directos se publican sin pasar por la hoja de
              // links, pero igual con dos toques: la barra aparece bajo el
              // dedo al elegir la primera tarjeta, y un doble toque en esa
              // franja caía justo sobre este botón.
              <ConfirmButton
                key={`seleccion:${selectedKey}`}
                label={`Aprobar ${count}`}
                confirmLabel={`Toca de nuevo: publicar ${count}`}
                disabled={locked}
                onConfirm={() => approveDirect(selectedItems.map((item) => item.id))}
              />
            ) : (
              <button
                type="button"
                onClick={() => setSheetOpen(true)}
                disabled={isPending}
                className="min-h-11 rounded-md bg-accent px-4 py-2 text-sm font-medium text-ink transition hover:bg-accent/90 disabled:opacity-40"
              >
                Aprobar {count}
              </button>
            )}
            <button
              type="button"
              onClick={() => setSelected(new Set())}
              className="min-h-11 px-2 text-xs text-muted underline-offset-2 hover:text-fg hover:underline"
            >
              Limpiar
            </button>
          </div>
        </div>
      )}

      {/* Aviso con "Deshacer" después de cualquier rechazo. */}
      {toast && (
        <div className="fixed inset-x-0 bottom-28 z-30 mx-auto w-full max-w-md px-4" role="status">
          <div className="rounded-xl border border-border bg-surface2 p-3 text-xs text-fg shadow-lg">
            <div className="flex items-center justify-between gap-2">
              <span>
                Rechazaste {plural(toast.ids.length, 'candidato', 'candidatos')}
              </span>
              <button
                type="button"
                onClick={undo}
                disabled={isPending}
                className="min-h-11 rounded-md px-3 font-semibold text-accent transition hover:bg-accent/10 disabled:opacity-40"
              >
                Deshacer
              </button>
            </div>
            <p className="mt-1 text-muted">Motivo (opcional):</p>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {REJECT_REASONS.map((r) => (
                <button
                  key={r.value}
                  type="button"
                  onClick={() => chooseReason(r.value)}
                  className={`rounded-full border px-2.5 py-1.5 transition ${
                    toast.reason === r.value ? 'border-accent text-accent' : 'border-border text-muted hover:text-fg'
                  }`}
                >
                  {toast.reason === r.value ? '✓ ' : ''}
                  {r.label}
                </button>
              ))}
            </div>
            {toast.error && <p className="mt-2 text-red-400">{toast.error}</p>}
          </div>
        </div>
      )}

      {/* Confirmación para rechazos grandes: un toque de más no puede botar 30. */}
      {confirming && (
        <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/60 p-4 sm:items-center">
          <div role="dialog" aria-modal="true" className="w-full max-w-sm rounded-xl border border-border bg-surface p-4">
            <p className="text-sm font-semibold text-fg">Rechazar {plural(count, 'candidato', 'candidatos')}</p>
            <p className="mt-1 text-xs text-muted">No volverán a aparecer en la prospección.</p>
            <p className="mt-3 text-xs text-muted">Motivo (opcional):</p>
            <div className="mt-1 flex flex-wrap gap-1.5 text-xs">
              {REJECT_REASONS.map((r) => (
                <button
                  key={r.value}
                  type="button"
                  onClick={() => setConfirmReason((cur) => (cur === r.value ? null : r.value))}
                  className={`rounded-full border px-2.5 py-1.5 transition ${
                    confirmReason === r.value ? 'border-accent text-accent' : 'border-border text-muted hover:text-fg'
                  }`}
                >
                  {r.label}
                </button>
              ))}
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirming(false)}
                className="min-h-11 rounded-md border border-border px-4 py-2 text-sm text-muted transition hover:text-fg"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => handleBulkReject(confirmReason)}
                className="min-h-11 rounded-md bg-red-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-red-500/90"
              >
                Rechazar {count}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirmación de "Aprobar todo el filtro": publica sin mirar uno a uno. */}
      {confirmAll && (
        <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/60 p-4 sm:items-center">
          <div role="dialog" aria-modal="true" className="w-full max-w-sm rounded-xl border border-border bg-surface p-4">
            <p className="text-sm font-semibold text-fg">Publicar {plural(allIds.length, 'producto', 'productos')}</p>
            <p className="mt-2 text-xs text-muted">
              Se aprueban todos los que calzan con el filtro actual, también los de las otras páginas, sin revisarlos
              uno a uno. Va de a tandas de {MAX_BATCH} y puede tardar un par de minutos: deja esta pestaña abierta.
            </p>
            <p className="mt-2 text-xs text-muted">
              Los que Mercado Libre no tenga con un vendedor confiable quedan en pausa y se publican solos después.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmAll(false)}
                className="min-h-11 rounded-md border border-border px-4 py-2 text-sm text-muted transition hover:text-fg"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => approveDirect(allIds)}
                className="min-h-11 rounded-md bg-accent px-4 py-2 text-sm font-medium text-ink transition hover:bg-accent/90"
              >
                Publicar {allIds.length}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Sin links directos, "Aprobar N" abre la carga de links como hoja inferior. */}
      {sheetOpen && (
        <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/60" onClick={() => setSheetOpen(false)}>
          <div
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
            className="max-h-[85vh] w-full max-w-4xl overflow-y-auto rounded-t-2xl border border-border bg-surface px-4 pt-4 pb-[calc(1rem+env(safe-area-inset-bottom))]"
          >
            <div className="mb-3 flex items-center justify-between">
              <p className="text-sm font-semibold text-fg">Aprobar en bloque</p>
              <button
                type="button"
                onClick={() => setSheetOpen(false)}
                className="min-h-11 px-2 text-xs text-muted hover:text-fg"
              >
                Cerrar
              </button>
            </div>
            {/* Siempre montado: si se aprobaron todos, el panel sigue
                mostrando el resultado de cada producto. */}
            <BulkLinkPanel
              items={selectedItems}
              mode="aprobar"
              directLinks={directLinks}
              refreshOnDone={false}
              onDone={handleBatchDone}
            />
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Botón de dos toques: el primero lo arma ("Toca de nuevo…"), el segundo
 * confirma. Publicar una página entera con un toque suelto —el pulgar al
 * pasar, un doble clic— sería demasiado fácil; con dos, sigue siendo rápido.
 */
function ConfirmButton({
  label,
  confirmLabel,
  disabled = false,
  wide = false,
  onConfirm,
}: {
  label: string;
  confirmLabel: string;
  disabled?: boolean;
  /** Ocupa todo el ancho (el que va al final de la lista). */
  wide?: boolean;
  onConfirm: () => void;
}) {
  const [armed, setArmed] = useState(false);
  const armedAt = useRef(0);

  useEffect(() => {
    if (!armed) return;
    const timer = setTimeout(() => setArmed(false), ARM_MS);
    return () => clearTimeout(timer);
  }, [armed]);

  function handleClick() {
    if (!armed) {
      armedAt.current = Date.now();
      setArmed(true);
      return;
    }
    if (Date.now() - armedAt.current < ARM_MIN_MS) return;
    setArmed(false);
    onConfirm();
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={disabled}
      className={`min-h-11 rounded-md px-4 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-40 ${
        wide ? 'w-full' : ''
      } ${armed ? 'bg-amber-400 text-ink hover:bg-amber-400/90' : 'bg-accent text-ink hover:bg-accent/90'}`}
    >
      {armed ? confirmLabel : label}
    </button>
  );
}
