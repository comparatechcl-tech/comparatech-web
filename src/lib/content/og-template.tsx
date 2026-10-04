import { ImageResponse } from 'next/og';
import { shortProductName } from '@/lib/text';
import { captionDiscount, chileDateTime, formatPrice, mlPhotoJpg } from '@/lib/content/captions';

/**
 * Plantilla de las imágenes de producto: el kit para redes del admin
 * (feed, historia y pin) y la vista previa de los links (og), que es lo que
 * muestra WhatsApp al compartir una ficha.
 *
 * Reglas que no se negocian:
 * - La foto de Mercado Libre va tal cual, entera y dentro de un marco blanco.
 *   Nada de texto encima: tapar parte del producto o "decorar" la foto
 *   oficial confunde sobre lo que se compra.
 * - Descuento, "antes", envío gratis y Full aparecen solo si son ciertos.
 * - Siempre la hora del precio y '#publicidad'.
 *
 * Usa la fuente que trae next/og (sin pedir fuentes a otro servidor), y sin
 * emojis, que next/og descarga aparte.
 */

export type OgFormat = 'feed' | 'story' | 'pin' | 'og';

export const OG_SIZES: Record<OgFormat, { width: number; height: number }> = {
  feed: { width: 1080, height: 1350 },
  story: { width: 1080, height: 1920 },
  pin: { width: 1000, height: 1500 },
  og: { width: 1200, height: 630 },
};

export function isOgFormat(value: unknown): value is OgFormat {
  return typeof value === 'string' && value in OG_SIZES;
}

/** Lo que la plantilla necesita del producto. */
export interface OgProduct {
  name: string;
  brand?: string | null;
  price: number;
  original_price: number | null;
  image_url: string;
  price_checked_at: string | null;
  offer_info?: { free_shipping?: boolean | null; is_full?: boolean | null } | null;
}

const COLORS = {
  bg: '#070B14',
  surface: '#0B1220',
  accent: '#00D4FF',
  ink: '#0A0E17',
  fg: '#FFFFFF',
  muted: '#94A3B8',
  yellow: '#FFE600',
};

const PHOTO_TIMEOUT_MS = 6000;

/**
 * Baja la foto y la entrega como data URI. next/og también sabe pedirla
 * sola, pero si ML tarda o responde otra cosa la imagen entera falla; así,
 * sin foto se dibuja el marco vacío y el resto de la pieza sale igual.
 */
export async function loadPhoto(imageUrl: string, size: 'F' | 'O' = 'F'): Promise<string | null> {
  const url = mlPhotoJpg(imageUrl, size);
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(PHOTO_TIMEOUT_MS) });
    if (!res.ok) return null;
    const type = (res.headers.get('content-type') ?? '').split(';')[0].trim();
    if (type !== 'image/jpeg' && type !== 'image/png') return null;
    const bytes = Buffer.from(await res.arrayBuffer());
    return `data:${type};base64,${bytes.toString('base64')}`;
  } catch {
    return null;
  }
}

interface Layout {
  pad: number;
  /** Lado del marco blanco de la foto. */
  photo: number;
  name: number;
  price: number;
  small: number;
  chip: number;
  horizontal: boolean;
}

const LAYOUTS: Record<OgFormat, Layout> = {
  feed: { pad: 64, photo: 640, name: 44, price: 120, small: 30, chip: 34, horizontal: false },
  story: { pad: 72, photo: 936, name: 54, price: 150, small: 36, chip: 40, horizontal: false },
  pin: { pad: 60, photo: 760, name: 42, price: 112, small: 28, chip: 32, horizontal: false },
  og: { pad: 40, photo: 550, name: 34, price: 84, small: 22, chip: 26, horizontal: true },
};

function Chip({ text, size, strong = false }: { text: string; size: number; strong?: boolean }) {
  return (
    <div
      style={{
        display: 'flex',
        padding: `${Math.round(size * 0.25)}px ${Math.round(size * 0.5)}px`,
        borderRadius: 999,
        fontSize: size,
        background: strong ? COLORS.accent : 'rgba(255,255,255,0.08)',
        color: strong ? COLORS.ink : COLORS.fg,
        border: strong ? 'none' : '2px solid rgba(255,255,255,0.18)',
      }}
    >
      {text}
    </div>
  );
}

function Wordmark({ size }: { size: number }) {
  return (
    <div style={{ display: 'flex', fontSize: size, color: COLORS.fg, letterSpacing: -0.5 }}>
      <span>Compara</span>
      <span style={{ color: COLORS.accent }}>Tech</span>
    </div>
  );
}

function PhotoFrame({ photo, side, alt }: { photo: string | null; side: number; alt: string }) {
  const inner = Math.round(side * 0.88);
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: side,
        height: side,
        background: '#FFFFFF',
        borderRadius: Math.round(side * 0.05),
        flexShrink: 0,
      }}
    >
      {photo ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={photo} alt={alt} width={inner} height={inner} style={{ objectFit: 'contain' }} />
      ) : null}
    </div>
  );
}

export function ProductOgTemplate({
  product,
  format,
  photo,
}: {
  product: OgProduct;
  format: OgFormat;
  photo: string | null;
}) {
  const L = LAYOUTS[format];
  const { width, height } = OG_SIZES[format];
  const discount = captionDiscount(product);
  const checked = chileDateTime(product.price_checked_at);
  const name = shortProductName(product.name, L.horizontal ? 60 : 70);
  const brand = product.brand?.trim();

  const chips: { text: string; strong?: boolean }[] = [];
  if (discount > 0) chips.push({ text: `-${discount}%`, strong: true });
  if (product.offer_info?.free_shipping === true) chips.push({ text: 'Envío gratis' });
  if (product.offer_info?.is_full === true) chips.push({ text: 'Full' });

  const info = (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0, gap: Math.round(L.small * 0.6) }}>
      {brand ? (
        <div style={{ display: 'flex', fontSize: L.small, color: COLORS.muted, textTransform: 'uppercase', letterSpacing: 2 }}>
          {brand}
        </div>
      ) : null}
      <div style={{ display: 'flex', fontSize: L.name, color: COLORS.fg, lineHeight: 1.2 }}>{name}</div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', fontSize: L.price, color: COLORS.accent, lineHeight: 1 }}>
          {formatPrice(product.price)}
        </div>
        {discount > 0 && product.original_price ? (
          <div
            style={{
              display: 'flex',
              fontSize: L.small,
              color: COLORS.muted,
              textDecoration: 'line-through',
              paddingBottom: Math.round(L.small * 0.3),
            }}
          >
            {`antes ${formatPrice(product.original_price)}`}
          </div>
        ) : null}
      </div>
      {chips.length > 0 ? (
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          {chips.map((c) => (
            <Chip key={c.text} text={c.text} size={L.chip} strong={c.strong} />
          ))}
        </div>
      ) : null}
    </div>
  );

  const footer = (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: L.small, color: COLORS.muted }}>
      <div style={{ display: 'flex' }}>
        {checked ? `Precio revisado ${checked.date} ${checked.time}` : 'Precio sujeto a cambios'}
      </div>
      <div style={{ display: 'flex' }}>#publicidad</div>
    </div>
  );

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        width,
        height,
        padding: L.pad,
        background: COLORS.bg,
        color: COLORS.fg,
        gap: Math.round(L.pad * 0.5),
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Wordmark size={Math.round(L.name * 1.05)} />
        <div style={{ display: 'flex', fontSize: L.small, color: COLORS.muted }}>Precios en Mercado Libre</div>
      </div>

      {L.horizontal ? (
        <div style={{ display: 'flex', flex: 1, gap: L.pad, alignItems: 'center', minHeight: 0 }}>
          <PhotoFrame photo={photo} side={Math.min(L.photo, height - L.pad * 2 - 90)} alt={name} />
          {info}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, gap: Math.round(L.pad * 0.6), minHeight: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'center' }}>
            <PhotoFrame photo={photo} side={L.photo} alt={name} />
          </div>
          {info}
        </div>
      )}

      {footer}
    </div>
  );
}

/** Imagen sin producto (ficha que no existe, base caída): solo la marca. */
export function BrandOgTemplate({ format, title }: { format: OgFormat; title: string }) {
  const { width, height } = OG_SIZES[format];
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        width,
        height,
        background: COLORS.bg,
        gap: 24,
      }}
    >
      <Wordmark size={96} />
      <div style={{ display: 'flex', fontSize: 36, color: COLORS.muted }}>{title}</div>
    </div>
  );
}

/** Vista previa de /ofertas: cuántas hay, el mayor descuento y tres fotos. */
export function OffersOgTemplate({
  count,
  maxDiscount,
  photos,
}: {
  count: number;
  maxDiscount: number;
  photos: (string | null)[];
}) {
  const { width, height } = OG_SIZES.og;
  const headline =
    count > 0
      ? `${count} ${count === 1 ? 'oferta' : 'ofertas'} hoy · hasta ${maxDiscount}% dcto`
      : 'Ofertas del día';
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        width,
        height,
        padding: 48,
        background: COLORS.bg,
        color: COLORS.fg,
        gap: 28,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Wordmark size={44} />
        <div style={{ display: 'flex', fontSize: 22, color: COLORS.muted }}>Precios en Mercado Libre</div>
      </div>
      <div style={{ display: 'flex', fontSize: 58, color: COLORS.fg, lineHeight: 1.1 }}>{headline}</div>
      <div style={{ display: 'flex', gap: 28, flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        {photos
          .filter((photo): photo is string => Boolean(photo))
          .slice(0, 3)
          .map((photo, i) => (
            <PhotoFrame key={i} photo={photo} side={300} alt="" />
          ))}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 22, color: COLORS.muted }}>
        <div style={{ display: 'flex' }}>Descuentos según el precio de lista que informa Mercado Libre</div>
        <div style={{ display: 'flex' }}>#publicidad</div>
      </div>
    </div>
  );
}

/** PNG de un producto en el formato pedido. */
export async function productImageResponse(
  product: OgProduct,
  format: OgFormat,
  init: { headers?: Record<string, string> } = {}
): Promise<ImageResponse> {
  // Para la vista previa de links basta la foto mediana: el PNG pesa menos
  // y WhatsApp descarta las imágenes pesadas.
  const photo = await loadPhoto(product.image_url, format === 'og' ? 'O' : 'F');
  return new ImageResponse(<ProductOgTemplate product={product} format={format} photo={photo} />, {
    ...OG_SIZES[format],
    headers: init.headers,
  });
}
