'use client';

import { Search, SlidersHorizontal } from 'lucide-react';

export function FilterPanel({
  defaultValues,
}: {
  defaultValues: { q?: string; brand?: string; maxPrice?: string; minDiscount?: string };
}) {
  return (
    <form
      className="grid gap-3 rounded-2xl border border-border bg-surface p-5 sm:grid-cols-4"
      method="get"
    >
      <div className="relative sm:col-span-2">
        <Search size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" />
        <input
          type="text"
          name="q"
          placeholder="Buscar producto..."
          defaultValue={defaultValues.q}
          className="w-full rounded-xl border border-border bg-surface2 py-2.5 pl-9 pr-3 text-sm text-fg placeholder:text-muted transition focus:border-accent focus:outline-none"
        />
      </div>
      <input
        type="text"
        name="brand"
        placeholder="Marca"
        defaultValue={defaultValues.brand}
        className="rounded-xl border border-border bg-surface2 px-3 py-2.5 text-sm text-fg placeholder:text-muted transition focus:border-accent focus:outline-none"
      />
      <input
        type="number"
        name="maxPrice"
        placeholder="Precio máximo (CLP)"
        defaultValue={defaultValues.maxPrice}
        className="rounded-xl border border-border bg-surface2 px-3 py-2.5 text-sm text-fg placeholder:text-muted transition focus:border-accent focus:outline-none"
      />
      <select
        name="minDiscount"
        defaultValue={defaultValues.minDiscount ?? ''}
        className="rounded-xl border border-border bg-surface2 px-3 py-2.5 text-sm text-fg transition focus:border-accent focus:outline-none sm:col-span-2"
      >
        <option value="">Cualquier descuento</option>
        <option value="10">10% o más</option>
        <option value="20">20% o más</option>
        <option value="30">30% o más</option>
      </select>
      <button
        type="submit"
        className="inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-blue to-accent px-4 py-2.5 text-sm font-heading font-semibold text-ink transition hover:opacity-90 sm:col-span-2"
      >
        <SlidersHorizontal size={15} />
        Filtrar
      </button>
    </form>
  );
}
