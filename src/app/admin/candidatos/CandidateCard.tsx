'use client';

import { useRef, useState, useTransition, type MouseEvent } from 'react';
import Image from 'next/image';
import { ChevronDown, ChevronRight, ExternalLink } from 'lucide-react';
import { formatCLP, formatTimeAgo } from '@/lib/format';
import { mlProductUrl } from '@/lib/ml-urls';
import mlImageLoader from '@/lib/ml-image-loader';
import { candidateCommission, discountPct, type CandidateGroup } from '@/lib/candidate-sort';
import { checkAffiliateLink } from '@/lib/actions/catalog-admin';
import { approveCandidate } from './actions';

type LinkCheck =
  | { status: 'idle' }
  | { status: 'ok' }
  | { status: 'otro_producto'; featuredProductId: string | null }
  | { status: 'indeterminado' }
  | { status: 'error'; message: string };

type Pending = 'verificando' | 'publicando' | 'rechazando' | null;

const PENDING_LABEL: Record<Exclude<Pending, null>, string> = {
  verificando: 'Verificando…',
  publicando: 'Publicando…',
  rechazando: 'Rechazando…',
};

export type CardDone =
  | { kind: 'aprobado'; name: string; outcome: 'publicado' | 'en_pausa'; reason?: string }
  | { kind: 'rechazado'; name: string };

/** Elementos que hacen su propia cosa: tocarlos no cambia la selección de la fila. */
const INTERACTIVE = 'a, button, input, textarea, select, summary, label, [data-no-select]';

/**
 * Una fila de la cola: lo justo para decidir en segundos (foto, precio,
 * descuento, comisión estimada, señales de ML) y el detalle bajo "›".
 *
 * Toda la fila se toca para seleccionarla —con el pulgar, en un teléfono, un
 * checkbox de 16 px era el blanco más difícil de la pantalla—.
 */
export function CandidateCard({
  candidate,
  selected = false,
  onToggleSelect,
  directLinks = false,
  now,
  onReject,
  onDone,
}: {
  candidate: CandidateGroup;
  selected?: boolean;
  onToggleSelect?: () => void;
  /** true solo si los links directos están encendidos y su atribución confirmada. */
  directLinks?: boolean;
  /** Hora del render en el servidor, para que "Ingresó hace…" no difiera al hidratar. */
  now: number;
  /** Rechaza en la lista (que muestra "Deshacer"). Devuelve el error, o null. */
  onReject: (id: string) => Promise<string | null>;
  /** La tarjeta terminó: la lista la quita sin esperar a releer la página. */
  onDone: (id: string, result: CardDone) => void;
}) {
  const [open, setOpen] = useState(false);
  const [affiliateUrl, setAffiliateUrl] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [linkCheck, setLinkCheck] = useState<LinkCheck>({ status: 'idle' });
  const [pending, setPending] = useState<Pending>(null);
  const [, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  const discount = discountPct(candidate);
  const commission = candidateCommission(candidate);
  const ratePct = `${Math.round(commission.rate * 100)}%`;
  const arrived = formatTimeAgo(candidate.prospected_at, now);
  const top = candidate.highlight_position;
  const colors = candidate.siblings.length + 1;

  function handleRowClick(e: MouseEvent<HTMLDivElement>) {
    if ((e.target as HTMLElement).closest(INTERACTIVE)) return;
    onToggleSelect?.();
  }

  function handleVerifyLink() {
    setPending('verificando');
    setLinkCheck({ status: 'idle' });
    startTransition(async () => {
      try {
        const result = await checkAffiliateLink(affiliateUrl, candidate.ml_product_id);
        if (!result.ok) setLinkCheck({ status: 'error', message: result.error });
        else if (result.verdict === 'coincide') setLinkCheck({ status: 'ok' });
        else if (result.verdict === 'otra_ficha')
          setLinkCheck({ status: 'otro_producto', featuredProductId: result.featuredProductId });
        else setLinkCheck({ status: 'indeterminado' });
      } finally {
        setPending(null);
      }
    });
  }

  function handleApprove() {
    setError(null);
    // Sin links directos confirmados, el servidor no aprueba sin meli.la:
    // se abre el detalle con el campo listo en vez de ir y volver con un error.
    if (!directLinks && !affiliateUrl.trim()) {
      setOpen(true);
      setError('Pega el link meli.la de este producto para aprobarlo.');
      setTimeout(() => inputRef.current?.focus(), 0);
      return;
    }
    setPending('publicando');
    startTransition(async () => {
      try {
        const result = await approveCandidate(candidate.id, affiliateUrl);
        if (!result.ok) {
          setError(result.error);
          setOpen(true);
          return;
        }
        onDone(candidate.id, { kind: 'aprobado', name: candidate.name, outcome: result.outcome, reason: result.reason });
      } catch {
        setError('No se pudo aprobar. Revisa la conexión e intenta de nuevo.');
      } finally {
        setPending(null);
      }
    });
  }

  function handleReject() {
    setError(null);
    setPending('rechazando');
    startTransition(async () => {
      try {
        const failure = await onReject(candidate.id);
        if (failure) setError(failure);
        else onDone(candidate.id, { kind: 'rechazado', name: candidate.name });
      } finally {
        setPending(null);
      }
    });
  }

  const busy = pending !== null;

  return (
    <div
      onClick={handleRowClick}
      className={`cursor-pointer rounded-xl border p-3 transition ${
        selected ? 'border-accent bg-accent/5' : 'border-border bg-surface hover:border-accent/40'
      }`}
    >
      <div className="flex gap-3">
        <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-lg bg-white">
          <Image
            loader={mlImageLoader}
            src={candidate.image_url}
            alt={candidate.name}
            width={64}
            height={64}
            className="h-16 w-16 object-contain"
          />
          <input
            type="checkbox"
            checked={selected}
            onChange={() => onToggleSelect?.()}
            aria-label={`Seleccionar ${candidate.name}`}
            className="absolute left-1 top-1 h-4 w-4 accent-accent"
          />
        </div>

        <div className="min-w-0 flex-1">
          <h3 className="line-clamp-2 text-sm font-medium leading-snug text-fg">{candidate.name}</h3>
          <div className="mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className="text-sm font-semibold text-accent">{formatCLP(candidate.price)}</span>
            {discount > 0 && candidate.original_price && (
              <>
                <span className="rounded bg-accent/15 px-1.5 py-0.5 text-[11px] font-bold text-accent">
                  -{discount}%
                </span>
                <span className="text-xs text-muted">
                  antes <span className="line-through">{formatCLP(candidate.original_price)}</span>
                </span>
              </>
            )}
          </div>
          <p className="mt-0.5 text-xs text-muted">
            {commission.assumed
              ? `Comisión est. ~${formatCLP(commission.amount)} (${ratePct} asumido)`
              : `Comisión est. ${formatCLP(commission.amount)} (${ratePct})`}
          </p>
        </div>

        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-label={open ? 'Ocultar detalle' : 'Ver detalle'}
          className="-mr-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-muted transition hover:bg-surface2 hover:text-fg"
        >
          {open ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
        </button>
      </div>

      <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] font-medium">
        {typeof top === 'number' && top > 0 && top <= 20 && (
          <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-amber-400">Top {top} en ML</span>
        )}
        {candidate.is_full && <span className="rounded-full bg-accent/15 px-2 py-0.5 text-accent">Full</span>}
        {candidate.official_store && (
          <span className="rounded-full bg-blue/15 px-2 py-0.5 text-blue">Tienda oficial</span>
        )}
        {arrived && (
          <span className="rounded-full border border-border px-2 py-0.5 text-muted">Ingresó {arrived}</span>
        )}
      </div>

      {candidate.siblings.length > 0 && (
        <details className="mt-2 text-xs" data-no-select>
          <summary className="cursor-pointer py-1 text-muted hover:text-fg">Disponible en {colors} colores</summary>
          <ul className="mt-1 flex flex-col gap-1 border-l border-border pl-3 text-muted">
            <li>
              <span className="text-fg">{candidate.name}</span> · {formatCLP(candidate.price)} (el más barato, se
              publica este)
            </li>
            {candidate.siblings.map((s) => (
              <li key={s.id}>
                {s.name} · {formatCLP(s.price)}
              </li>
            ))}
          </ul>
        </details>
      )}

      {open && (
        <div className="mt-3 flex flex-col gap-2 border-t border-border pt-3" data-no-select>
          {/* La ficha de catálogo muestra la oferta ganadora, que es la del
              precio de arriba. Desde ahí hay que generar el link de afiliado. */}
          <a
            href={mlProductUrl(candidate.ml_product_id)}
            target="_blank"
            rel="noreferrer"
            className="inline-flex w-fit items-center gap-1 py-1 text-xs font-medium text-accent hover:underline"
          >
            Abrir la ficha en Mercado Libre <ExternalLink size={11} />
          </a>
          <p className="text-xs text-muted">
            {candidate.ml_product_id} · {candidate.seller_nickname ?? 'vendedor desconocido'} · reputación{' '}
            {candidate.seller_reputation} · {candidate.seller_sales_count.toLocaleString('es-CL')} ventas
          </p>

          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              ref={inputRef}
              type="url"
              inputMode="url"
              placeholder={directLinks ? 'Opcional: la atribución de los links directos está confirmada' : 'https://meli.la/…'}
              value={affiliateUrl}
              onChange={(e) => {
                setAffiliateUrl(e.target.value);
                setLinkCheck({ status: 'idle' });
                setError(null);
              }}
              className="min-h-11 min-w-0 flex-1 rounded-md border border-border bg-surface2 px-3 py-2 text-sm text-fg placeholder:text-muted focus:border-accent focus:outline-none"
            />
            <button
              type="button"
              onClick={handleVerifyLink}
              disabled={!affiliateUrl.trim() || busy}
              className="min-h-11 shrink-0 rounded-md border border-border px-3 py-2 text-xs font-medium text-muted transition hover:text-fg disabled:cursor-not-allowed disabled:opacity-40"
            >
              {pending === 'verificando' ? PENDING_LABEL.verificando : 'Verificar link'}
            </button>
          </div>
          {!directLinks && (
            <p className="text-[11px] text-muted">
              Genera el link meli.la desde la ficha con el Generador de links de ML. Los links directos no se usan
              hasta comprobar la atribución.
            </p>
          )}

          {linkCheck.status === 'ok' && (
            <p className="text-xs text-accent">✓ El link lleva a la ficha de este producto.</p>
          )}
          {linkCheck.status === 'otro_producto' && (
            <p className="text-xs text-red-400">
              ⚠ Este link lleva a otra ficha
              {linkCheck.featuredProductId ? ` (${linkCheck.featuredProductId})` : ''}. El comprador vería otro
              producto: genera el link desde la ficha de este.
            </p>
          )}
          {linkCheck.status === 'indeterminado' && (
            <p className="text-xs text-amber-400">
              No se pudo comprobar a qué ficha lleva: tu perfil de afiliado no está mostrando el producto. Puedes
              aprobar igual.
            </p>
          )}
          {linkCheck.status === 'error' && (
            <p className="text-xs text-amber-400">No se pudo verificar el link ({linkCheck.message}).</p>
          )}
        </div>
      )}

      {error && <p className="mt-2 text-xs text-red-400">{error}</p>}

      <div className="mt-3 flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={handleReject}
          disabled={busy}
          className="min-h-11 rounded-md border border-border px-4 py-2 text-sm text-muted transition hover:text-fg disabled:opacity-40"
        >
          {pending === 'rechazando' ? PENDING_LABEL.rechazando : 'Rechazar'}
        </button>
        <button
          type="button"
          onClick={handleApprove}
          disabled={busy}
          className="min-h-11 rounded-md bg-accent px-5 py-2 text-sm font-medium text-ink transition hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {pending === 'publicando' ? PENDING_LABEL.publicando : 'Aprobar'}
        </button>
      </div>
    </div>
  );
}
