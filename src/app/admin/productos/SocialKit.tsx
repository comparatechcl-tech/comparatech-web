'use client';

import { useState, useTransition } from 'react';
import { Check, Copy, Download, ImageIcon, Loader2, Send } from 'lucide-react';
import { buyUrl } from '@/lib/outbound';
import { buildCaption, type CaptionChannel } from '@/lib/content/captions';
import { setRrssStatus, type SocialChannel } from './actions';
import type { AdminProduct } from './ProductAdminCard';

/**
 * Kit para redes de un producto: las tres imágenes listas para subir y los
 * textos con el aviso de publicidad y la hora del precio. Antes cada pieza
 * se armaba a mano y por eso no se publicaba nada.
 *
 * Se abre a pedido: cada vista previa la genera el servidor (baja la foto
 * de ML y dibuja la pieza), y 50 tarjetas abiertas a la vez serían 50 de
 * esas de golpe.
 */

const DOWNLOADS: { f: 'feed' | 'story' | 'pin'; label: string }[] = [
  { f: 'feed', label: 'Descargar imagen feed (4:5)' },
  { f: 'story', label: 'Descargar historia (9:16)' },
  { f: 'pin', label: 'Descargar pin (2:3)' },
];

const COPIES: { key: 'social' | 'chat'; channel: CaptionChannel; label: string }[] = [
  { key: 'social', channel: 'instagram', label: 'Copiar texto Instagram/TikTok' },
  { key: 'chat', channel: 'whatsapp', label: 'Copiar texto WhatsApp/Telegram' },
];

const CHANNELS: { value: SocialChannel; label: string }[] = [
  { value: 'instagram', label: 'Instagram' },
  { value: 'tiktok', label: 'TikTok' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'telegram', label: 'Telegram' },
  { value: 'facebook', label: 'Facebook' },
];

export function SocialKit({
  product,
  siteUrl,
  onPublished,
}: {
  product: AdminProduct;
  siteUrl?: string;
  onPublished?: (channel: SocialChannel) => void;
}) {
  const [open, setOpen] = useState(false);
  const [previewState, setPreviewState] = useState<'loading' | 'ok' | 'error'>('loading');
  const [copied, setCopied] = useState<'social' | 'chat' | null>(null);
  const [marking, setMarking] = useState<SocialChannel | null>(null);
  const [marked, setMarked] = useState<SocialChannel | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const kitUrl = (f: string, download = false) =>
    `/admin/kit/${product.id}?f=${f}${download ? '&dl=1' : ''}`;

  async function handleCopy(key: 'social' | 'chat', channel: CaptionChannel) {
    // La hora del clic: el gancho cambia por día y el texto lleva la hora
    // del precio, no la de la copia.
    const text = buildCaption(product, channel, {
      now: new Date(),
      siteUrl: siteUrl || window.location.origin,
      link: buyUrl(product),
    });
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setError(null);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      setError('El navegador no dejó copiar. Intenta de nuevo.');
    }
  }

  function handleMark(channel: SocialChannel) {
    setMarking(channel);
    setError(null);
    startTransition(async () => {
      try {
        const result = await setRrssStatus(product.id, 'publicado', channel);
        if (!result.ok) {
          setError(result.error);
          return;
        }
        setMarked(channel);
        onPublished?.(channel);
      } catch {
        setError('No se pudo guardar. Revisa tu conexión.');
      } finally {
        setMarking(null);
      }
    });
  }

  if (!open) {
    return (
      <button
        onClick={() => {
          setOpen(true);
          setPreviewState('loading');
        }}
        className="flex items-center justify-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs text-muted transition hover:text-fg"
      >
        <ImageIcon size={13} /> Kit para redes
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface2 p-3 sm:flex-row">
      <div className="relative mx-auto aspect-[4/5] w-40 shrink-0 overflow-hidden rounded-md bg-bg sm:mx-0">
        {previewState === 'loading' && (
          <div className="absolute inset-0 flex items-center justify-center">
            <Loader2 size={18} className="animate-spin text-muted" />
          </div>
        )}
        {previewState === 'error' ? (
          <p className="flex h-full items-center justify-center p-2 text-center text-[11px] text-muted">
            No se pudo generar la vista previa.
          </p>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element -- PNG generado por /admin/kit, sin optimizar a propósito.
          <img
            src={kitUrl('feed')}
            alt={`Vista previa del post de ${product.name}`}
            className={`h-full w-full object-contain transition ${previewState === 'ok' ? 'opacity-100' : 'opacity-0'}`}
            onLoad={() => setPreviewState('ok')}
            onError={() => setPreviewState('error')}
          />
        )}
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="grid gap-1.5 sm:grid-cols-2">
          {DOWNLOADS.map((d) => (
            <a
              key={d.f}
              href={kitUrl(d.f, true)}
              download
              className="flex items-center justify-center gap-1.5 rounded-md border border-border bg-surface px-3 py-1.5 text-xs text-muted transition hover:text-fg"
            >
              <Download size={13} /> {d.label}
            </a>
          ))}
          {COPIES.map((c) => (
            <button
              key={c.key}
              onClick={() => handleCopy(c.key, c.channel)}
              className="flex items-center justify-center gap-1.5 rounded-md border border-border bg-surface px-3 py-1.5 text-xs text-muted transition hover:text-fg"
            >
              {copied === c.key ? <Check size={13} className="text-accent" /> : <Copy size={13} />}
              {copied === c.key ? 'Copiado' : c.label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <span className="flex items-center gap-1 text-[11px] text-muted">
            <Send size={11} /> Marcar publicado en:
          </span>
          {CHANNELS.map((c) => (
            <button
              key={c.value}
              onClick={() => handleMark(c.value)}
              disabled={marking !== null}
              className={`rounded-full border px-2.5 py-1 text-[11px] font-medium transition disabled:opacity-50 ${
                marked === c.value ? 'border-accent bg-accent/10 text-accent' : 'border-border text-muted hover:text-fg'
              }`}
            >
              {marking === c.value ? 'Guardando…' : marked === c.value ? `✓ ${c.label}` : c.label}
            </button>
          ))}
        </div>

        {error && <p className="text-xs text-red-400">{error}</p>}
        <button onClick={() => setOpen(false)} className="self-start text-[11px] text-muted hover:text-fg hover:underline">
          Cerrar kit
        </button>
      </div>
    </div>
  );
}
