'use client';

import { useMemo, useState } from 'react';
import Image from 'next/image';
import { CheckCircle2 } from 'lucide-react';
import { Product } from '@/lib/types';
import { formatCLP } from '@/lib/format';
import { AffiliateButton } from '@/components/product/AffiliateButton';

function parseNumeric(value: string | number): number | null {
  const n = typeof value === 'number' ? value : parseFloat(value);
  return Number.isFinite(n) ? n : null;
}

export function CompareClient({
  products,
  initialSlugA,
  initialSlugB,
}: {
  products: Product[];
  initialSlugA?: string;
  initialSlugB?: string;
}) {
  const exists = (slug?: string) => !!slug && products.some((p) => p.slug === slug);
  const [slugA, setSlugA] = useState(
    exists(initialSlugA) ? (initialSlugA as string) : products[0]?.slug ?? ''
  );
  const [slugB, setSlugB] = useState(
    exists(initialSlugB) ? (initialSlugB as string) : products[1]?.slug ?? products[0]?.slug ?? ''
  );

  const a = products.find((p) => p.slug === slugA);
  const b = products.find((p) => p.slug === slugB);

  const specKeys = useMemo(() => {
    if (!a || !b) return [];
    return Array.from(new Set([...Object.keys(a.specs), ...Object.keys(b.specs)]));
  }, [a, b]);

  return (
    <div>
      <div className="grid gap-3 sm:grid-cols-2">
        <select
          value={slugA}
          onChange={(e) => setSlugA(e.target.value)}
          className="rounded-xl border border-border bg-surface px-4 py-3 text-sm font-medium text-white transition focus:border-accent focus:outline-none"
        >
          {products.map((p) => (
            <option key={p.slug} value={p.slug}>
              {p.name}
            </option>
          ))}
        </select>
        <select
          value={slugB}
          onChange={(e) => setSlugB(e.target.value)}
          className="rounded-xl border border-border bg-surface px-4 py-3 text-sm font-medium text-white transition focus:border-accent focus:outline-none"
        >
          {products.map((p) => (
            <option key={p.slug} value={p.slug}>
              {p.name}
            </option>
          ))}
        </select>
      </div>

      {a && b && (
        <div className="mt-6 overflow-hidden rounded-2xl border border-border">
          <div className="grid grid-cols-2 divide-x divide-border">
            {[a, b].map((p) => (
              <div key={p.id} className="flex flex-col items-center gap-3 bg-surface p-5 text-center sm:p-6">
                <div className="relative h-20 w-20 overflow-hidden rounded-xl bg-surface2 sm:h-28 sm:w-28">
                  <Image src={p.image_url} alt={p.name} fill className="object-cover" />
                </div>
                <p className="line-clamp-2 font-heading text-sm font-medium text-white">{p.name}</p>
                <p
                  className={`font-heading text-lg font-bold sm:text-xl ${
                    p.price <= Math.min(a.price, b.price) ? 'text-accent' : 'text-white'
                  }`}
                >
                  {formatCLP(p.price)}
                </p>
                <AffiliateButton href={p.affiliate_url} className="w-full text-xs sm:text-sm" />
              </div>
            ))}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[420px] text-sm">
              <tbody>
                {specKeys.map((key, i) => {
                  const va = a.specs[key];
                  const vb = b.specs[key];
                  const na = va !== undefined ? parseNumeric(va) : null;
                  const nb = vb !== undefined ? parseNumeric(vb) : null;
                  const aWins = na !== null && nb !== null && na > nb;
                  const bWins = na !== null && nb !== null && nb > na;

                  return (
                    <tr key={key} className={i % 2 === 0 ? 'bg-surface2' : 'bg-surface'}>
                      <td
                        className={`px-4 py-2.5 text-center ${
                          aWins ? 'font-semibold text-accent' : 'text-white'
                        }`}
                      >
                        <span className="inline-flex items-center gap-1.5">
                          {aWins && <CheckCircle2 size={13} className="shrink-0" />}
                          {va ?? '—'}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-center text-xs text-muted">{key}</td>
                      <td
                        className={`px-4 py-2.5 text-center ${
                          bWins ? 'font-semibold text-accent' : 'text-white'
                        }`}
                      >
                        <span className="inline-flex items-center gap-1.5">
                          {vb ?? '—'}
                          {bWins && <CheckCircle2 size={13} className="shrink-0" />}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
      <p className="mt-3 text-xs text-muted">
        Destacamos en cyan el precio más bajo y las especificaciones numéricas
        más altas entre los dos productos — revisa igual cuál característica
        te importa más antes de decidir.
      </p>
    </div>
  );
}
