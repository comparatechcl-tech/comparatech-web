'use client';

import { useState, useTransition } from 'react';
import Image from 'next/image';
import { Copy, Check } from 'lucide-react';
import { Product, RrssStatus } from '@/lib/types';
import { formatCLP } from '@/lib/format';
import { setRrssStatus } from './actions';

const RRSS_OPTIONS: { value: RrssStatus; label: string }[] = [
  { value: 'sin_usar', label: 'Sin usar' },
  { value: 'seleccionado', label: 'Seleccionado' },
  { value: 'publicado', label: 'Publicado' },
];

export function ProductAdminCard({ product }: { product: Product }) {
  const [status, setStatus] = useState<RrssStatus>(product.rrss_status ?? 'sin_usar');
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

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
    <div className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-4 sm:flex-row sm:items-center">
      <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-lg bg-surface2">
        <Image src={product.image_url} alt={product.name} fill sizes="80px" className="object-cover" />
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <h3 className="font-heading text-sm font-medium text-white">{product.name}</h3>
          <span className="whitespace-nowrap text-sm font-semibold text-accent">
            {formatCLP(product.price)}
          </span>
        </div>
        <p className="mt-1 text-xs text-muted">
          {product.category} · {new Date(product.created_at).toLocaleDateString('es-CL')}
          {!product.is_active && <span className="ml-2 text-red-400">Inactivo</span>}
        </p>
      </div>

      <div className="flex shrink-0 flex-col items-stretch gap-2 sm:w-56">
        <div className="flex gap-1 rounded-lg border border-border bg-surface2 p-1">
          {RRSS_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => handleStatusChange(opt.value)}
              disabled={isPending}
              className={`flex-1 rounded-md px-2 py-1.5 text-[11px] font-medium transition disabled:opacity-50 ${
                status === opt.value ? 'bg-accent text-bg' : 'text-muted hover:text-white'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <button
          onClick={handleCopy}
          className="flex items-center justify-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs text-muted transition hover:text-white"
        >
          {copied ? <Check size={13} className="text-accent" /> : <Copy size={13} />}
          {copied ? 'Copiado' : 'Copiar para RRSS'}
        </button>
        {error && <p className="text-[11px] text-red-400">{error}</p>}
      </div>
    </div>
  );
}
