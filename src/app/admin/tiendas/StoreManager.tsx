'use client';

import { useState, useTransition, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { Check, ExternalLink, Loader2, Search } from 'lucide-react';
import { formatCLP, formatDayMonth } from '@/lib/format';
import type { SearchHit, StoreVariant } from '@/lib/store-reader';
import {
  linkStoreOffer,
  rereadOffer,
  reviewStoreLink,
  searchInStore,
  setOfferPaused,
  setStoresVisible,
  unlinkOffer,
  type FichaPreview,
} from './actions';

/**
 * Lo que se toca en "Otras tiendas": el interruptor para mostrarlas en el
 * sitio y una tarjeta por producto, con sus tiendas ya enlazadas y el
 * formulario para agregar otra (buscar en la tienda o pegar el link).
 *
 * Se usa desde el teléfono: botones altos, un paso a la vez, y nada se guarda
 * sin ver antes qué dice la tienda.
 */

export interface OfferItem {
  id: number;
  store: string;
  storeName: string;
  /** La ficha en la tienda, para abrirla y mirar. */
  href: string;
  title: string | null;
  seller: string | null;
  price: number | null;
  checkedAt: string | null;
  status: 'activo' | 'sin_stock' | 'error' | 'pausado';
  lastError: string | null;
  /** Si el precio de esa tienda se lee de la ficha (se puede volver a leer). */
  readable: boolean;
}

export interface ProductItem {
  id: string;
  name: string;
  slug: string;
  image: string;
  /** El precio guardado de Mercado Libre y su fecha, de referencia. */
  mlPrice: number;
  mlDate: string | null;
  clicks: number;
  offers: OfferItem[];
  /** Con qué buscar el producto en la tienda (se puede corregir). */
  query: string;
}

export interface SearchableStore {
  key: string;
  name: string;
}

const BUTTON =
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-md px-4 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50';
const PRIMARY = `${BUTTON} bg-accent text-ink hover:bg-accent/90`;
const SECONDARY = `${BUTTON} border border-border text-fg hover:border-accent`;
const INPUT =
  'min-h-11 w-full rounded-md border border-border bg-surface2 px-3 text-base text-fg placeholder:text-muted focus:border-accent focus:outline-none';

const TEST_NOTE = 'Modo prueba: en el sitio publicado esto habría quedado guardado. Acá no se guardó nada.';

// ---------------------------------------------------------------------------
// Mostrar o no en el sitio

export function VisibilitySwitch({ show, shown }: { show: boolean; shown: number }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [note, setNote] = useState<string | null>(null);

  function toggle() {
    setNote(null);
    startTransition(async () => {
      const result = await setStoresVisible(!show);
      if (!result.ok) setNote(result.error);
      else if (result.test) setNote(TEST_NOTE);
      else router.refresh();
    });
  }

  return (
    <section className="mt-5 rounded-xl border border-border bg-surface p-4">
      <h2 className="font-heading text-base font-semibold text-fg">
        En el sitio: {show ? <span className="text-accent">se muestran</span> : <span className="text-amber-400">no se muestran</span>}
      </h2>
      <p className="mt-1 text-sm text-muted">
        {show
          ? `Las fichas de los productos enlazados muestran el bloque "Precio en otras tiendas" (${shown} ${shown === 1 ? 'precio' : 'precios'} a la vista).`
          : 'Puedes enlazar tiendas con calma: mientras esto esté apagado, nada de esta página se ve en el sitio.'}
      </p>
      <button type="button" onClick={toggle} disabled={pending} className={`mt-3 ${show ? SECONDARY : PRIMARY}`}>
        {pending && <Loader2 size={16} className="animate-spin" aria-hidden />}
        {show ? 'Dejar de mostrarlas en el sitio' : 'Mostrarlas en el sitio'}
      </button>
      {note && (
        <p role="status" className="mt-2 text-sm text-amber-400">
          {note}
        </p>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Una tienda ya enlazada

const STATUS_NOTE: Record<OfferItem['status'], string | null> = {
  activo: null,
  sin_stock: 'La tienda dice que no tiene stock: no se muestra hasta que vuelva.',
  error: 'No se pudo leer varias veces seguidas: no se muestra. Se prueba de nuevo una vez al día.',
  pausado: 'En pausa: no se muestra ni se lee.',
};

function OfferRow({ offer }: { offer: OfferItem }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [note, setNote] = useState<{ text: string; bad: boolean } | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);

  function run(action: () => Promise<{ ok: true; test: boolean; message?: string } | { ok: false; error: string }>, done: string) {
    setNote(null);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        setNote({ text: result.error, bad: true });
        return;
      }
      const text = result.message ?? done;
      setNote({ text: result.test ? `${text} ${TEST_NOTE}` : text, bad: false });
      if (!result.test) router.refresh();
    });
  }

  const statusNote = STATUS_NOTE[offer.status];
  return (
    <li className="rounded-lg border border-border bg-surface2 p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className="font-heading font-semibold text-fg">{offer.storeName}</p>
        <p className="text-sm text-fg">
          {offer.price !== null ? <strong>{formatCLP(offer.price)}</strong> : 'Sin precio'}
          {offer.checkedAt && <span className="text-muted"> · revisado el {formatDayMonth(offer.checkedAt)}</span>}
        </p>
      </div>
      {offer.title && <p className="mt-1 text-xs text-muted">La tienda lo llama: {offer.title}</p>}
      {offer.seller && offer.seller.toLowerCase() !== offer.storeName.toLowerCase() && (
        <p className="mt-0.5 text-xs text-muted">Lo vende: {offer.seller}</p>
      )}
      {statusNote && <p className="mt-1 text-xs text-amber-400">{statusNote}</p>}
      {offer.status !== 'activo' && offer.status !== 'pausado' && offer.lastError && (
        <p className="mt-0.5 break-words text-xs text-muted">Último intento: {offer.lastError}</p>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        <a href={offer.href} target="_blank" rel="nofollow noopener" className={SECONDARY}>
          <ExternalLink size={16} aria-hidden />
          Abrir en {offer.storeName}
        </a>
        {offer.readable && offer.status !== 'pausado' && (
          <button type="button" disabled={pending} onClick={() => run(() => rereadOffer(offer.id), 'Leído.')} className={SECONDARY}>
            Leer de nuevo
          </button>
        )}
        <button
          type="button"
          disabled={pending}
          onClick={() => run(() => setOfferPaused(offer.id, offer.status !== 'pausado'), offer.status === 'pausado' ? 'Reanudada.' : 'En pausa.')}
          className={SECONDARY}
        >
          {offer.status === 'pausado' ? 'Reanudar' : 'Pausar'}
        </button>
        {confirmRemove ? (
          <button
            type="button"
            disabled={pending}
            onClick={() => run(() => unlinkOffer(offer.id), 'Quitada.')}
            className={`${BUTTON} border border-red-500/60 text-red-400 hover:border-red-400`}
          >
            Sí, quitar
          </button>
        ) : (
          <button type="button" disabled={pending} onClick={() => setConfirmRemove(true)} className={SECONDARY}>
            Quitar
          </button>
        )}
        {pending && <Loader2 size={18} className="animate-spin self-center text-muted" aria-hidden />}
      </div>
      {note && (
        <p role="status" className={`mt-2 text-sm ${note.bad ? 'text-red-400' : 'text-accent'}`}>
          {note.text}
        </p>
      )}
    </li>
  );
}

// ---------------------------------------------------------------------------
// Agregar una tienda a un producto

type Step =
  | { kind: 'idle' }
  | { kind: 'busy'; text: string }
  | { kind: 'hits'; storeName: string; hits: SearchHit[] }
  | { kind: 'variants'; storeName: string; url: string; variants: StoreVariant[] }
  | { kind: 'preview'; preview: FichaPreview; raw: string; sku: string | null }
  | { kind: 'done'; text: string }
  | { kind: 'error'; text: string };

function AddStore({ item, stores }: { item: ProductItem; stores: SearchableStore[] }) {
  const router = useRouter();
  const [query, setQuery] = useState(item.query);
  const [link, setLink] = useState('');
  const [step, setStep] = useState<Step>({ kind: 'idle' });
  const busy = step.kind === 'busy';

  async function search(store: SearchableStore) {
    setStep({ kind: 'busy', text: `Buscando en ${store.name}…` });
    const result = await searchInStore(store.key, query);
    if (!result.ok) setStep({ kind: 'error', text: result.error });
    else if (result.hits.length === 0) setStep({ kind: 'error', text: `${result.storeName} no mostró resultados para "${query}". Prueba con menos palabras o pega el link.` });
    else setStep({ kind: 'hits', storeName: result.storeName, hits: result.hits });
  }

  async function review(raw: string, sku: string | null = null) {
    setStep({ kind: 'busy', text: 'Leyendo la ficha en la tienda…' });
    const result = await reviewStoreLink(item.id, raw, sku);
    if (result.ok) setStep({ kind: 'preview', preview: result.preview, raw, sku });
    else if ('variants' in result) setStep({ kind: 'variants', storeName: result.storeName, url: result.url, variants: result.variants });
    else setStep({ kind: 'error', text: result.error });
  }

  async function save(raw: string, sku: string | null) {
    setStep({ kind: 'busy', text: 'Guardando…' });
    const result = await linkStoreOffer(item.id, raw, sku);
    if (!result.ok) {
      setStep({ kind: 'error', text: result.error });
      return;
    }
    const text = `Listo: ${result.storeName} quedó enlazada con ${formatCLP(result.price)}. Desde ahora su precio se revisa solo, dos veces al día.`;
    setStep({ kind: 'done', text: result.test ? `${text} ${TEST_NOTE}` : text });
    setLink('');
    if (!result.test) router.refresh();
  }

  return (
    <div className="mt-3 border-t border-border pt-3">
      <p className="text-sm font-medium text-fg">Agregar una tienda</p>

      {stores.length > 0 && (
        <div className="mt-2 flex flex-col gap-2 sm:flex-row">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Qué buscar en la tienda"
            className={INPUT}
            maxLength={80}
          />
          {stores.map((store) => (
            <button key={store.key} type="button" disabled={busy || query.trim().length < 3} onClick={() => search(store)} className={`${SECONDARY} shrink-0`}>
              <Search size={16} aria-hidden />
              Buscar en {store.name}
            </button>
          ))}
        </div>
      )}

      <div className="mt-2 flex flex-col gap-2 sm:flex-row">
        <input
          type="url"
          inputMode="url"
          value={link}
          onChange={(e) => setLink(e.target.value)}
          placeholder="…o pega el link de la ficha (Paris o MacOnline)"
          aria-label="Link de la ficha en la tienda"
          className={INPUT}
        />
        <button type="button" disabled={busy || link.trim().length < 12} onClick={() => review(link.trim())} className={`${SECONDARY} shrink-0`}>
          Revisar
        </button>
      </div>

      {step.kind === 'busy' && (
        <p role="status" className="mt-3 flex items-center gap-2 text-sm text-muted">
          <Loader2 size={16} className="animate-spin" aria-hidden />
          {step.text}
        </p>
      )}

      {step.kind === 'error' && (
        <p role="alert" className="mt-3 text-sm text-red-400">
          {step.text}
        </p>
      )}

      {step.kind === 'done' && (
        <p role="status" className="mt-3 flex items-start gap-2 text-sm text-accent">
          <Check size={16} className="mt-0.5 shrink-0" aria-hidden />
          {step.text}
        </p>
      )}

      {step.kind === 'hits' && (
        <div className="mt-3">
          <p className="text-sm text-muted">
            Esto mostró {step.storeName}. Toca el que sea <strong className="text-fg">el mismo producto</strong> (misma capacidad, y no un pack ni un
            accesorio):
          </p>
          <ul className="mt-2 space-y-2">
            {step.hits.map((hit) => (
              <li key={hit.url}>
                <button
                  type="button"
                  onClick={() => review(hit.url)}
                  className="flex min-h-11 w-full items-center justify-between gap-3 rounded-md border border-border bg-surface2 px-3 py-2 text-left text-sm text-fg hover:border-accent"
                >
                  <span className="min-w-0 flex-1">{hit.title}</span>
                  <span className="shrink-0 font-semibold">{hit.price !== null ? formatCLP(hit.price) : '—'}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {step.kind === 'variants' && (
        <div className="mt-3">
          <p className="text-sm text-muted">
            Esa ficha de {step.storeName} trae varias versiones. Toca la que corresponde a este producto:
          </p>
          <ul className="mt-2 space-y-2">
            {step.variants.map((variant) => (
              <li key={variant.sku}>
                <button
                  type="button"
                  onClick={() => review(step.url, variant.sku)}
                  className="flex min-h-11 w-full items-center justify-between gap-3 rounded-md border border-border bg-surface2 px-3 py-2 text-left text-sm text-fg hover:border-accent"
                >
                  <span className="min-w-0 flex-1">{variant.title ?? variant.sku}</span>
                  <span className="shrink-0 font-semibold">{variant.price !== null ? formatCLP(variant.price) : '—'}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {step.kind === 'preview' && (
        <div className="mt-3 rounded-lg border border-accent/50 bg-surface2 p-3">
          <p className="text-xs font-medium uppercase tracking-wide text-muted">Esto dice {step.preview.storeName}</p>
          <p className="mt-1 text-sm text-fg">{step.preview.title ?? '(sin nombre)'}</p>
          <p className="mt-1 font-heading text-xl font-bold text-fg">{formatCLP(step.preview.price)}</p>
          <p className="mt-1 text-xs text-muted">
            En el sitio, Mercado Libre: {formatCLP(item.mlPrice)}
            {item.mlDate ? ` (del ${item.mlDate})` : ''}.
          </p>
          {step.preview.warnings.map((warning) => (
            <p key={warning} className="mt-2 text-sm text-amber-400">
              {warning}
            </p>
          ))}
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" onClick={() => save(step.raw, step.sku)} className={PRIMARY}>
              Es el mismo producto: guardar
            </button>
            <a href={step.preview.url} target="_blank" rel="nofollow noopener" className={SECONDARY}>
              <ExternalLink size={16} aria-hidden />
              Abrir la ficha
            </a>
            <button type="button" onClick={() => setStep({ kind: 'idle' })} className={SECONDARY}>
              No es
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// La tarjeta de un producto

export function ProductCard({ item, stores, preview }: { item: ProductItem; stores: SearchableStore[]; preview?: ReactNode }) {
  return (
    <li className="rounded-xl border border-border bg-surface p-3 sm:p-4">
      <div className="flex gap-3">
        {/* eslint-disable-next-line @next/next/no-img-element -- miniatura del admin: no pasa por el optimizador. */}
        <img src={item.image} alt="" className="h-16 w-16 shrink-0 rounded-md bg-white object-contain" loading="lazy" />
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold leading-snug text-fg">{item.name}</h3>
          <p className="mt-1 text-xs text-muted">
            Mercado Libre: <strong className="text-fg">{formatCLP(item.mlPrice)}</strong>
            {item.mlDate ? ` · del ${item.mlDate}` : ''}
            {item.clicks > 0 && ` · ${item.clicks} ${item.clicks === 1 ? 'clic' : 'clics'} en 30 días`}
          </p>
          <p className="mt-1 text-xs">
            <a href={`/producto/${item.slug}`} target="_blank" rel="noopener" className="font-medium text-accent hover:underline">
              Ver su ficha en el sitio
            </a>
          </p>
        </div>
      </div>

      {item.offers.length > 0 && (
        <ul className="mt-3 space-y-2">
          {item.offers.map((offer) => (
            <OfferRow key={offer.id} offer={offer} />
          ))}
        </ul>
      )}

      {preview && (
        <details className="mt-3 text-sm">
          <summary className="cursor-pointer font-medium text-accent">Así se ve en la ficha del sitio</summary>
          <div className="mt-1 rounded-lg border border-dashed border-border px-3 pb-3">{preview}</div>
        </details>
      )}

      <AddStore item={item} stores={stores} />
    </li>
  );
}
