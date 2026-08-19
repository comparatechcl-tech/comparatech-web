'use client';

import { useState, useTransition } from 'react';
import Image from 'next/image';
import { ProductCandidate } from '@/lib/types';
import { formatCLP } from '@/lib/format';
import { approveCandidate, rejectCandidate } from './actions';

export function CandidateCard({ candidate }: { candidate: ProductCandidate }) {
  const [affiliateUrl, setAffiliateUrl] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleApprove() {
    setError(null);
    startTransition(async () => {
      try {
        await approveCandidate(candidate.id, candidate.name, affiliateUrl);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Error al aprobar');
      }
    });
  }

  function handleReject() {
    setError(null);
    startTransition(async () => {
      try {
        await rejectCandidate(candidate.id);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Error al rechazar');
      }
    });
  }

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-4 sm:flex-row">
      <div className="relative h-32 w-32 shrink-0 overflow-hidden rounded-lg bg-surface2">
        <Image src={candidate.image_url} alt={candidate.name} fill sizes="128px" className="object-cover" />
      </div>
      <div className="flex flex-1 flex-col gap-2">
        <div className="flex items-start justify-between gap-2">
          <h3 className="font-heading text-sm font-medium text-white">{candidate.name}</h3>
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
        <input
          type="url"
          placeholder="Pega acá el link de afiliado real"
          value={affiliateUrl}
          onChange={(e) => setAffiliateUrl(e.target.value)}
          className="mt-1 rounded-md border border-border bg-surface2 px-3 py-2 text-sm text-white placeholder:text-muted focus:border-accent focus:outline-none"
        />
        {error && <p className="text-xs text-red-400">{error}</p>}
        <div className="mt-1 flex gap-2">
          <button
            onClick={handleApprove}
            disabled={isPending || !affiliateUrl.trim()}
            className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-bg transition hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Aprobar
          </button>
          <button
            onClick={handleReject}
            disabled={isPending}
            className="rounded-md border border-border px-4 py-2 text-sm text-muted transition hover:text-white disabled:opacity-40"
          >
            Rechazar
          </button>
        </div>
      </div>
    </div>
  );
}
