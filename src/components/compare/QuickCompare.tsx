'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ArrowLeftRight } from 'lucide-react';
import { Product } from '@/lib/types';

export function QuickCompare({ products }: { products: Product[] }) {
  const router = useRouter();
  const [slugA, setSlugA] = useState(products[0]?.slug ?? '');
  const [slugB, setSlugB] = useState(products[1]?.slug ?? products[0]?.slug ?? '');

  return (
    <div className="rounded-3xl border border-border bg-surface p-6 sm:p-8">
      <h2 className="font-heading text-2xl font-bold">Comparador rápido</h2>
      <p className="mt-1.5 text-muted">
        Elige dos productos y compara sus especificaciones y precios al instante.
      </p>

      <div className="mt-6 flex flex-col items-stretch gap-3 sm:flex-row sm:items-center">
        <select
          value={slugA}
          onChange={(e) => setSlugA(e.target.value)}
          className="w-full min-w-0 flex-1 truncate rounded-xl border border-border bg-surface2 px-4 py-3 text-sm font-medium text-white transition focus:border-accent focus:outline-none"
        >
          {products.map((p) => (
            <option key={p.slug} value={p.slug}>
              {p.name}
            </option>
          ))}
        </select>

        <span className="flex h-10 w-10 shrink-0 items-center justify-center self-center rounded-full border border-border bg-surface2 text-accent">
          <ArrowLeftRight size={16} />
        </span>

        <select
          value={slugB}
          onChange={(e) => setSlugB(e.target.value)}
          className="w-full min-w-0 flex-1 truncate rounded-xl border border-border bg-surface2 px-4 py-3 text-sm font-medium text-white transition focus:border-accent focus:outline-none"
        >
          {products.map((p) => (
            <option key={p.slug} value={p.slug}>
              {p.name}
            </option>
          ))}
        </select>
      </div>

      <button
        onClick={() => router.push(`/comparador?a=${slugA}&b=${slugB}`)}
        disabled={!slugA || !slugB}
        className="mt-5 w-full rounded-xl bg-gradient-to-r from-blue to-accent py-3.5 text-center font-heading text-sm font-semibold text-bg transition hover:opacity-90 disabled:opacity-40 sm:w-auto sm:px-8"
      >
        Comparar productos →
      </button>
    </div>
  );
}
