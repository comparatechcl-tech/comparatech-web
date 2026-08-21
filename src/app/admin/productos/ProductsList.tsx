'use client';

import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { Product } from '@/lib/types';
import { formatCLP } from '@/lib/format';
import { ProductAdminCard } from './ProductAdminCard';

export function ProductsList({ products }: { products: Product[] }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [copied, setCopied] = useState(false);

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

  function handleCopySelected() {
    const chosen = products.filter((p) => selected.has(p.id));
    const text = chosen.map((p) => `${p.name} — ${formatCLP(p.price)}\n${p.affiliate_url}`).join('\n\n');
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
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
          {copied ? 'Copiado' : 'Copiar seleccionados'}
        </button>
      </div>

      {products.map((p) => (
        <ProductAdminCard key={p.id} product={p} selected={selected.has(p.id)} onToggleSelect={() => toggle(p.id)} />
      ))}
    </div>
  );
}
