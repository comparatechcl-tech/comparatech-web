'use client';

import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { buyUrl } from '@/lib/outbound';
import { buildCaption } from '@/lib/content/captions';
import { ProductAdminCard, type AdminProduct } from './ProductAdminCard';

export function ProductsList({ products, siteUrl }: { products: AdminProduct[]; siteUrl: string }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected((prev) => (prev.size === products.length ? new Set() : new Set(products.map((p) => p.id))));
  }

  // Cada producto con su texto completo (aviso de publicidad y hora del
  // precio incluidos) y el mismo link de compra que usa el sitio. Antes se
  // copiaba el affiliate_url pelado, sin aviso.
  async function handleCopySelected() {
    const now = new Date();
    const chosen = products.filter((p) => selected.has(p.id));
    const text = chosen
      .map((p) => buildCaption(p, 'whatsapp', { now, siteUrl, link: buyUrl(p) }))
      .join('\n\n— — —\n\n');
    try {
      await navigator.clipboard.writeText(text);
      setCopyError(false);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopyError(true);
    }
  }

  if (products.length === 0) {
    return <p className="text-sm text-muted">No hay productos que coincidan con este filtro.</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between rounded-lg border border-border bg-surface2 px-4 py-2.5">
        <label className="flex items-center gap-2 text-xs text-muted">
          <input
            type="checkbox"
            checked={selected.size > 0 && selected.size === products.length}
            onChange={toggleAll}
            className="h-4 w-4 accent-accent"
          />
          {selected.size > 0 ? `${selected.size} seleccionado${selected.size === 1 ? '' : 's'}` : 'Seleccionar todos'}
        </label>
        <button
          onClick={handleCopySelected}
          disabled={selected.size === 0}
          className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-muted transition hover:text-fg disabled:cursor-not-allowed disabled:opacity-40"
        >
          {copied ? <Check size={13} className="text-accent" /> : <Copy size={13} />}
          {copied ? 'Copiado' : copyError ? 'No se pudo copiar' : 'Copiar seleccionados'}
        </button>
      </div>

      {products.map((p) => (
        <ProductAdminCard
          key={p.id}
          product={p}
          siteUrl={siteUrl}
          selected={selected.has(p.id)}
          onToggleSelect={() => toggle(p.id)}
        />
      ))}
    </div>
  );
}
