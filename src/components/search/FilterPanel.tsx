'use client';

export function FilterPanel({
  defaultValues,
}: {
  defaultValues: { q?: string; brand?: string; maxPrice?: string; minDiscount?: string };
}) {
  return (
    <form className="grid gap-3 rounded-xl border border-border bg-surface p-4 sm:grid-cols-4" method="get">
      <input
        type="text"
        name="q"
        placeholder="Buscar producto..."
        defaultValue={defaultValues.q}
        className="rounded-lg border border-border bg-surface2 px-3 py-2 text-sm text-white placeholder:text-muted sm:col-span-2"
      />
      <input
        type="text"
        name="brand"
        placeholder="Marca"
        defaultValue={defaultValues.brand}
        className="rounded-lg border border-border bg-surface2 px-3 py-2 text-sm text-white placeholder:text-muted"
      />
      <input
        type="number"
        name="maxPrice"
        placeholder="Precio máximo (CLP)"
        defaultValue={defaultValues.maxPrice}
        className="rounded-lg border border-border bg-surface2 px-3 py-2 text-sm text-white placeholder:text-muted"
      />
      <select
        name="minDiscount"
        defaultValue={defaultValues.minDiscount ?? ''}
        className="rounded-lg border border-border bg-surface2 px-3 py-2 text-sm text-white sm:col-span-2"
      >
        <option value="">Cualquier descuento</option>
        <option value="10">10% o más</option>
        <option value="20">20% o más</option>
        <option value="30">30% o más</option>
      </select>
      <button
        type="submit"
        className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-bg transition hover:opacity-90 sm:col-span-2"
      >
        Filtrar
      </button>
    </form>
  );
}
