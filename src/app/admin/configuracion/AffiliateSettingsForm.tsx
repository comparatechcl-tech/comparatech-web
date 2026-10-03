'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { saveAffiliateConfig } from '@/lib/actions/catalog-admin';

export function AffiliateSettingsForm({
  initial,
}: {
  initial: { word: string | null; tool: string | null; directLinks: boolean };
}) {
  const router = useRouter();
  const [word, setWord] = useState(initial.word ?? '');
  const [tool, setTool] = useState(initial.tool ?? '');
  const [directLinks, setDirectLinks] = useState(initial.directLinks);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [isPending, startTransition] = useTransition();

  const dirty =
    word !== (initial.word ?? '') || tool !== (initial.tool ?? '') || directLinks !== initial.directLinks;

  function handleSave() {
    setMessage(null);
    startTransition(async () => {
      const result = await saveAffiliateConfig({ word, tool, directLinks });
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

  return (
    <div className="mt-5 flex flex-col gap-4 border-t border-border pt-5">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-xs text-muted">
          matt_word
          <input
            value={word}
            onChange={(e) => setWord(e.target.value)}
            placeholder="Se completa solo desde tus links"
            className="rounded-md border border-border bg-surface2 px-3 py-2 text-sm text-fg placeholder:text-muted focus:border-accent focus:outline-none"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted">
          matt_tool
          <input
            value={tool}
            onChange={(e) => setTool(e.target.value)}
            inputMode="numeric"
            placeholder="Se completa solo desde tus links"
            className="rounded-md border border-border bg-surface2 px-3 py-2 text-sm text-fg placeholder:text-muted focus:border-accent focus:outline-none"
          />
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
            Encendido, el botón &quot;Ver en Mercado Libre&quot; evita el perfil intermedio, y aprobar un candidato ya no
            requiere pegar un link. Apagado, se usan los links meli.la guardados.
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
    </div>
  );
}
