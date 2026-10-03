'use client';

import { useState, useTransition } from 'react';
import Image from 'next/image';
import { Copy, Check, ExternalLink, EyeOff, Eye, Trash2, RefreshCw } from 'lucide-react';
import { Product, RrssStatus } from '@/lib/types';
import { formatCLP, formatTimeAgo } from '@/lib/format';
import { mlProductUrl } from '@/lib/ml-urls';
import { buyUrl } from '@/lib/outbound';
import { reasonInfo } from '@/lib/inactive-reasons';
import {
  checkAffiliateLink,
  recheckProducts,
  republishWithLink,
} from '@/lib/actions/catalog-admin';
import { deleteProduct, setProductHidden, setRrssStatus } from './actions';

const RRSS_OPTIONS: { value: RrssStatus; label: string }[] = [
  { value: 'sin_usar', label: 'Sin usar' },
  { value: 'seleccionado', label: 'Seleccionado' },
  { value: 'publicado', label: 'Publicado' },
];

const RESULT_MESSAGES: Record<string, string> = {
  activo: '✓ Guardado y publicado.',
  pendiente: '✓ Guardado. Mercado Libre no respondió: se publica en la próxima revisión.',
  sin_ganador: 'Guardado, pero Mercado Libre no tiene vendedor para esta ficha ahora. Se publica solo cuando aparezca.',
  ganador_no_verde: 'Guardado, pero el vendedor que muestra la ficha no tiene reputación verde. Se publica solo cuando cambie.',
  error_transitorio: 'Guardado. Mercado Libre no respondió: se revisa de nuevo en unos minutos.',
};

type LinkCheck =
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'ok' }
  | { status: 'otro_producto'; featuredProductId: string | null }
  | { status: 'indeterminado' }
  | { status: 'error'; message: string };

function discountPercent(p: Pick<Product, 'price' | 'original_price'>): number {
  if (!p.original_price || p.original_price <= p.price) return 0;
  return Math.round((1 - p.price / p.original_price) * 100);
}

export function ProductAdminCard({
  product,
  selected = false,
  onToggleSelect,
}: {
  product: Product;
  selected?: boolean;
  onToggleSelect?: () => void;
}) {
  const [status, setStatus] = useState<RrssStatus>(product.rrss_status ?? 'sin_usar');
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [affiliateUrl, setAffiliateUrl] = useState(product.affiliate_url);
  const [linkCheck, setLinkCheck] = useState<LinkCheck>({ status: 'idle' });
  const [isHidden, setIsHidden] = useState(product.is_hidden ?? false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [isPending, startTransition] = useTransition();

  const discount = discountPercent(product);
  const reason = !product.is_active ? reasonInfo(product.inactive_reason) : null;
  const checkedAgo = formatTimeAgo(product.price_checked_at);

  function handleDelete() {
    // Dos pasos a propósito: el borrado no tiene vuelta atrás y se lleva
    // consigo el link de afiliado, que hay que generar a mano.
    if (!confirmingDelete) {
      setConfirmingDelete(true);
      setTimeout(() => setConfirmingDelete(false), 5000);
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await deleteProduct(product.id);
      if (!result.ok) {
        setError(result.error);
        setConfirmingDelete(false);
      }
    });
  }

  function handleToggleHidden() {
    const next = !isHidden;
    const previous = isHidden;
    setIsHidden(next);
    setError(null);
    startTransition(async () => {
      const result = await setProductHidden(product.id, next);
      if (!result.ok) {
        setIsHidden(previous);
        setError(result.error);
      }
    });
  }

  function handleVerifyLink() {
    setLinkCheck({ status: 'checking' });
    startTransition(async () => {
      const result = await checkAffiliateLink(affiliateUrl, product.ml_product_id);
      if (!result.ok) setLinkCheck({ status: 'error', message: result.error });
      else if (result.verdict === 'coincide') setLinkCheck({ status: 'ok' });
      else if (result.verdict === 'otra_ficha')
        setLinkCheck({ status: 'otro_producto', featuredProductId: result.featuredProductId });
      else setLinkCheck({ status: 'indeterminado' });
    });
  }

  // Guardar un link deja el producto publicado en el mismo paso: antes había
  // que esperar hasta 24 horas a que el cron lo notara.
  function handleSaveLink() {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const result = await republishWithLink(product.id, affiliateUrl);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      const message = RESULT_MESSAGES[result.result] ?? '✓ Guardado.';
      setNotice(
        result.verified
          ? message
          : `${message} No se pudo comprobar a qué ficha lleva el link: ábrelo con "Abrir como comprador" para confirmarlo.`
      );
    });
  }

  function handleRecheck() {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const result = await recheckProducts([product.id]);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      const outcome = result.results[0]?.result;
      setNotice(
        outcome === 'activo'
          ? '✓ Revisado: está disponible y quedó publicado.'
          : !outcome || outcome === 'error_transitorio'
            ? 'Mercado Libre no respondió. Intenta de nuevo en un rato.'
            : `Revisado: ${reasonInfo(outcome).title.toLowerCase()}.`
      );
    });
  }

  function handleStatusChange(next: RrssStatus) {
    const previous = status;
    setStatus(next);
    setError(null);
    startTransition(async () => {
      const result = await setRrssStatus(product.id, next);
      if (!result.ok) {
        setStatus(previous);
        setError(result.error);
      }
    });
  }

  // El texto para redes se arma con el descuento adelante cuando lo hay: es
  // el dato que hace que alguien se detenga a mirar el post.
  function handleCopy() {
    const link = buyUrl(product);
    const headline =
      discount > 0
        ? `🔥 ${product.name}\n${formatCLP(product.price)} (antes ${formatCLP(
            product.original_price ?? 0
          )}) — ${discount}% de descuento, ahorras ${formatCLP((product.original_price ?? 0) - product.price)}`
        : `${product.name} — ${formatCLP(product.price)}`;

    navigator.clipboard.writeText(`${headline}\n${link}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div
      className={`flex flex-col gap-4 rounded-xl border bg-surface p-4 transition ${
        isHidden ? 'border-border opacity-55' : reason ? 'border-amber-500/40' : 'border-border'
      }`}
    >
      {reason && !isHidden && (
        <div className="flex flex-col gap-2 rounded-lg bg-amber-500/10 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs font-semibold text-amber-400">
              Fuera del sitio · {reason.title}
            </p>
            <p className="mt-0.5 text-xs text-muted">{reason.detail}</p>
          </div>
          <button
            onClick={handleRecheck}
            disabled={isPending}
            className="flex shrink-0 items-center justify-center gap-1.5 rounded-md border border-amber-500/40 px-3 py-1.5 text-xs font-medium text-amber-400 transition hover:bg-amber-500/10 disabled:opacity-50"
          >
            <RefreshCw size={12} className={isPending ? 'animate-spin' : ''} />
            Revisar ahora
          </button>
        </div>
      )}

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        {onToggleSelect && (
          <input
            type="checkbox"
            checked={selected}
            onChange={onToggleSelect}
            className="h-4 w-4 shrink-0 accent-accent sm:self-center"
            aria-label={`Seleccionar ${product.name}`}
          />
        )}
        <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-lg bg-white">
          <Image src={product.image_url} alt={product.name} fill sizes="80px" className="object-contain" />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <h3 className="font-heading text-sm font-medium text-fg">{product.name}</h3>
            <span className="flex shrink-0 items-center gap-1.5 whitespace-nowrap">
              {discount > 0 && (
                <span className="rounded bg-accent/15 px-1.5 py-0.5 text-[11px] font-bold text-accent">
                  -{discount}%
                </span>
              )}
              <span className="text-sm font-semibold text-accent">{formatCLP(product.price)}</span>
            </span>
          </div>
          <p className="mt-1 text-xs text-muted">
            {product.category} · {new Date(product.created_at).toLocaleDateString('es-CL')}
            {checkedAgo && <> · precio verificado {checkedAgo}</>}
            {isHidden && <span className="ml-2 text-amber-400">Oculto del sitio</span>}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
            <a
              href={buyUrl(product)}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-xs text-accent hover:underline"
            >
              Abrir como comprador <ExternalLink size={11} />
            </a>
            {/* La ficha de catálogo es desde donde hay que generar el link si
                el actual quedó apuntando a otro producto. */}
            {product.ml_product_id && (
              <a
                href={mlProductUrl(product.ml_product_id)}
                target="_blank"
                rel="noreferrer"
                className="text-xs text-muted hover:text-fg hover:underline"
              >
                abrir la ficha en ML
              </a>
            )}
          </div>
        </div>

        <div className="flex shrink-0 flex-col items-stretch gap-2 sm:w-56">
          <div className="flex gap-1 rounded-lg border border-border bg-surface2 p-1">
            {RRSS_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => handleStatusChange(opt.value)}
                disabled={isPending}
                className={`flex-1 rounded-md px-2 py-1.5 text-[11px] font-medium transition disabled:opacity-50 ${
                  status === opt.value ? 'bg-accent text-ink' : 'text-muted hover:text-fg'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <button
            onClick={handleCopy}
            className="flex items-center justify-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs text-muted transition hover:text-fg"
          >
            {copied ? <Check size={13} className="text-accent" /> : <Copy size={13} />}
            {copied ? 'Copiado' : 'Copiar para RRSS'}
          </button>
          <button
            onClick={handleToggleHidden}
            disabled={isPending}
            className={`flex items-center justify-center gap-1.5 rounded-md border px-3 py-1.5 text-xs transition disabled:opacity-50 ${
              isHidden
                ? 'border-accent/40 text-accent hover:bg-accent/10'
                : 'border-border text-muted hover:text-red-400'
            }`}
          >
            {isHidden ? <Eye size={13} /> : <EyeOff size={13} />}
            {isHidden ? 'Volver a publicar' : 'Ocultar del sitio'}
          </button>
          <button
            onClick={handleDelete}
            disabled={isPending}
            className={`flex items-center justify-center gap-1.5 rounded-md border px-3 py-1.5 text-xs transition disabled:opacity-50 ${
              confirmingDelete
                ? 'border-red-500 bg-red-500/10 font-medium text-red-400'
                : 'border-transparent text-muted hover:border-border hover:text-red-400'
            }`}
          >
            <Trash2 size={13} />
            {confirmingDelete ? 'Confirmar: borrar para siempre' : 'Eliminar'}
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-1.5 border-t border-border pt-3">
        {/* Tres controles en fila dejaban el campo del link ilegible en un
            teléfono. Se apilan hasta sm, donde ya hay ancho de sobra. */}
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            type="url"
            value={affiliateUrl}
            onChange={(e) => {
              setAffiliateUrl(e.target.value);
              setLinkCheck({ status: 'idle' });
              setNotice(null);
            }}
            className="flex-1 rounded-md border border-border bg-surface2 px-3 py-2 text-xs text-fg focus:border-accent focus:outline-none"
          />
          <button
            onClick={handleVerifyLink}
            disabled={!affiliateUrl.trim() || linkCheck.status === 'checking'}
            className="flex-1 rounded-md border border-border px-3 py-2 text-xs font-medium text-muted transition hover:text-fg disabled:cursor-not-allowed disabled:opacity-40 sm:flex-none sm:shrink-0"
          >
            {linkCheck.status === 'checking' ? 'Verificando…' : 'Verificar'}
          </button>
          <button
            onClick={handleSaveLink}
            disabled={!affiliateUrl.trim() || affiliateUrl === product.affiliate_url || isPending}
            className="flex-1 rounded-md bg-accent px-3 py-2 text-xs font-medium text-ink transition hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-40 sm:flex-none sm:shrink-0"
          >
            {isPending ? 'Publicando…' : 'Guardar y publicar'}
          </button>
        </div>
        {linkCheck.status === 'ok' && (
          <p className="text-xs text-accent">✓ El link lleva a la ficha de este producto.</p>
        )}
        {linkCheck.status === 'otro_producto' && (
          <p className="text-xs text-red-400">
            ⚠ Este link lleva a otra ficha
            {linkCheck.featuredProductId ? ` (${linkCheck.featuredProductId})` : ''}. Genéralo desde la ficha
            de este producto.
          </p>
        )}
        {linkCheck.status === 'indeterminado' && (
          <p className="text-xs text-amber-400">
            No se pudo comprobar a qué ficha lleva: tu perfil de afiliado no está mostrando el producto (pasa
            cuando la ficha se queda sin vendedores). Puedes guardarlo igual.
          </p>
        )}
        {linkCheck.status === 'error' && (
          <p className="text-xs text-amber-400">No se pudo verificar ({linkCheck.message}).</p>
        )}
        {notice && <p className="text-xs text-accent">{notice}</p>}
        {error && <p className="text-xs text-red-400">{error}</p>}
      </div>
    </div>
  );
}
