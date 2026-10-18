'use client';

import { useState, useTransition } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { Check, ClipboardPaste, Copy, ExternalLink } from 'lucide-react';
import { formatCLP } from '@/lib/format';
import { mlProductUrl } from '@/lib/ml-urls';
import mlImageLoader from '@/lib/ml-image-loader';
import { REASON_LABELS, type InactiveReason } from '@/lib/inactive-reasons';
import type { CatalogSuggestion, ProductPreview, ReviewItem } from '@/lib/manual-add';
import { addFromMl, reviewMlLinks, type AddFromMlResult } from './actions';

type Done = Extract<AddFromMlResult, { ok: true }>;

type CardState =
  | { status: 'idle' }
  | { status: 'busy'; label: string }
  | { status: 'done'; result: Done }
  | { status: 'error'; message: string };

const BUTTON =
  'inline-flex min-h-11 items-center justify-center gap-1.5 rounded-md px-4 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50';

/** Qué pasó al publicar, en una línea. */
function doneText(result: Done): string {
  if (result.outcome === 'en_cola') {
    return result.notPublished
      ? `Quedó en Candidatos, pero no se publicó: ${result.notPublished}`
      : 'Quedó en Candidatos, listo para aprobar.';
  }
  if (result.outcome === 'publicado') return 'Publicado en el sitio.';
  const reason = REASON_LABELS[result.reason as InactiveReason]?.title;
  return `Publicado, pero en pausa${reason ? `: ${reason.toLowerCase()}` : ''}. Vuelve solo cuando se arregle.`;
}

function CopyLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs text-muted">Link de afiliado</span>
      <div className="flex gap-2">
        <input
          readOnly
          value={url}
          onFocus={(e) => e.currentTarget.select()}
          aria-label="Link de afiliado"
          className="min-h-11 min-w-0 flex-1 rounded-md border border-border bg-surface2 px-3 text-xs text-fg"
        />
        <button type="button" onClick={copy} className={`${BUTTON} shrink-0 border border-border text-fg hover:border-accent`}>
          {copied ? <Check size={16} /> : <Copy size={16} />}
          {copied ? 'Copiado' : 'Copiar'}
        </button>
      </div>
    </div>
  );
}

function ProductCard({ item }: { item: ProductPreview }) {
  const [state, setState] = useState<CardState>({ status: 'idle' });
  const [, startTransition] = useTransition();

  function add(publish: boolean) {
    setState({ status: 'busy', label: publish ? 'Publicando…' : 'Agregando…' });
    startTransition(async () => {
      try {
        const result = await addFromMl(item.id, publish);
        setState(result.ok ? { status: 'done', result } : { status: 'error', message: result.error });
      } catch {
        setState({ status: 'error', message: 'No se pudo guardar. Revisa la conexión e intenta de nuevo.' });
      }
    });
  }

  const busy = state.status === 'busy';
  const done = state.status === 'done' ? state.result : null;
  const canAdd = (item.state === 'listo' || item.state === 'en_cola') && !done;

  return (
    <div className="rounded-xl border border-border bg-surface p-3">
      <div className="flex gap-3">
        <div className="h-16 w-16 shrink-0 overflow-hidden rounded-lg bg-white">
          {item.imageUrl && (
            <Image
              loader={mlImageLoader}
              src={item.imageUrl}
              alt={item.name}
              width={64}
              height={64}
              className="h-16 w-16 object-contain"
            />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="line-clamp-2 text-sm font-medium leading-snug text-fg">{item.name}</h3>
          {item.price !== null && (
            <div className="mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <span className="text-sm font-semibold text-accent">{formatCLP(item.price)}</span>
              {item.discountPct > 0 && item.originalPrice && (
                <>
                  <span className="rounded bg-accent/15 px-1.5 py-0.5 text-[11px] font-bold text-accent">
                    {item.discountPct}% de descuento
                  </span>
                  <span className="text-xs text-muted">
                    sin descuento <span className="line-through">{formatCLP(item.originalPrice)}</span>
                  </span>
                </>
              )}
            </div>
          )}
          <p className="mt-0.5 text-xs text-muted">
            {[
              item.categoryName,
              item.sellerNickname,
              item.commission !== null
                ? `Comisión est. ${item.commissionAssumed ? '~' : ''}${formatCLP(item.commission)}`
                : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
        </div>
      </div>

      {item.state === 'en_sitio' && (
        <p className="mt-2 text-sm text-fg">
          Ya está en el sitio.{' '}
          {item.siteSlug && (
            <Link href={`/producto/${item.siteSlug}`} target="_blank" className="font-medium text-accent underline">
              Ver en ComparaTech
            </Link>
          )}
        </p>
      )}
      {item.state === 'en_cola' && !done && (
        <p className="mt-2 text-sm text-fg">
          Ya está en la cola de{' '}
          <Link href="/admin/candidatos" className="font-medium text-accent underline">
            Candidatos
          </Link>
          .
        </p>
      )}
      {item.reason && <p className="mt-2 text-sm text-red-400">{item.reason}</p>}
      {item.warnings.length > 0 && (
        <ul className="mt-2 flex flex-col gap-1 text-xs text-amber-400">
          {item.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}

      {item.affiliateUrl && item.state !== 'no_se_puede' && (
        <div className="mt-3">
          <CopyLink url={item.affiliateUrl} />
        </div>
      )}

      {done && (
        <p className="mt-3 text-sm font-medium text-accent">
          ✓ {doneText(done)}{' '}
          {done.slug && (
            <Link href={`/producto/${done.slug}`} target="_blank" className="underline">
              Ver en el sitio
            </Link>
          )}
        </p>
      )}
      {state.status === 'error' && <p className="mt-3 text-sm text-red-400">{state.message}</p>}

      <div className="mt-3 flex flex-wrap gap-2">
        {canAdd && item.state === 'listo' && (
          <button
            type="button"
            disabled={busy}
            onClick={() => add(false)}
            className={`${BUTTON} border border-border text-fg hover:border-accent`}
          >
            {busy && state.label === 'Agregando…' ? state.label : 'Agregar a la cola'}
          </button>
        )}
        {canAdd && (
          <button
            type="button"
            disabled={busy || !item.affiliateUrl}
            onClick={() => add(true)}
            className={`${BUTTON} bg-accent text-ink hover:bg-accent/90`}
          >
            {busy && state.label === 'Publicando…' ? state.label : 'Publicar ahora'}
          </button>
        )}
        <a
          href={mlProductUrl(item.id)}
          target="_blank"
          rel="noopener noreferrer"
          className={`${BUTTON} text-muted hover:text-fg`}
        >
          Ver en Mercado Libre <ExternalLink size={14} />
        </a>
      </div>
    </div>
  );
}

/**
 * Una cosa pegada: la ficha revisada, o el aviso de por qué no se pudo
 * revisar (con las fichas parecidas, si es una publicación suelta).
 */
export function ReviewItemCard({
  item,
  onPick,
  busy,
}: {
  item: ReviewItem;
  /** Revisar una de las fichas sugeridas. */
  onPick: (id: string) => void;
  busy: boolean;
}) {
  if (item.kind === 'ficha') return <ProductCard item={item} />;
  return (
    <div className="rounded-xl border border-border bg-surface p-3">
      <p className="break-all text-xs text-muted">{item.raw}</p>
      <p className="mt-1 text-sm text-fg">{item.message}</p>
      {item.kind === 'publicacion' && item.suggestions.length > 0 && (
        <Suggestions suggestions={item.suggestions} busy={busy} onPick={onPick} />
      )}
    </div>
  );
}

function Suggestions({
  suggestions,
  onPick,
  busy,
}: {
  suggestions: CatalogSuggestion[];
  onPick: (id: string) => void;
  busy: boolean;
}) {
  return (
    <ul className="mt-2 flex flex-col gap-2">
      {suggestions.map((s) => (
        <li key={s.id} className="flex items-center gap-3 rounded-lg border border-border p-2">
          <div className="h-12 w-12 shrink-0 overflow-hidden rounded bg-white">
            {s.imageUrl && (
              <Image
                loader={mlImageLoader}
                src={s.imageUrl}
                alt={s.name}
                width={48}
                height={48}
                className="h-12 w-12 object-contain"
              />
            )}
          </div>
          <span className="line-clamp-2 min-w-0 flex-1 text-xs text-fg">{s.name}</span>
          <button
            type="button"
            disabled={busy}
            onClick={() => onPick(s.id)}
            className={`${BUTTON} shrink-0 border border-border text-fg hover:border-accent`}
          >
            Revisar esta
          </button>
        </li>
      ))}
    </ul>
  );
}

/**
 * Pegar uno o varios links de Mercado Libre, ver cómo quedaría cada producto
 * y agregarlo a la cola o publicarlo. Pensado para el teléfono: el dueño ve
 * algo en la app de ML, copia el link y lo trae acá.
 */
export function AddFromMl() {
  const [text, setText] = useState('');
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [omitted, setOmitted] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [reviewing, startReview] = useTransition();

  /** Revisa lo pegado; con `index`, reemplaza esa tarjeta (una ficha elegida de las sugeridas). */
  function review(input: string, index?: number) {
    setError(null);
    startReview(async () => {
      try {
        const result = await reviewMlLinks(input);
        if (!result.ok) {
          setError(result.error);
          return;
        }
        if (index === undefined) {
          setItems(result.items);
          setOmitted(result.omitted);
        } else {
          setItems((current) => [...current.slice(0, index), ...result.items, ...current.slice(index + 1)]);
        }
      } catch {
        setError('No se pudo revisar. Revisa la conexión e intenta de nuevo.');
      }
    });
  }

  async function pasteAndReview() {
    try {
      const pasted = await navigator.clipboard.readText();
      if (pasted.trim()) {
        setText(pasted);
        review(pasted);
      }
    } catch {
      setError('El teléfono no dejó leer lo copiado: pégalo en el cuadro.');
    }
  }

  return (
    <div className="mt-6 flex flex-col gap-4">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim()) review(text);
        }}
        className="flex flex-col gap-2"
      >
        <label htmlFor="ml-links" className="text-sm font-medium text-fg">
          Links o códigos de Mercado Libre
        </label>
        <textarea
          id="ml-links"
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={3}
          placeholder="https://www.mercadolibre.cl/…/p/MLC…"
          className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-fg placeholder:text-muted"
        />
        <p className="text-xs text-muted">
          Sirve el link de la ficha del producto (tiene /p/MLC…) o su código. Puedes pegar varios a la vez, hasta 10.
        </p>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={pasteAndReview} disabled={reviewing} className={`${BUTTON} border border-border text-fg hover:border-accent`}>
            <ClipboardPaste size={16} /> Pegar y revisar
          </button>
          <button type="submit" disabled={reviewing || !text.trim()} className={`${BUTTON} bg-accent text-ink hover:bg-accent/90`}>
            {reviewing ? 'Revisando…' : 'Revisar'}
          </button>
        </div>
      </form>

      {error && <p className="text-sm text-red-400">{error}</p>}
      {omitted > 0 && (
        <p className="text-xs text-amber-400">
          Revisé los primeros 10. Pega los otros {omitted} en otra tanda.
        </p>
      )}

      <div className="flex flex-col gap-3">
        {items.map((item, index) => (
          <ReviewItemCard
            key={`${'id' in item ? item.id : item.raw}-${index}`}
            item={item}
            busy={reviewing}
            onPick={(id) => review(id, index)}
          />
        ))}
      </div>
    </div>
  );
}
