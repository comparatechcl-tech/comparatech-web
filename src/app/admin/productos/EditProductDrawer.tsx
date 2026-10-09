'use client';

import { useEffect, useState, useTransition } from 'react';
import { X } from 'lucide-react';
import { CATEGORIES } from '@/lib/categories';
import { updateProduct, type ProductEdit } from './actions';
import type { AdminProduct } from './ProductAdminCard';

const MAX_NOTE_LENGTH = 500;

/**
 * Panel "Editar" de un producto: categoría, fijar en portada y una nota
 * interna. Lo demás (nombre, precio, foto) viene de Mercado Libre y el
 * cron lo pisaría, así que no se ofrece editarlo.
 */
export function EditProductDrawer({
  product,
  open,
  onClose,
  onSaved,
}: {
  product: AdminProduct;
  open: boolean;
  onClose: () => void;
  onSaved: (patch: Required<ProductEdit>) => void;
}) {
  const [category, setCategory] = useState(product.category);
  const [featured, setFeatured] = useState(product.is_featured);
  const [note, setNote] = useState(product.admin_note ?? '');
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // Al abrir de nuevo se parte de lo guardado, no de lo que quedó a medio
  // escribir la vez anterior.
  useEffect(() => {
    if (!open) return;
    setCategory(product.category);
    setFeatured(product.is_featured);
    setNote(product.admin_note ?? '');
    setError(null);
  }, [open, product.category, product.is_featured, product.admin_note]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isPending) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, isPending, onClose]);

  if (!open) return null;

  // Una categoría fuera del registro (dato antiguo) se muestra igual para no
  // cambiarla sin querer al guardar otra cosa.
  const options = CATEGORIES.some((c) => c.slug === product.category)
    ? CATEGORIES
    : [{ slug: product.category, name: `${product.category} (fuera del registro)` }, ...CATEGORIES];

  function handleSave() {
    setError(null);
    const edit: ProductEdit = {};
    if (category !== product.category) edit.category = category;
    if (featured !== product.is_featured) edit.is_featured = featured;
    if (note.trim() !== (product.admin_note ?? '').trim()) edit.admin_note = note;
    if (Object.keys(edit).length === 0) {
      onClose();
      return;
    }
    startTransition(async () => {
      try {
        const result = await updateProduct(product.id, edit);
        if (!result.ok) {
          setError(result.error);
          return;
        }
        onSaved({ category, is_featured: featured, admin_note: note.trim() || null });
        onClose();
      } catch {
        setError('No se pudo guardar. Revisa tu conexión.');
      }
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/50"
      role="dialog"
      aria-modal="true"
      aria-label={`Editar ${product.name}`}
      onClick={() => !isPending && onClose()}
    >
      <div
        className="flex h-full w-full max-w-md flex-col gap-5 overflow-y-auto border-l border-border bg-surface p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase tracking-wide text-muted">Editar producto</p>
            <h2 className="mt-1 font-heading text-sm font-medium text-fg">{product.name}</h2>
          </div>
          <button
            onClick={onClose}
            disabled={isPending}
            aria-label="Cerrar"
            className="rounded-md p-1 text-muted transition hover:text-fg disabled:opacity-50"
          >
            <X size={18} />
          </button>
        </div>

        <label className="flex flex-col gap-1.5 text-xs text-muted">
          Categoría
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="rounded-md border border-border bg-surface2 px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none"
          >
            {options.map((c) => (
              <option key={c.slug} value={c.slug}>
                {c.name}
              </option>
            ))}
          </select>
        </label>

        <label className="flex items-start gap-2 text-sm text-fg">
          <input
            type="checkbox"
            checked={featured}
            onChange={(e) => setFeatured(e.target.checked)}
            className="mt-0.5 h-4 w-4 accent-accent"
          />
          <span>
            Fijar en portada
            <span className="block text-xs text-muted">Se muestra con la etiqueta &quot;Destacado&quot;.</span>
          </span>
        </label>

        <label className="flex flex-col gap-1.5 text-xs text-muted">
          Nota interna
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value.slice(0, MAX_NOTE_LENGTH))}
            rows={4}
            placeholder="Solo se ve en el admin. Ej.: esperar Cyber para publicarlo."
            className="rounded-md border border-border bg-surface2 px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none"
          />
          <span className="self-end text-[11px]">
            {note.length}/{MAX_NOTE_LENGTH}
          </span>
        </label>

        {error && <p className="text-xs text-red-400">{error}</p>}

        <div className="mt-auto flex gap-2">
          <button
            onClick={onClose}
            disabled={isPending}
            className="flex-1 rounded-md border border-border px-3 py-2 text-xs font-medium text-muted transition hover:text-fg disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            onClick={handleSave}
            disabled={isPending}
            className="flex-1 rounded-md bg-accent px-3 py-2 text-xs font-medium text-ink transition hover:bg-accent/90 disabled:opacity-50"
          >
            {isPending ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      </div>
    </div>
  );
}
