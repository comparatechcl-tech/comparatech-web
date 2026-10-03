'use client';

import { useState, useTransition } from 'react';
import Image from 'next/image';
import { ExternalLink } from 'lucide-react';
import { ProductCandidate } from '@/lib/types';
import { formatCLP } from '@/lib/format';
import { mlProductUrl } from '@/lib/ml-urls';
import { checkAffiliateLink } from '@/lib/actions/catalog-admin';
import { approveCandidate, rejectCandidate } from './actions';

type LinkCheck =
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'ok' }
  | { status: 'otro_producto'; featuredProductId: string | null }
  | { status: 'indeterminado' }
  | { status: 'error'; message: string };

export function CandidateCard({
  candidate,
  selected = false,
  onToggleSelect,
  directLinks = false,
}: {
  candidate: ProductCandidate;
  selected?: boolean;
  onToggleSelect?: () => void;
  /** Con links directos activos, aprobar no requiere pegar un link. */
  directLinks?: boolean;
}) {
  const [affiliateUrl, setAffiliateUrl] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [linkCheck, setLinkCheck] = useState<LinkCheck>({ status: 'idle' });
  const [isPending, startTransition] = useTransition();

  function handleVerifyLink() {
    setLinkCheck({ status: 'checking' });
    startTransition(async () => {
      const result = await checkAffiliateLink(affiliateUrl, candidate.ml_product_id);
      if (!result.ok) setLinkCheck({ status: 'error', message: result.error });
      else if (result.verdict === 'coincide') setLinkCheck({ status: 'ok' });
      else if (result.verdict === 'otra_ficha')
        setLinkCheck({ status: 'otro_producto', featuredProductId: result.featuredProductId });
      else setLinkCheck({ status: 'indeterminado' });
    });
  }

  function handleApprove() {
    setError(null);
    startTransition(async () => {
      const result = await approveCandidate(candidate.id, affiliateUrl);
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

  const canApprove = !isPending && (affiliateUrl.trim().length > 0 || directLinks);

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
      <div className="relative h-32 w-32 shrink-0 overflow-hidden rounded-lg bg-white">
        <Image src={candidate.image_url} alt={candidate.name} fill sizes="128px" className="object-contain" />
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

        {/* La ficha de catálogo muestra la oferta ganadora, que es la del
            precio de arriba. Desde ahí hay que generar el link de afiliado. */}
        <a
          href={mlProductUrl(candidate.ml_product_id)}
          target="_blank"
          rel="noreferrer"
          className="inline-flex w-fit items-center gap-1 text-xs font-medium text-accent hover:underline"
        >
          Abrir la ficha en Mercado Libre <ExternalLink size={11} />
        </a>

        {/* En un teléfono, input y botón lado a lado dejaban el campo del
            link con menos de la mitad del ancho. Se apilan hasta sm. */}
        <div className="mt-1 flex flex-col gap-2 sm:flex-row">
          <input
            type="url"
            placeholder={
              directLinks
                ? 'Opcional: los links directos están activos'
                : 'Pega acá el link de afiliado'
            }
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
          <p className="text-xs text-amber-400">
            No se pudo verificar el link ({linkCheck.message}). Puedes aprobar igual; se revisa al publicar.
          </p>
        )}
        {error && <p className="text-xs text-red-400">{error}</p>}

        <div className="mt-1 flex gap-2">
          <button
            onClick={handleApprove}
            disabled={!canApprove}
            className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-ink transition hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {isPending ? 'Publicando…' : 'Aprobar'}
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
