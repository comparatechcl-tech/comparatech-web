/* eslint-disable @next/next/no-img-element -- esto lo dibuja next/og, que solo entiende <img> */
/**
 * Las láminas del carrusel semanal para Instagram y Facebook (1080x1350, el
 * formato vertical del feed): la portada, una lámina por producto y el cierre.
 *
 * La lámina de un producto es la misma tarjeta de la publicación del feed
 * (lib/content/offer-template), con las mismas reglas: la foto de Mercado
 * Libre entera, sobre blanco y sin nada encima; envío gratis y Full solo si
 * son ciertos; y siempre la hora del precio. Cambia la franja: en vez del
 * descuento de lista lleva la baja que registró el historial propio ("Bajó
 * $X", desde qué día), en verde, el color que tiene "Bajó" en el sitio. Una
 * baja nunca se llama descuento, y la cifra tachada del vendedor no va: dos
 * "antes" distintos en la misma lámina confunden.
 *
 * Arriba del nombre va el puesto ("#1"). En la portada, el título, la semana
 * y las fotos; en el cierre, dónde comprar. Ninguna lleva "Publicidad" ni la
 * comisión (decisión del dueño, 18-10-2026), ni emojis ni letras fuera de
 * Inter: next/og los bajaría de otro servidor.
 *
 * Necesita Inter en 400, 600 y 800 (lib/content/og-fonts).
 */
import { socialProductName } from '@/lib/content/social-name';
import { chileDateTime, formatPrice } from '@/lib/content/captions';
import { ICON_FULL, ICON_SHIPPING, LOGO_PNG, W600, W800, fitName, textWidth } from '@/lib/content/offer-template';
import type { CarouselKind } from '@/lib/social/carousel-url';

export const CAROUSEL_SIZE = { width: 1080, height: 1350 } as const;

const COLORS = {
  bg: '#070B14',
  surface: '#0B1220',
  cyan: '#00D4FF',
  ink: '#0A0E17',
  white: '#FFFFFF',
  muted: '#94A3B8',
  /** El verde de "Bajó" en el sitio (emerald-400). */
  green: '#34D399',
};

/**
 * Instagram, cuando recibe varias fotos desde Compartir, puede cortarlas al
 * cuadrado del centro (1080x1080: de y=135 a y=1215), y así salió el primer
 * carrusel (19-10-2026). Todo lo que la lámina dice va dentro de ese cuadrado;
 * en el formato vertical completo, las franjas de arriba y de abajo quedan de
 * fondo (la portada lleva ahí solo "Desliza", que sobra si se corta).
 */
export const CAROUSEL_SAFE = { top: 135, bottom: 1215 } as const;

// La tarjeta va de margen a margen, como en la publicación del feed, pero dentro del cuadrado del centro.
const TOP = 160;
const MARGIN = 72;
const CONTENT_W = 1080 - MARGIN * 2; // 936
const HEADER_H = 72;
const CARD_BOTTOM = 1192;
const TITLE_GAP = 16;
const CARD_GAP = 24;
const RADIUS = 44;
const HAIRLINE = 2;
const INNER_W = CONTENT_W - HAIRLINE * 2;
const CARD_PAD = 44;
const PHOTO_PAD = 12;
const KICKER_H = 40;
const NAME_SPACING = -0.5;
const DROP_BAND_H = 112;
const PANEL_H = 160;
const PANEL_CHIPS_H = 212;
const PRICE_MAX = 150;
const PRICE_LH = 0.74;
const PRICE_TRACK = -0.027;
const PRICE_ROW_H = Math.round(PRICE_MAX * PRICE_LH);

/** Lo que cambia de un tipo de carrusel a otro (ver CAROUSEL_KINDS en lib/social/carousel-url). */
const KIND_TEXT: Record<CarouselKind, { title: (count: number) => [string, string]; subtitle: string }> = {
  bajas: {
    title: (count) => [`Top ${count}`, 'bajas de la semana'],
    subtitle: 'Confirmadas con nuestro historial de precios',
  },
};

function Header({ right }: { right: string[] }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: HEADER_H, flexShrink: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center' }}>
        <img src={LOGO_PNG} alt="" width={62} height={62} />
        <div style={{ display: 'flex', marginLeft: 14, fontSize: 50, fontWeight: 800, letterSpacing: -1.5 }}>
          <span>Compara</span>
          <span style={{ color: COLORS.cyan }}>Tech</span>
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', fontSize: 31, lineHeight: '36px', color: COLORS.muted }}>
        {right.map((line) => (
          <span key={line}>{line}</span>
        ))}
      </div>
    </div>
  );
}

/** El lienzo de cada lámina: el fondo con la luz de arriba, como las demás piezas. */
function Canvas({ children, glow = false }: { children: React.ReactNode; glow?: boolean }) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        position: 'relative',
        width: CAROUSEL_SIZE.width,
        height: CAROUSEL_SIZE.height,
        paddingTop: TOP,
        paddingLeft: MARGIN,
        paddingRight: MARGIN,
        fontFamily: 'Inter',
        color: COLORS.white,
        backgroundColor: COLORS.bg,
      }}
    >
      <div style={{ display: 'flex', position: 'absolute', left: 0, top: 0, width: 1080, height: 600, backgroundImage: 'linear-gradient(180deg, #0D1B36 0%, #070B14 100%)' }} />
      {glow ? (
        <div style={{ display: 'flex', position: 'absolute', left: 0, top: 420, width: 1080, height: 700, backgroundImage: 'radial-gradient(ellipse at 50% 45%, rgba(0,212,255,0.16) 0%, rgba(0,212,255,0) 65%)' }} />
      ) : null}
      {children}
    </div>
  );
}

function Chip({ text, icon }: { text: string; icon: string }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        height: 52,
        padding: '0 22px 0 18px',
        borderRadius: 26,
        fontSize: 31,
        fontWeight: 600,
        background: 'rgba(255,255,255,0.07)',
        border: '2px solid rgba(255,255,255,0.16)',
      }}
    >
      <img src={icon} alt="" width={28} height={28} />
      <div style={{ display: 'flex', marginLeft: 10 }}>{text}</div>
    </div>
  );
}

/** Lo que la lámina de un producto necesita: lo de la base (nombre, marca) y lo firmado en la dirección. */
export interface CarouselSlideProduct {
  name: string;
  brand?: string | null;
  ml_domain_id?: string | null;
  specs?: Record<string, unknown> | null;
  price: number;
  /** Cuánto bajó, según el historial propio. */
  dropAmount: number;
  /** Desde cuándo rige el precio de hoy. */
  dropSince: string;
  checkedAt: string | null;
  freeShipping: boolean;
  full: boolean;
}

/** El tamaño de "Bajó $X" para que quepa junto a la fecha. Puro. */
export function dropTextSize(text: string, room: number, max = 80): number {
  const spacing = -2;
  const em = textWidth(text, W800, 1);
  return Math.max(40, Math.min(max, Math.floor((room - spacing * [...text].length) / em)));
}

export function CarouselProductSlide({
  product,
  rank,
  photo,
}: {
  product: CarouselSlideProduct;
  rank: number;
  photo: string | null;
}) {
  const checked = chileDateTime(product.checkedAt);
  const since = chileDateTime(product.dropSince);
  const brand = product.brand?.trim();

  // El nombre de redes, sin la marca (va arriba, junto al puesto). Cortado, se dice con puntos suspensivos.
  const short = socialProductName(product, { max: 64, withBrand: !brand });
  const name = short.length < socialProductName(product, { max: 200, withBrand: !brand }).length ? `${short}…` : short;
  const title = fitName(name);
  const nameStyle = { fontSize: title.size, fontWeight: 600, lineHeight: `${title.line}px`, letterSpacing: NAME_SPACING };
  const titleH = KICKER_H + (title.rows ? title.rows.length : 2) * title.line;

  const digits = formatPrice(product.price).slice(1);
  const priceEm = textWidth(digits, W800, 1) + PRICE_TRACK * digits.length + 0.39;
  const priceSize = Math.min(PRICE_MAX, Math.floor((INNER_W - CARD_PAD * 2) / priceEm));

  // La franja: la flecha, "Bajó $X" y, a la derecha, desde qué día.
  const dropText = `Bajó ${formatPrice(product.dropAmount)}`;
  const sinceW = Math.max(textWidth('desde el', W600, 28), since ? textWidth(since.date, W800, 44) : 0);
  const dropSize = dropTextSize(dropText, INNER_W - CARD_PAD * 2 - 56 - 16 - 28 - sinceW);

  const hasChips = product.freeShipping || product.full;
  const cardH = CARD_BOTTOM - (TOP + HEADER_H + TITLE_GAP + titleH + CARD_GAP);
  const panelH = hasChips ? PANEL_CHIPS_H : PANEL_H;
  const photoH = cardH - HAIRLINE * 2 - DROP_BAND_H - panelH;
  const stage = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: INNER_W,
    height: photoH,
    borderTopLeftRadius: RADIUS - HAIRLINE,
    borderTopRightRadius: RADIUS - HAIRLINE,
  } as const;

  return (
    <Canvas>
      <Header right={[checked ? `Precio revisado ${checked.date} ${checked.time}` : 'Precio sujeto a cambios', 'Precios en Mercado Libre']} />

      {/* El puesto y la marca, y el nombre */}
      <div style={{ display: 'flex', flexDirection: 'column', height: titleH, marginTop: TITLE_GAP, marginBottom: CARD_GAP, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', height: KICKER_H, fontSize: 30, fontWeight: 800, lineHeight: '34px', letterSpacing: 5, textTransform: 'uppercase' }}>
          <span style={{ color: COLORS.white }}>{`#${rank}`}</span>
          {brand ? <span style={{ color: COLORS.muted, marginLeft: 16, marginRight: 12 }}>·</span> : null}
          {brand ? (
            <div style={{ display: 'block', color: COLORS.cyan, lineClamp: 1, maxWidth: CONTENT_W - 120 }}>{brand}</div>
          ) : null}
        </div>
        {title.rows ? (
          title.rows.map((row, i) => (
            <div key={i} style={{ display: 'flex', height: title.line, whiteSpace: 'nowrap', ...nameStyle }}>
              {row}
            </div>
          ))
        ) : (
          <div style={{ display: 'block', height: title.line * 2, overflow: 'hidden', lineClamp: 2, wordBreak: 'break-word', ...nameStyle }}>{name}</div>
        )}
      </div>

      {/* Tarjeta: foto, franja de la baja y precio. El fondo cian asoma 2 px por el borde: es el filete. */}
      <div style={{ display: 'flex', flexDirection: 'column', width: CONTENT_W, height: cardH, flexShrink: 0, padding: HAIRLINE, borderRadius: RADIUS, background: 'rgba(0,212,255,0.34)' }}>
        {photo ? (
          <div style={{ ...stage, background: COLORS.white }}>
            <img src={photo} alt="" width={INNER_W - CARD_PAD * 2} height={photoH - PHOTO_PAD * 2} style={{ objectFit: 'contain' }} />
          </div>
        ) : (
          <div style={{ ...stage, flexDirection: 'column', background: COLORS.surface }}>
            <img src={LOGO_PNG} alt="" width={168} height={168} />
            <div style={{ display: 'flex', marginTop: 28, fontSize: 28, fontWeight: 600, letterSpacing: 4, textTransform: 'uppercase', color: COLORS.muted }}>
              Foto no disponible
            </div>
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: INNER_W, height: DROP_BAND_H, padding: `0 ${CARD_PAD}px`, background: COLORS.green, color: COLORS.ink }}>
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <img src={ICON_DROP} alt="" width={56} height={56} />
            <div style={{ display: 'flex', marginLeft: 16, fontSize: dropSize, fontWeight: 800, letterSpacing: -2, lineHeight: 1 }}>{dropText}</div>
          </div>
          {since ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
              <div style={{ display: 'flex', fontSize: 28, fontWeight: 600, lineHeight: '32px' }}>desde el</div>
              <div style={{ display: 'flex', fontSize: 44, fontWeight: 800, lineHeight: '50px', letterSpacing: -1 }}>{since.date}</div>
            </div>
          ) : null}
        </div>

        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            width: INNER_W,
            height: panelH,
            padding: `0 ${CARD_PAD}px`,
            borderBottomLeftRadius: RADIUS - HAIRLINE,
            borderBottomRightRadius: RADIUS - HAIRLINE,
            backgroundColor: COLORS.surface,
            backgroundImage: 'linear-gradient(165deg, #12233F 0%, #0B1220 62%)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', height: PRICE_ROW_H }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', fontWeight: 800 }}>
              <div style={{ display: 'flex', fontSize: Math.round(priceSize * 0.5), lineHeight: PRICE_LH, marginTop: Math.round(priceSize * 0.04), marginRight: Math.round(priceSize * 0.05), color: COLORS.cyan }}>$</div>
              <div style={{ display: 'flex', fontSize: priceSize, lineHeight: PRICE_LH, letterSpacing: PRICE_TRACK * priceSize }}>{digits}</div>
            </div>
          </div>
          {hasChips ? (
            <div style={{ display: 'flex', gap: 14, marginTop: 20 }}>
              {product.freeShipping ? <Chip text="Envío gratis" icon={ICON_SHIPPING} /> : null}
              {product.full ? <Chip text="Full" icon={ICON_FULL} /> : null}
            </div>
          ) : null}
        </div>
      </div>
    </Canvas>
  );
}

const TILE = 252;
const TILE_GAP = 24;

/** Las fotos de la portada: de a tres por fila, centradas. */
function PhotoGrid({ photos }: { photos: (string | null)[] }) {
  const rows: (string | null)[][] = [];
  // 4 van de a dos: una fila de tres y una de uno se ve coja.
  const perRow = photos.length === 4 ? 2 : 3;
  for (let i = 0; i < photos.length; i += perRow) rows.push(photos.slice(i, i + perRow));
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: TILE_GAP, width: CONTENT_W }}>
      {rows.map((row, r) => (
        <div key={r} style={{ display: 'flex', gap: TILE_GAP }}>
          {row.map((photo, i) => (
            <div
              key={i}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: TILE, height: TILE, borderRadius: 28, background: photo ? COLORS.white : COLORS.surface }}
            >
              {photo ? <img src={photo} alt="" width={TILE - 36} height={TILE - 36} style={{ objectFit: 'contain' }} /> : <img src={LOGO_PNG} alt="" width={96} height={96} />}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

export function CarouselCover({
  kind,
  rangeLabel,
  photos,
}: {
  kind: CarouselKind;
  /** "del 12 al 18 de octubre". */
  rangeLabel: string;
  /** Una por producto, en orden. */
  photos: (string | null)[];
}) {
  const [big, rest] = KIND_TEXT[kind].title(photos.length);
  const range = `${rangeLabel.charAt(0).toUpperCase()}${rangeLabel.slice(1)}`;
  return (
    <Canvas>
      <Header right={['Precios en Mercado Libre']} />
      <div style={{ display: 'flex', flexDirection: 'column', marginTop: 30 }}>
        <div style={{ display: 'flex', fontSize: 170, fontWeight: 800, lineHeight: 0.82, letterSpacing: -7, color: COLORS.cyan }}>{big.toUpperCase()}</div>
        <div style={{ display: 'flex', marginTop: 20, fontSize: 76, fontWeight: 800, lineHeight: 1, letterSpacing: -2.5 }}>{rest}</div>
        <div style={{ display: 'flex', marginTop: 16, fontSize: 32, fontWeight: 600, color: COLORS.muted }}>{KIND_TEXT[kind].subtitle}</div>
      </div>
      <div style={{ display: 'flex', marginTop: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', height: 58, padding: '0 26px', borderRadius: 29, border: `2px solid ${COLORS.cyan}`, fontSize: 32, fontWeight: 600 }}>{range}</div>
      </div>
      <div style={{ display: 'flex', flex: 1, alignItems: 'center', justifyContent: 'center', marginBottom: 1350 - CARD_BOTTOM }}>
        <PhotoGrid photos={photos} />
      </div>
      {/* Fuera del cuadrado del centro: si Instagram corta la lámina, "Desliza" sobra (ya muestra los puntos). */}
      <div style={{ display: 'flex', position: 'absolute', right: MARGIN, top: 1238, alignItems: 'center', height: 64, padding: '0 28px 0 32px', borderRadius: 32, background: COLORS.cyan, color: COLORS.ink, fontSize: 34, fontWeight: 800 }}>
        <span>Desliza</span>
        <img src={ICON_NEXT} alt="" width={38} height={38} style={{ marginLeft: 12 }} />
      </div>
    </Canvas>
  );
}

export function CarouselClosing({ site, rangeLabel }: { site: string; rangeLabel: string }) {
  const siteSize = Math.min(104, Math.floor((CONTENT_W - 40) / textWidth(site, W800, 1)));
  return (
    <Canvas glow>
      <Header right={['Precios en Mercado Libre']} />
      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, alignItems: 'center', justifyContent: 'center', textAlign: 'center' }}>
        <div style={{ display: 'flex', fontSize: 72, fontWeight: 800, letterSpacing: -2 }}>¿Te interesa alguno?</div>
        <div style={{ display: 'flex', marginTop: 44, fontSize: 46, fontWeight: 600 }}>Link de compra en nuestro perfil</div>
        <div style={{ display: 'flex', marginTop: 40, fontSize: 38, fontWeight: 600, color: COLORS.muted }}>o búscalo en</div>
        <div style={{ display: 'flex', marginTop: 6, fontSize: siteSize, fontWeight: 800, letterSpacing: -3, color: COLORS.cyan }}>{site}</div>
      </div>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          textAlign: 'center',
          marginBottom: 1350 - CARD_BOTTOM,
          paddingTop: 28,
          borderTop: '2px solid rgba(255,255,255,0.12)',
          fontSize: 30,
          lineHeight: '40px',
          color: COLORS.muted,
        }}
      >
        <div style={{ display: 'flex' }}>{`Bajas registradas ${rangeLabel}.`}</div>
        <div style={{ display: 'flex' }}>Los precios cambian varias veces al día:</div>
        <div style={{ display: 'flex' }}>confirma el precio en Mercado Libre al comprar.</div>
      </div>
    </Canvas>
  );
}

// La flecha de "Bajó" (56 px) y la de "Desliza" (40 px), en tinta y al doble de tamaño. Las genera
// scripts/piezas/iconos.mjs, que tiene los SVG de origen.
const ICON_DROP = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAHAAAABwBAMAAAA0zul4AAAAMFBMVEVMaXEKDhYAACAJDRYJDhcJDRcJDRYKDhcJDRYJDRYKChYJDRYJDRYJDRUJDRYKDhfsxi/fAAAAD3RSTlMAZQe3a7yx/U3rFqHSKoG2Y0Y3AAAACXBIWXMAADOsAAAzrAE5r9DSAAAB6ElEQVRYw+2Wu04CQRSGFzSEYDShslwiCdHGQmNlgbWF2PAMljaa0Ik2FhT4BmtH6xOobwCtkcL4ChLNJiQj7GX2nNlz2JnpSObvdthvvzlzxfNcXFxcXNY/tfsHO+5KhN824IcQ4rdhAY4XoDgy56pLTvyYK7ci0EK5ISyViZFWbtcnLLgpeGV1LOZ9dhoDXrm7aL5hlY+sMu7MWVFf88pO1DxjlT6jLCXtxspO0myqTIUrlCVS6UvQTJkJDavsANBECYVGVfoIhMrB6fkKJRZC5VSIsM8rfQWcoaXdI2Y7VsrROlaVleVD+MwpZc/3rhXlKDdYsErwlZaiHEYPL8zAgo+UFWX806W6a+O3UbcVJQGW7tLX0dwoSgKUAzvHU9NESgqUSrwYsJICZZXK8kNVkiBWygWPlCSIthLYYrBKGoRKsKmhkgZhlfAYAVUyYKZEBxdQMmBWJT4qsyo5MFUqh3Om5MC0SvU6kFW+cWCszF1AUik4MFbmr7xWIbhUEv9eyu0i0PsMbqlbuFkIemW6tV0IMmnZgnBgjUCo1AQHJ90ogSE4FblogbXAEqwIS3BEgO864JAAn3RA3xYc2nb1gAC/dMCdPPfXMF2jSXp6K+5QXQHhRHN179dhLl4nnouLi4vL+ucfzZlLjTgEMRcAAAAASUVORK5CYII=';
const ICON_NEXT = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAFAAAABQBAMAAAB8P++eAAAAMFBMVEVMaXEJDRYJDBYAABwJDRcJDhYKDhYIDBgJDRcJDRcHDxcKDBYJDRcKDhYLDxYKDhehcNyOAAAAD3RSTlMAqm8Ju3n8P7nzIWTqjkPV2mqYAAAACXBIWXMAACTpAAAk6QFQJOf4AAAArElEQVRIx2NgGAUjGLB3ziggSuG2//+TiFHHlf///38FIhSyAtX9/0SEQkaQQmKM5P1PpJF8/4k1Up5YI00gRgYQVMjsD1b4ddTIUSOJNHKpIAY4D1b4F1Udd/5/XEAARWEZTnVoSb0ft8I/KArn41b4nzyFRFtNtGeIDh7cAf6V2ChUIDJRfBo1cNRAEgwkukIiuoojutIkuhomumInuqlAdOOD+ObMKBimAABcEe+VWXi6xAAAAABJRU5ErkJggg==';
