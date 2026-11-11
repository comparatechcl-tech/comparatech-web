'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { ChevronRight, ClipboardPaste, Loader2 } from 'lucide-react';
import { formatCLP } from '@/lib/format';
import type { NoticeDeal } from '@/lib/social/deal-notice';
import type { DealResult } from '@/lib/social/deal-notice-review';
import { ProductCard } from '@/app/admin/candidatos/agregar/AddFromMl';
import { StoryList } from '../StoryList';
import { reviewNotice, reviewNoticeDeal } from './actions';

/**
 * El aviso pegado y lo que salió de cada producto: las historias listas
 * (con la misma lista de /admin/historias: revisión en vivo, Compartir y
 * "Ya la publiqué"), los que faltan en el sitio (con el botón de Agregar) y
 * los que se saltan, con el porqué.
 */

const BUTTON =
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-md px-4 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50';

interface Review {
  results: DealResult[];
  omitted: number;
  coupons: string[];
  renderedAt: number;
}

/** "Del aviso: nombre · $precio · cupón X". */
function dealLine(deal: NoticeDeal): string {
  const parts = [deal.name];
  if (deal.price) parts.push(formatCLP(deal.price));
  if (deal.coupon) parts.push(`cupón ${deal.coupon}`);
  return parts.join(' · ');
}

/** Por qué se salta, en una frase. */
function skipText(result: DealResult): string {
  if (result.kind === 'fuera') return 'No es de tecnología: el sitio no publica este tipo de producto.';
  if (result.kind === 'no_a_la_venta') return 'Está en el sitio, pero oculto o en pausa. Si quieres subirlo, revísalo en Productos.';
  if (result.kind === 'sin_ficha') return result.message;
  return '';
}

export function NoticeView({ maxPriceAgeMs }: { maxPriceAgeMs: number }) {
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [review, setReview] = useState<Review | null>(null);
  const [pending, startTransition] = useTransition();

  function check() {
    setError(null);
    startTransition(async () => {
      try {
        const res = await reviewNotice(text);
        if (res.ok) setReview({ results: res.results, omitted: res.omitted, coupons: res.coupons, renderedAt: res.renderedAt });
        else setError(res.error);
      } catch {
        setError('No se pudo revisar. Revisa la conexión e intenta de nuevo.');
      }
    });
  }

  async function paste() {
    try {
      setText(await navigator.clipboard.readText());
    } catch {
      setError('El teléfono no dejó pegar con el botón: mantén apretado el cuadro y toca Pegar.');
    }
  }

  /** Recién publicado en el sitio: se revisa de nuevo para traer su historia. */
  function afterPublish(index: number, deal: NoticeDeal, mlId: string) {
    startTransition(async () => {
      try {
        const res = await reviewNoticeDeal({ ...deal, mlId });
        if (!res.ok || res.result.kind !== 'historia') return;
        const result = res.result;
        setReview((r) =>
          r ? { ...r, results: r.results.map((x, i) => (i === index ? result : x)), renderedAt: res.renderedAt } : r
        );
      } catch {
        // La tarjeta ya dice que se publicó: la historia aparece al tocar Revisar aviso de nuevo.
      }
    });
  }

  const results = review?.results ?? [];
  const stories = results.flatMap((r) => (r.kind === 'historia' ? [r.item] : []));
  const toAdd = results.map((r, i) => ({ r, i })).filter((x) => x.r.kind === 'agregar');
  const skipped = results.filter((r) => r.kind !== 'historia' && r.kind !== 'agregar');

  return (
    <div className="mt-6 flex flex-col gap-6">
      <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4">
        <label htmlFor="aviso" className="text-sm font-medium text-fg">
          Aviso del canal
        </label>
        <textarea
          id="aviso"
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={8}
          placeholder="Pega aquí el aviso de recomendaciones, con sus links"
          className="w-full rounded-md border border-border bg-surface2 px-3 py-2 text-sm text-fg"
        />
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={paste} className={`${BUTTON} border border-border text-fg hover:border-accent`}>
            <ClipboardPaste size={16} aria-hidden /> Pegar
          </button>
          <button
            type="button"
            onClick={check}
            disabled={pending || text.trim().length === 0}
            className={`${BUTTON} bg-accent text-ink hover:bg-accent/90`}
          >
            {pending && <Loader2 size={16} className="animate-spin" aria-hidden />}
            {pending ? 'Buscando…' : 'Revisar aviso'}
          </button>
        </div>
        {pending && (
          <p className="text-sm text-muted">Busco cada producto en Mercado Libre. Toma entre 10 y 30 segundos.</p>
        )}
      </div>

      {error && (
        <div role="alert" className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}

      {review && (
        <p role="status" className="rounded-xl border border-border bg-surface px-4 py-3 text-sm text-fg">
          {results.length === 0
            ? 'El aviso no trae productos, solo cupones.'
            : `Encontré ${results.length} ${results.length === 1 ? 'producto' : 'productos'}: ${stories.length} con historia lista, ${toAdd.length} por agregar y ${skipped.length} que se ${skipped.length === 1 ? 'salta' : 'saltan'}.`}
          {review.omitted > 0 && ` Quedaron ${review.omitted} fuera: pega el resto en otra tanda.`}
        </p>
      )}

      {review && review.coupons.length > 0 && (
        <Link
          href="/admin/historias/cupones"
          className="flex min-h-11 items-center justify-between gap-3 rounded-xl border border-accent/40 bg-accent/5 px-4 py-3 text-sm text-fg transition hover:border-accent"
        >
          <span>
            El aviso trae {review.coupons.length === 1 ? 'el cupón' : 'los cupones'} <strong>{review.coupons.join(', ')}</strong>.
            Los cupones se publican en <strong>Cupones del canal</strong>.
          </span>
          <ChevronRight size={18} className="shrink-0 text-accent" aria-hidden />
        </Link>
      )}

      {stories.length > 0 && review && (
        <section>
          <h2 className="font-heading text-lg font-semibold text-fg">Historias listas</h2>
          <StoryList key={review.renderedAt} items={stories} posted={[]} maxPriceAgeMs={maxPriceAgeMs} renderedAt={review.renderedAt} />
        </section>
      )}

      {toAdd.length > 0 && (
        <section>
          <h2 className="font-heading text-lg font-semibold text-fg">Faltan en el sitio</h2>
          <p className="mt-1 text-sm text-muted">
            Toca <strong className="text-fg">Publicar ahora</strong> y su historia aparece arriba. Si dice en rojo que no se
            puede, se salta.
          </p>
          <ul className="mt-3 flex flex-col gap-4">
            {toAdd.map(({ r, i }) =>
              r.kind === 'agregar' ? (
                <li key={`${i}-${r.preview.id}`}>
                  <p className="mb-1 text-xs text-muted">Del aviso: {dealLine(r.deal)}</p>
                  <ProductCard
                    item={r.preview}
                    onDone={(done) => {
                      if (done.outcome === 'publicado') afterPublish(i, r.deal, r.preview.id);
                    }}
                  />
                </li>
              ) : null
            )}
          </ul>
        </section>
      )}

      {skipped.length > 0 && (
        <section>
          <h2 className="font-heading text-lg font-semibold text-fg">Se saltan</h2>
          <ul className="mt-3 flex flex-col gap-2">
            {skipped.map((r, i) => (
              <li key={i} className="rounded-xl border border-border bg-surface px-4 py-3 text-sm">
                <p className="font-medium text-fg">{r.deal.name}</p>
                <p className="mt-0.5 text-muted">{skipText(r)}</p>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
