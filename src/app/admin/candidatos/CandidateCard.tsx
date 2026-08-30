'use client';

import { useState, useTransition } from 'react';
import Image from 'next/image';
import { ProductCandidate } from '@/lib/types';
import { formatCLP } from '@/lib/format';
import { approveCandidate, rejectCandidate, verifyAffiliateLink } from './actions';

type LinkCheck =
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'direct' }
  | { status: 'wrong_offer' }
  | { status: 'unknown' }
  | { status: 'error'; message: string };

export function CandidateCard({
  candidate,
  selected = false,
  onToggleSelect,
}: {
  candidate: ProductCandidate;
  selected?: boolean;
  onToggleSelect?: () => void;
}) {
  const [affiliateUrl, setAffiliateUrl] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [linkCheck, setLinkCheck] = useState<LinkCheck>({ status: 'idle' });
  const [isPending, startTransition] = useTransition();

  function handleVerifyLink() {
    setLinkCheck({ status: 'checking' });
    startTransition(async () => {
      const result = await verifyAffiliateLink(affiliateUrl, candidate.ml_product_id, candidate.seller_id);
      if (!result.ok) {
        setLinkCheck({ status: 'error', message: result.error });
        return;
      }
      if (result.direct) {
        setLinkCheck({ status: 'direct' });
      } else {
        setLinkCheck({ status: result.reason === 'wrong_offer' ? 'wrong_offer' : 'unknown' });
      }
    });
  }

  function handleApprove() {
    setError(null);
    startTransition(async () => {
      const result = await approveCandidate(candidate.id, candidate.name, affiliateUrl);
      if (!result.ok) setError(result.error);
    });
  }

  function handleReject() {
    setError(null);
    startTransition(async () => {
      const result = await rejectCandidate(candidate.id);
      if (!result.ok) setError(result.error);
    });
  }

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-4 sm:flex-row">
      {onToggleSelect && (
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggleSelect}
          className="mt-1 h-4 w-4 shrink-0 accent-accent"
          aria-label={`Seleccionar ${candidate.name}`}
        />
      )}
      <div className="relative h-32 w-32 shrink-0 overflow-hidden rounded-lg bg-surface2">
        <Image src={candidate.image_url} alt={candidate.name} fill sizes="128px" className="object-cover" />
      </div>
      <div className="flex flex-1 flex-col gap-2">
        <div className="flex items-start justify-between gap-2">
          <h3 className="font-heading text-sm font-medium text-fg">{candidate.name}</h3>
          <span className="whitespace-nowrap text-sm font-semibold text-accent">
            {formatCLP(candidate.price)}
          </span>
        </div>
        <p className="text-xs text-muted">
          {candidate.category} · {candidate.seller_nickname ?? 'vendedor desconocido'} · reputación{' '}
          {candidate.seller_reputation} · {candidate.seller_sales_count.toLocaleString('es-CL')} ventas
        </p>
        <a
          href={`https://listado.mercadolibre.cl/${encodeURIComponent(candidate.name)}`}
          target="_blank"
          rel="noreferrer"
          className="text-xs text-accent hover:underline"
        >
          Buscar en Mercado Libre ↗
        </a>
        {/* En un teléfono, input y botón lado a lado dejaban el campo del
            link con menos de la mitad del ancho. Se apilan hasta sm. */}
        <div className="mt-1 flex flex-col gap-2 sm:flex-row">
          <input
            type="url"
            placeholder="Pega acá el link de afiliado real"
            value={affiliateUrl}
            onChange={(e) => {
              setAffiliateUrl(e.target.value);
              setLinkCheck({ status: 'idle' });
            }}
            className="flex-1 rounded-md border border-border bg-surface2 px-3 py-2 text-sm text-fg placeholder:text-muted focus:border-accent focus:outline-none"
          />
          <button
            onClick={handleVerifyLink}
            disabled={!affiliateUrl.trim() || linkCheck.status === 'checking'}
            className="shrink-0 rounded-md border border-border px-3 py-2 text-xs font-medium text-muted transition hover:text-fg disabled:cursor-not-allowed disabled:opacity-40"
          >
            {linkCheck.status === 'checking' ? 'Verificando…' : 'Verificar link'}
          </button>
        </div>
        {linkCheck.status === 'direct' && (
          <p className="text-xs text-accent">✓ El link lleva a la oferta exacta del vendedor aprobado.</p>
        )}
        {linkCheck.status === 'wrong_offer' && (
          <p className="text-xs text-red-400">
            ⚠ Este link destaca la oferta de otro vendedor, no la de {candidate.seller_nickname ?? 'este vendedor'} —
            puede mostrar un precio distinto al aprobado. Genera el link de nuevo desde la oferta específica de ese
            vendedor.
          </p>
        )}
        {linkCheck.status === 'unknown' && (
          <p className="text-xs text-amber-400">No se pudo identificar qué oferta destaca este link. Revísalo a mano antes de aprobar.</p>
        )}
        {linkCheck.status === 'error' && (
          <p className="text-xs text-amber-400">No se pudo verificar el link ({linkCheck.message}). Revísalo a mano antes de aprobar.</p>
        )}
        {error && <p className="text-xs text-red-400">{error}</p>}
        <div className="mt-1 flex gap-2">
          <button
            onClick={handleApprove}
            disabled={isPending || !affiliateUrl.trim()}
            className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-ink transition hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Aprobar
          </button>
          <button
            onClick={handleReject}
            disabled={isPending}
            className="rounded-md border border-border px-4 py-2 text-sm text-muted transition hover:text-fg disabled:opacity-40"
          >
            Rechazar
          </button>
        </div>
      </div>
    </div>
  );
}
