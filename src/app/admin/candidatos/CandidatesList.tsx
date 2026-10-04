'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { X } from 'lucide-react';
import { MAX_BATCH, type BatchItemResult } from '@/lib/batch-result';
import { PAGE_SIZE, REJECT_REASONS, type CandidateGroup, type RejectReason } from '@/lib/candidate-sort';
import { reasonInfo } from '@/lib/inactive-reasons';
import { CandidateCard, type CardDone } from './CandidateCard';
import { rejectCandidates, restoreCandidates, setRejectReason } from './actions';
import { BulkLinkPanel } from '../BulkLinkPanel';

/** Desde cuántos se pide confirmar un rechazo en bloque. */
const CONFIRM_FROM = 5;
const TOAST_MS = 8000;

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

interface Stats {
  published: number;
  paused: number;
  rejected: number;
}

const EMPTY_STATS: Stats = { published: 0, paused: 0, rejected: 0 };

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * Una tanda de hasta 30 candidatos.
 *
 * Todo lo que se hace acá quita la tarjeta al instante sin releer la página:
 * con 200 pendientes, esperar la revalidación después de cada toque hacía la
 * revisión el doble de lenta. La página se relee recién con "Siguiente tanda".
 */
export function CandidatesList({
  candidates,
  directLinks = false,
  todayReviewed,
  now,
}: {
  candidates: CandidateGroup[];
  /** true solo si los links directos están encendidos y su atribución confirmada. */
  directLinks?: boolean;
  /** Candidatos revisados hoy según la base, al cargar la página. */
  todayReviewed: number;
  now: number;
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
  const [stats, setStats] = useState<Stats>(EMPTY_STATS);
  const [isPending, startTransition] = useTransition();

  // Al releer la página el conteo de hoy ya incluye lo revisado: el local
  // vuelve a cero para no contarlo dos veces.
  useEffect(() => setStats(EMPTY_STATS), [todayReviewed]);

  // El aviso de "Deshacer" dura 8 segundos desde el último toque.
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), TOAST_MS);
    return () => clearTimeout(timer);
  }, [toast]);

  const visible = candidates.filter((c) => !hidden.has(c.id));
  const selectedItems = visible
    .filter((c) => selected.has(c.id))
    .map((c) => ({ id: c.id, name: c.name, mlProductId: c.ml_product_id }));
  const count = selectedItems.length;
  const reviewedNow = todayReviewed + stats.published + stats.paused + stats.rejected;
  const allSelected = visible.length > 0 && visible.every((c) => selected.has(c.id));

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
    try {
      const result = await rejectCandidates(ids, reason);
      if (!result.ok) return result.error;
      // Los que ya no estaban pendientes (otra pestaña, otra persona) igual
      // se quitan: en la base ya no están en la cola.
      removeFromList(ids);
      setStats((s) => ({ ...s, rejected: s.rejected + result.ids.length }));
      if (result.ids.length > 0) setToast({ ids: result.ids, key: Date.now(), reason, error: null });
      return null;
    } catch {
      return 'No se pudo rechazar. Revisa la conexión e intenta de nuevo.';
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
        setStats((s) => ({ ...s, rejected: Math.max(0, s.rejected - result.ids.length) }));
        setToast(null);
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
      setStats((s) => ({ ...s, published: s.published + 1 }));
      setNotice({
        tone: 'good',
        text:
          result.reason === 'pendiente'
            ? `✓ Publicado: ${result.name}. Mercado Libre no respondió; el precio se confirma en la próxima revisión.`
            : `✓ Publicado: ${result.name}`,
      });
    } else {
      setStats((s) => ({ ...s, paused: s.paused + 1 }));
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
    const paused = items.filter(
      (i) => saved.has(i.id) && ['sin_ganador', 'ganador_no_verde', 'link_otro_producto'].includes(i.outcome)
    ).length;
    setStats((s) => ({ ...s, published: s.published + ids.length - paused, paused: s.paused + paused }));
  }

  function nextBatch() {
    setStats(EMPTY_STATS);
    setHidden(new Set());
    setNotice(null);
    setSheetOpen(false);
    window.scrollTo({ top: 0 });
    router.refresh();
  }

  const done = stats.published + stats.paused + stats.rejected;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
        <span>
          Hoy: <strong className="text-fg">{reviewedNow}</strong> de {PAGE_SIZE} revisados
        </span>
        {visible.length > 0 && (
          <button
            type="button"
            onClick={toggleAll}
            className="min-h-11 rounded-md border border-border px-3 py-2 font-medium text-fg transition hover:border-accent/50"
          >
            {allSelected ? 'Quitar selección' : `Seleccionar estos ${Math.min(visible.length, MAX_BATCH)}`}
          </button>
        )}
      </div>

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
        done > 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-xl border border-accent/30 bg-accent/5 px-4 py-8 text-center">
            <p className="text-sm font-semibold text-fg">
              ✓ {plural(stats.published, 'publicado', 'publicados')}
              {stats.paused > 0 ? ` · ${stats.paused} en pausa` : ''}
              {stats.rejected > 0 ? ` · ${plural(stats.rejected, 'rechazado', 'rechazados')}` : ''}
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
          <p className="text-sm text-muted">No hay candidatos en esta página.</p>
        )
      ) : (
        visible.map((c) => (
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
        ))
      )}

      {error && <p className="text-xs text-red-400">{error}</p>}

      {/* Barra de la selección, pegada abajo y sobre la zona segura del
          teléfono (la barra de gestos del iPhone tapaba los botones). */}
      {count > 0 && (
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
            <button
              type="button"
              onClick={() => setSheetOpen(true)}
              disabled={isPending}
              className="min-h-11 rounded-md bg-accent px-4 py-2 text-sm font-medium text-ink transition hover:bg-accent/90 disabled:opacity-40"
            >
              Aprobar {count}
            </button>
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

      {/* "Aprobar N" abre la carga de links como hoja inferior. */}
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
