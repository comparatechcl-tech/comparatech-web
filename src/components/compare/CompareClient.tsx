'use client';

import { useMemo, useState } from 'react';
import Image from 'next/image';
import { Product } from '@/lib/types';
import { formatCLP } from '@/lib/format';
import { AffiliateButton } from '@/components/product/AffiliateButton';

function parseNumeric(value: string | number): number | null {
  const n = typeof value === 'number' ? value : parseFloat(value);
  return Number.isFinite(n) ? n : null;
}

export function CompareClient({ products }: { products: Product[] }) {
  const [slugA, setSlugA] = useState(products[0]?.slug ?? '');
  const [slugB, setSlugB] = useState(products[1]?.slug ?? products[0]?.slug ?? '');

  const a = products.find((p) => p.slug === slugA);
  const b = products.find((p) => p.slug === slugB);

  const specKeys = useMemo(() => {
    if (!a || !b) return [];
    return Array.from(new Set([...Object.keys(a.specs), ...Object.keys(b.specs)]));
  }, [a, b]);

  return (
    <div>
      <div className="grid gap-4 sm:grid-cols-2">
        <select
          value={slugA}
          onChange={(e) => setSlugA(e.target.value)}
          className="rounded-lg border border-border bg-surface px-3 py-2 text-sm text-white"
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
          className="rounded-lg border border-border bg-surface px-3 py-2 text-sm text-white"
        >
          {products.map((p) => (
            <option key={p.slug} value={p.slug}>
              {p.name}
            </option>
          ))}
        </select>
      </div>

      {a && b && (
        <div className="mt-6 overflow-hidden rounded-xl border border-border">
          <div className="grid grid-cols-2 divide-x divide-border">
            {[a, b].map((p) => (
              <div key={p.id} className="flex flex-col items-center gap-2 bg-surface p-4 text-center">
                <div className="relative h-24 w-24">
                  <Image src={p.image_url} alt={p.name} fill className="object-cover rounded" />
                </div>
                <p className="font-heading text-sm font-medium text-white">{p.name}</p>
                <p
                  className={`font-heading text-lg font-bold ${
                    p.price <= Math.min(a.price, b.price) ? 'text-accent' : 'text-white'
                  }`}
                >
                  {formatCLP(p.price)}
                </p>
              </div>
            ))}
          </div>

          <table className="w-full text-sm">
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
                      className={`px-4 py-2 text-center ${
                        aWins ? 'font-semibold text-accent' : 'text-white'
                      }`}
                    >
                      {va ?? '—'}
                    </td>
                    <td className="px-3 py-2 text-center text-xs text-muted">{key}</td>
                    <td
                      className={`px-4 py-2 text-center ${
                        bWins ? 'font-semibold text-accent' : 'text-white'
                      }`}
                    >
                      {vb ?? '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <div className="flex justify-around gap-4 bg-surface p-4">
            <AffiliateButton href={a.affiliate_url} />
            <AffiliateButton href={b.affiliate_url} />
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
