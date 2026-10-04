'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { saveAffiliateConfig } from '@/lib/actions/catalog-admin';

type Dialog = 'encender' | 'apagar' | null;

export function AffiliateSettingsForm({
  initial,
  locked,
  activeCount,
  mismatchCount,
  attributionConfirmed,
}: {
  initial: { word: string | null; tool: string | null; directLinks: boolean };
  /** Valores fijados en las variables de entorno: se muestran pero no se editan. */
  locked: { word: string | null; tool: string | null };
  /** Botones de compra del sitio (productos activos). Null si no se pudo contar. */
  activeCount: number | null;
  /** Activos cuyo meli.la lleva a otra ficha: salen del sitio si se apagan los directos. */
  mismatchCount: number | null;
  attributionConfirmed: boolean;
}) {
  const router = useRouter();
  const [word, setWord] = useState(locked.word ?? initial.word ?? '');
  const [tool, setTool] = useState(locked.tool ?? initial.tool ?? '');
  const [directLinks, setDirectLinks] = useState(initial.directLinks);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [isPending, startTransition] = useTransition();

  const dirty =
    word !== (locked.word ?? initial.word ?? '') ||
    tool !== (locked.tool ?? initial.tool ?? '') ||
    directLinks !== initial.directLinks;

  function save(confirm: boolean) {
    setDialog(null);
    setMessage(null);
    startTransition(async () => {
      const result = await saveAffiliateConfig({ word, tool, directLinks, confirm });
      if (!result.ok) {
        setMessage({ ok: false, text: result.error });
        return;
      }
      setMessage({
        ok: true,
        text: directLinks
          ? 'Guardado. El botón "Ver en Mercado Libre" ya lleva directo a la ficha.'
          : 'Guardado. El sitio sigue usando los links meli.la.',
      });
      router.refresh();
    });
  }

  // Cambiar el modo de links cambia el destino de todos los botones de
  // compra: se pide confirmación explícita antes de guardar.
  function handleSave() {
    if (directLinks && !initial.directLinks) setDialog('encender');
    else if (!directLinks && initial.directLinks) setDialog('apagar');
    else save(false);
  }

  const n = activeCount ?? '—';
  const m = mismatchCount ?? '—';

  return (
    <div className="mt-5 flex flex-col gap-4 border-t border-border pt-5">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-xs text-muted">
          matt_word
          <input
            value={word}
            onChange={(e) => setWord(e.target.value)}
            readOnly={Boolean(locked.word)}
            placeholder="Se completa solo desde tus links"
            className="rounded-md border border-border bg-surface2 px-3 py-2 text-sm text-fg placeholder:text-muted read-only:cursor-not-allowed read-only:opacity-70 focus:border-accent focus:outline-none"
          />
          {locked.word && <span>Fijado por la variable AFFILIATE_WORD</span>}
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted">
          matt_tool
          <input
            value={tool}
            onChange={(e) => setTool(e.target.value)}
            readOnly={Boolean(locked.tool)}
            inputMode="numeric"
            placeholder="Se completa solo desde tus links"
            className="rounded-md border border-border bg-surface2 px-3 py-2 text-sm text-fg placeholder:text-muted read-only:cursor-not-allowed read-only:opacity-70 focus:border-accent focus:outline-none"
          />
          {locked.tool && <span>Fijado por la variable AFFILIATE_TOOL</span>}
        </label>
      </div>

      <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border bg-surface2 p-3">
        <input
          type="checkbox"
          checked={directLinks}
          onChange={(e) => setDirectLinks(e.target.checked)}
          className="mt-0.5 h-4 w-4 shrink-0 accent-accent"
        />
        <span>
          <span className="block text-sm font-medium text-fg">Usar links directos a la ficha</span>
          <span className="mt-0.5 block text-xs text-muted">
            Encendido, el botón &quot;Ver en Mercado Libre&quot; evita el perfil intermedio. Apagado, se usan los links
            meli.la guardados.
          </span>
        </span>
      </label>

      <div className="flex items-center gap-3">
        <button
          onClick={handleSave}
          disabled={!dirty || isPending}
          className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-ink transition hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {isPending ? 'Guardando…' : 'Guardar'}
        </button>
        {message && (
          <p className={`text-xs ${message.ok ? 'text-accent' : 'text-red-400'}`}>{message.text}</p>
        )}
      </div>

      {dialog && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-links-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => setDialog(null)}
        >
          <div
            className="w-full max-w-md rounded-xl border border-border bg-surface p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="confirm-links-title" className="font-heading text-base font-semibold text-fg">
              {dialog === 'encender' ? 'Encender links directos' : 'Volver a los links meli.la'}
            </h3>
            <p className="mt-2 text-sm leading-relaxed text-muted">
              {dialog === 'encender'
                ? attributionConfirmed
                  ? `Vas a cambiar el destino de los ${n} botones de compra del sitio. ¿Confirmas?`
                  : `Vas a cambiar el destino de los ${n} botones de compra del sitio. Mientras la prueba de atribución no esté confirmada, Mercado Libre podría no pagar comisión por estos clics. ¿Confirmas?`
                : `Los botones volverán a los links meli.la guardados. ${m} productos activos tienen un meli.la que lleva a otra ficha y quedarán fuera del sitio hasta regenerar su link.`}
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={() => setDialog(null)}
                className="rounded-md border border-border px-4 py-2 text-sm font-medium text-fg transition hover:bg-surface2"
              >
                Cancelar
              </button>
              <button
                onClick={() => save(true)}
                autoFocus
                className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-ink transition hover:bg-accent/90"
              >
                Sí, cambiar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
