'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Check, Copy, ExternalLink } from 'lucide-react';
import { republishBatch } from '@/lib/actions/catalog-admin';
import { approveBatch } from './candidatos/actions';
import { MAX_BATCH, type BatchItemResult, type BatchResult } from '@/lib/batch-result';
import { reasonInfo } from '@/lib/inactive-reasons';

/**
 * Carga de links de afiliado en bloque.
 *
 * Mercado Libre no permite generar links desde el servidor, pero su
 * generador acepta varias URLs a la vez. Este panel entrega esas URLs listas
 * para pegar y recibe de vuelta lo que el generador devuelva, copiado como
 * venga: cada link se asigna solo a su producto (ver lib/link-batch).
 */

const LINK_BUILDER_URL = 'https://www.mercadolibre.cl/afiliados/linkbuilder#hub';

export interface BulkItem {
  id: string;
  name: string;
  mlProductId: string;
}

export function BulkLinkPanel({
  items,
  mode,
  directLinks = false,
  onDone,
}: {
  /** En el orden en que se copian las URLs. */
  items: BulkItem[];
  mode: 'republicar' | 'aprobar';
  /** Con links directos, aprobar no requiere generar links. */
  directLinks?: boolean;
  /** Ids que quedaron guardados, para sacarlos de la lista. */
  onDone?: (ids: string[]) => void;
}) {
  const router = useRouter();
  const [pasted, setPasted] = useState('');
  const [copied, setCopied] = useState(false);
  const [result, setResult] = useState<BatchResult | null>(null);
  const [isPending, startTransition] = useTransition();

  const count = items.length;
  const plural = count === 1 ? '' : 's';
  const tooMany = count > MAX_BATCH;
  const skipLinks = mode === 'aprobar' && directLinks;

  function copyUrls() {
    navigator.clipboard.writeText(items.map((i) => `https://www.mercadolibre.cl/p/${i.mlProductId}`).join('\n'));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  function submit() {
    setResult(null);
    const ids = items.map((i) => i.id);
    const text = skipLinks ? '' : pasted;
    startTransition(async () => {
      const res = mode === 'aprobar' ? await approveBatch(ids, text) : await republishBatch(ids, text);
      setResult(res);
      if (!res.ok) return;
      const saved = res.items.filter((i) => i.outcome !== 'sin_link' && i.outcome !== 'error').map((i) => i.id);
      if (saved.length > 0) {
        setPasted('');
        onDone?.(saved);
        router.refresh();
      }
    });
  }

  return (
    <div className="rounded-xl border border-accent/30 bg-accent/5 p-4">
      <p className="text-sm font-semibold text-fg">
        {mode === 'aprobar' ? `Aprobar ${count} seleccionado${plural} en bloque` : `Republicar ${count} en bloque`}
      </p>

      {tooMany ? (
        <p className="mt-1 text-xs text-amber-400">
          Son {count}: el máximo por tanda es {MAX_BATCH}. Deja seleccionados {MAX_BATCH} o menos.
        </p>
      ) : skipLinks ? (
        <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-muted">Los links directos están encendidos: no hace falta generar links.</p>
          <button
            onClick={submit}
            disabled={isPending}
            className="shrink-0 rounded-md bg-accent px-4 py-2 text-sm font-medium text-ink transition hover:bg-accent/90 disabled:opacity-50"
          >
            {isPending ? 'Aprobando…' : `Aprobar ${count}`}
          </button>
        </div>
      ) : (
        <ol className="mt-3 flex flex-col gap-4 text-xs text-muted">
          <li>
            <span className="font-semibold text-fg">1.</span> Copia las URLs y pégalas en el generador de links de
            Mercado Libre.
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                onClick={copyUrls}
                className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-1.5 font-medium text-fg transition hover:border-accent/50"
              >
                {copied ? <Check size={13} className="text-accent" /> : <Copy size={13} />}
                {copied ? 'Copiadas' : `Copiar ${count} URL${plural}`}
              </button>
              <a
                href={LINK_BUILDER_URL}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-1.5 font-medium text-fg transition hover:border-accent/50"
              >
                Abrir el generador <ExternalLink size={12} />
              </a>
            </div>
          </li>
          <li>
            <span className="font-semibold text-fg">2.</span> Toca &quot;Generar&quot;, copia los links que aparecen y
            pégalos acá. Da lo mismo el formato o el orden.
            <textarea
              value={pasted}
              onChange={(e) => {
                setPasted(e.target.value);
                setResult(null);
              }}
              rows={4}
              placeholder="https://meli.la/…"
              className="mt-2 w-full rounded-md border border-border bg-surface2 px-3 py-2 text-sm text-fg placeholder:text-muted focus:border-accent focus:outline-none"
            />
          </li>
          <li className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <span>
              <span className="font-semibold text-fg">3.</span> Se verifica cada link y queda publicado.
            </span>
            <button
              onClick={submit}
              disabled={!pasted.trim() || isPending}
              className="shrink-0 rounded-md bg-accent px-4 py-2 text-sm font-medium text-ink transition hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-40 sm:ml-auto"
            >
              {isPending
                ? 'Verificando links…'
                : `${mode === 'aprobar' ? 'Aprobar' : 'Publicar'} ${count} con estos links`}
            </button>
          </li>
        </ol>
      )}

      {result && <BatchReport result={result} mode={mode} />}
    </div>
  );
}

function describe(item: BatchItemResult, mode: 'republicar' | 'aprobar'): string {
  const done = mode === 'aprobar' ? 'aprobado y publicado' : 'publicado';
  switch (item.outcome) {
    case 'activo':
      return item.verified
        ? done
        : `${done}, pero no se pudo comprobar el link: confírmalo con "Abrir como comprador"`;
    case 'sin_ganador':
    case 'ganador_no_verde':
    case 'link_otro_producto':
      return `guardado, pero ${reasonInfo(item.outcome).title.toLowerCase()}: se publica solo cuando corresponda`;
    case 'pendiente':
    case 'error_transitorio':
      return 'guardado: Mercado Libre no respondió y se publica en la próxima revisión';
    case 'sin_link':
      return 'ninguno de los links pegados era de este producto';
    case 'error':
      return `no se pudo guardar${item.detail ? ` (${item.detail})` : ''}`;
  }
}

function BatchReport({ result, mode }: { result: BatchResult; mode: 'republicar' | 'aprobar' }) {
  if (!result.ok) return <p className="mt-3 text-xs text-red-400">{result.error}</p>;

  return (
    <div className="mt-4 flex flex-col gap-1.5 border-t border-border pt-3 text-xs">
      {result.items.map((item) => {
        const good = item.outcome === 'activo' && item.verified;
        const bad = item.outcome === 'sin_link' || item.outcome === 'error';
        return (
          <p key={item.id} className={good ? 'text-accent' : bad ? 'text-red-400' : 'text-amber-400'}>
            {good ? '✓' : bad ? '✗' : '•'} <span className="text-fg">{item.name}</span>: {describe(item, mode)}
          </p>
        );
      })}
      {result.wrongLinks.map((w) => (
        <p key={w.url} className="text-red-400">
          ✗ {w.url} lleva a otra ficha ({w.featuredProductId}), que no es de esta lista: genéralo desde la ficha
          correcta.
        </p>
      ))}
      {result.unmatchedLinks.length > 0 && (
        <p className="text-amber-400">
          • {result.unmatchedLinks.length} link{result.unmatchedLinks.length === 1 ? '' : 's'} no se
          {result.unmatchedLinks.length === 1 ? ' pudo' : ' pudieron'} asignar a ningún producto (repetido o
          ilegible): {result.unmatchedLinks.join(', ')}
        </p>
      )}
    </div>
  );
}
