'use client';

import { useState, useTransition } from 'react';
import Image from 'next/image';
import { Copy, Check, ExternalLink } from 'lucide-react';
import { Product, RrssStatus } from '@/lib/types';
import { formatCLP } from '@/lib/format';
import { setRrssStatus, updateAffiliateUrl, verifyAffiliateLink } from './actions';

const RRSS_OPTIONS: { value: RrssStatus; label: string }[] = [
  { value: 'sin_usar', label: 'Sin usar' },
  { value: 'seleccionado', label: 'Seleccionado' },
  { value: 'publicado', label: 'Publicado' },
];

type LinkCheck =
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'direct' }
  | { status: 'wrong_offer' }
  | { status: 'unknown' }
  | { status: 'error'; message: string };

export function ProductAdminCard({
  product,
  selected = false,
  onToggleSelect,
}: {
  product: Product;
  selected?: boolean;
  onToggleSelect?: () => void;
}) {
  const [status, setStatus] = useState<RrssStatus>(product.rrss_status ?? 'sin_usar');
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [affiliateUrl, setAffiliateUrl] = useState(product.affiliate_url);
  const [linkCheck, setLinkCheck] = useState<LinkCheck>({ status: 'idle' });
  const [saved, setSaved] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleVerifyLink() {
    setLinkCheck({ status: 'checking' });
    startTransition(async () => {
      const result = await verifyAffiliateLink(affiliateUrl, product.ml_product_id, product.seller_id);
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

  function handleSaveLink() {
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const result = await updateAffiliateUrl(product.id, affiliateUrl);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    });
  }

  function handleStatusChange(next: RrssStatus) {
    const previous = status;
    setStatus(next);
    setError(null);
    startTransition(async () => {
      const result = await setRrssStatus(product.id, next);
      if (!result.ok) {
        setStatus(previous);
        setError(result.error);
      }
    });
  }

  function handleCopy() {
    const text = `${product.name} — ${formatCLP(product.price)}\n${product.affiliate_url}`;
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        {onToggleSelect && (
          <input
            type="checkbox"
            checked={selected}
            onChange={onToggleSelect}
            className="h-4 w-4 shrink-0 accent-accent sm:self-center"
            aria-label={`Seleccionar ${product.name}`}
          />
        )}
        <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-lg bg-surface2">
          <Image src={product.image_url} alt={product.name} fill sizes="80px" className="object-cover" />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <h3 className="font-heading text-sm font-medium text-fg">{product.name}</h3>
            <span className="whitespace-nowrap text-sm font-semibold text-accent">
              {formatCLP(product.price)}
            </span>
          </div>
          <p className="mt-1 text-xs text-muted">
            {product.category} · {new Date(product.created_at).toLocaleDateString('es-CL')}
            {!product.is_active && <span className="ml-2 text-red-400">Inactivo</span>}
          </p>
          <a
            href={product.affiliate_url}
            target="_blank"
            rel="noreferrer"
            className="mt-1 inline-flex items-center gap-1 text-xs text-accent hover:underline"
          >
            Ver en Mercado Libre <ExternalLink size={11} />
          </a>
        </div>

        <div className="flex shrink-0 flex-col items-stretch gap-2 sm:w-56">
          <div className="flex gap-1 rounded-lg border border-border bg-surface2 p-1">
            {RRSS_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => handleStatusChange(opt.value)}
                disabled={isPending}
                className={`flex-1 rounded-md px-2 py-1.5 text-[11px] font-medium transition disabled:opacity-50 ${
                  status === opt.value ? 'bg-accent text-ink' : 'text-muted hover:text-fg'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <button
            onClick={handleCopy}
            className="flex items-center justify-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs text-muted transition hover:text-fg"
          >
            {copied ? <Check size={13} className="text-accent" /> : <Copy size={13} />}
            {copied ? 'Copiado' : 'Copiar para RRSS'}
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-1.5 border-t border-border pt-3">
        <div className="flex gap-2">
          <input
            type="url"
            value={affiliateUrl}
            onChange={(e) => {
              setAffiliateUrl(e.target.value);
              setLinkCheck({ status: 'idle' });
            }}
            className="flex-1 rounded-md border border-border bg-surface2 px-3 py-2 text-xs text-fg focus:border-accent focus:outline-none"
          />
          <button
            onClick={handleVerifyLink}
            disabled={!affiliateUrl.trim() || linkCheck.status === 'checking'}
            className="shrink-0 rounded-md border border-border px-3 py-2 text-xs font-medium text-muted transition hover:text-fg disabled:cursor-not-allowed disabled:opacity-40"
          >
            {linkCheck.status === 'checking' ? 'Verificando…' : 'Verificar'}
          </button>
          <button
            onClick={handleSaveLink}
            disabled={!affiliateUrl.trim() || affiliateUrl === product.affiliate_url || isPending}
            className="shrink-0 rounded-md bg-accent px-3 py-2 text-xs font-medium text-ink transition hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {saved ? 'Guardado ✓' : 'Guardar'}
          </button>
        </div>
        {linkCheck.status === 'direct' && (
          <p className="text-xs text-accent">✓ El link lleva a la oferta exacta que tenemos publicada.</p>
        )}
        {linkCheck.status === 'wrong_offer' && (
          <p className="text-xs text-red-400">
            ⚠ Este link destaca la oferta de otro vendedor — puede mostrar un precio distinto al publicado (
            {formatCLP(product.price)}). Genera el link de nuevo desde esa oferta específica.
          </p>
        )}
        {linkCheck.status === 'unknown' && (
          <p className="text-xs text-amber-400">No se pudo identificar qué oferta destaca este link.</p>
        )}
        {linkCheck.status === 'error' && (
          <p className="text-xs text-amber-400">No se pudo verificar ({linkCheck.message}).</p>
        )}
        {error && <p className="text-xs text-red-400">{error}</p>}
      </div>
    </div>
  );
}
