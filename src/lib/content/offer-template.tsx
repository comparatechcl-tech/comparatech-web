/* eslint-disable @next/next/no-img-element -- esto lo dibuja next/og, que solo entiende <img> */
/**
 * La pieza de una oferta para redes, en sus dos formatos: la historia
 * (1080x1920) y la publicación del feed (1080x1350). Es la misma tarjeta en
 * los dos: la foto, la franja del descuento y el bloque del precio, bajo una
 * cabecera con la marca y la hora del precio. La dibuja next/og igual que el
 * resto de las piezas (lib/content/og-template), con las mismas reglas: la
 * foto de Mercado Libre entera y sin nada encima, descuento y etiquetas solo
 * si son ciertos, y siempre la hora del precio.
 *
 * El alto se reparte con cuentas, no con suerte: el nombre se mide con los
 * anchos reales de Inter para saber si va en uno o dos renglones (y dónde
 * cortarlo), y la foto se queda con todo lo que sobra. La tarjeta termina
 * siempre en el mismo punto de cada formato (ver FRAMES).
 *
 * Se dibuja a pedido en un servidor chico, y tres cosas le salen caras al
 * dibujante: las sombras difuminadas, los recortes (overflow con esquinas
 * redondas) y cada <svg> en línea. Por eso aquí no hay sombras ni recortes
 * (cada pieza de la tarjeta redondea sus propias esquinas), los degradados
 * ocupan solo la zona donde se ven, y el logo y los íconos van como PNG (al
 * final del archivo).
 *
 * Necesita Inter en 400, 600 y 800 (lib/content/og-fonts).
 */
import { socialProductName } from '@/lib/content/social-name';
import { captionDiscount, chileDateTime, formatPrice } from '@/lib/content/captions';
import type { OgProduct } from '@/lib/content/og-template';

const COLORS = {
  bg: '#070B14',
  surface: '#0B1220',
  cyan: '#00D4FF',
  ink: '#0A0E17',
  white: '#FFFFFF',
  muted: '#94A3B8',
};
const INK_SOFT = 'rgba(10,14,23,0.7)'; // la cifra tachada va más apagada que su etiqueta ("sin descuento")
const MINUS = String.fromCharCode(0x2212); // el signo menos de verdad, no el guion

// Anchos de avance de Inter en milésimas de em, del espacio (32) a la virgulilla (126).
// OJO: si cambian los archivos de lib/content/fonts hay que regenerarlos con scripts/piezas/medir-fuente.mjs:
// de ellos dependen el corte del nombre y el tamaño del precio.
export const W600 = [252,321,523,644,650,1004,663,326,373,373,540,673,319,465,319,379,660,423,623,636,666,612,640,576,640,640,319,329,673,673,673,543,999,728,659,737,722,605,588,749,746,277,580,703,565,922,759,769,645,773,652,650,660,736,728,1020,720,713,652,373,379,373,481,469,351,574,624,583,624,591,389,625,612,262,262,569,262,900,612,609,624,624,397,549,353,612,587,839,569,588,566,455,359,455,673];
export const W800 = [219,358,586,655,660,1029,683,354,382,382,583,686,353,471,353,400,692,441,638,657,688,634,662,588,664,662,353,360,686,686,686,579,1036,770,665,744,723,610,585,752,749,286,590,738,565,943,766,773,652,782,662,660,677,727,770,1059,761,752,679,382,400,382,493,484,382,588,638,595,638,601,410,639,635,283,283,593,283,927,635,619,638,638,420,573,382,635,615,863,594,618,581,486,388,486,686];

/** Ancho de un texto en px. Las letras con tilde miden lo que su letra base; lo desconocido se cuenta ancho. */
export function textWidth(text: string, table: number[], size: number, letterSpacing = 0): number {
  let thousandths = 0;
  let count = 0;
  for (const ch of text) {
    const base = ch.normalize('NFD').codePointAt(0) ?? 0;
    thousandths += table[base - 32] ?? 1000;
    count += 1;
  }
  return (thousandths / 1000) * size + letterSpacing * count;
}

export type OfferFormat = 'story' | 'feed';

/** Lo único que cambia de un formato a otro: el alto, y dónde empieza y dónde termina el contenido. */
interface Frame {
  height: number;
  /** Dónde empieza la cabecera. */
  top: number;
  /** Dónde termina la tarjeta. */
  cardBottom: number;
  /** Luz bajo la tarjeta, para cuando queda espacio libre debajo. */
  glow: boolean;
}

const FRAMES: Record<OfferFormat, Frame> = {
  // Instagram tapa los primeros 250 px y los últimos 300 de una historia: se ve de y=250 a y=1620. La
  // tarjeta termina en 1420 y deja 200 px vacíos para el sticker de enlace que se pone a mano en la app
  // (ver /admin/historias). Ese lugar no lleva texto ni flechas: la misma imagen se publica a veces sin
  // sticker y tiene que verse terminada; para eso está la luz.
  story: { height: 1920, top: 270, cardBottom: 1420, glow: true },
  // La publicación del feed se ve entera: el contenido llega de margen a margen. Arriba son 66 y no 72
  // porque la tinta de la cabecera empieza unos px más abajo que su caja.
  feed: { height: 1350, top: 66, cardBottom: 1278, glow: false },
};

// Reparto vertical.
const MARGIN = 72;
const CONTENT_W = 1080 - MARGIN * 2; // 936
const HEADER_H = 72;
const TITLE_GAP = 20; // de la cabecera a la marca del producto
const CARD_GAP = 32; // del nombre a la tarjeta
const RADIUS = 44;
const HAIRLINE = 2; // filete cian que rodea la tarjeta
const INNER_W = CONTENT_W - HAIRLINE * 2; // ancho de las piezas de la tarjeta
const CARD_PAD = 44; // aire lateral dentro de la tarjeta
const PHOTO_PAD = 12; // aire sobre y bajo la foto
const BAND_H = 110; // franja del descuento
const RULE_H = 8; // sin descuento, la franja queda en un filete cian grueso
const PANEL_H = 172; // bloque del precio...
const PANEL_CHIPS_H = 252; // ...y con la fila de etiquetas, con aire arriba y abajo (el dueño, 20-10-2026)

// Nombre: solo dos tamaños, y casi iguales, para que las piezas de un mismo día se vean como una serie.
const NAME_SPACING = -0.5;
const ONE_LINE = { size: 52, line: 60 };
const TWO_LINES = { size: 50, line: 56 };
const FALLBACK = [{ size: 46, line: 52 }, { size: 42, line: 48 }]; // solo si ni a 50 cabe en dos renglones
const KICKER_H = 40;

// Precio: el "$" va chico y arriba, en cian; las cifras mandan.
const PRICE_MAX = 150;
const PRICE_LH = 0.74; // con este interlineado la caja del texto mide lo que miden las cifras (0,727 em en Inter)
const PRICE_TRACK = -0.027; // interletrado de las cifras, en em
const PRICE_ROW_H = Math.round(PRICE_MAX * PRICE_LH);

const NUMBER_RE = /^\d+([.,]\d+)?$/;
const UNIT_RE = /^(gb|tb|mb|kg|g|lt|l|ml|cc|cm|mm|m|w|hz|mah|v|btu|mp|fps|k|pulgadas|litros|kilos|watts)$/i;
const CONNECTORS = new Set(['de', 'del', 'la', 'el', 'los', 'las', 'con', 'sin', 'y', 'e', 'o', 'u', 'a', 'en', 'para', 'por']);

/**
 * Cómo va el nombre: en un renglón si cabe; si no, en dos renglones parejos. `rows: null` es el último
 * recurso (una palabra más ancha que el renglón): ahí corta el dibujante y pone puntos suspensivos.
 */
export function fitName(name: string): { size: number; line: number; rows: string[] | null } {
  const max = CONTENT_W - 8;
  const width = (text: string, size: number) => textWidth(text, W600, size, NAME_SPACING);
  if (width(name, ONE_LINE.size) <= max) return { ...ONE_LINE, rows: [name] };
  const words = name.split(' ');
  for (const step of [TWO_LINES, ...FALLBACK]) {
    let best: string[] | null = null;
    let bestCost = Infinity;
    for (let i = 1; i < words.length; i++) {
      const first = words.slice(0, i).join(' ');
      const second = words.slice(i).join(' ');
      const w1 = width(first, step.size);
      const w2 = width(second, step.size);
      if (w1 > max || w2 > max) continue;
      // Parejos, pero sin dejar un "de" o un "con" colgando al final del primer renglón, ni separar
      // un número de su unidad ("578 | lt") o un modelo de su número ("Ryzen | 7").
      const prev = words[i - 1];
      const next = words[i];
      let penalty = 0;
      if (CONNECTORS.has(prev.toLowerCase())) penalty = 120;
      else if (NUMBER_RE.test(prev) && UNIT_RE.test(next)) penalty = 250;
      else if (/^\d{1,2}$/.test(next) && /^[A-Za-zÁÉÍÓÚÑáéíóúñ]+$/.test(prev)) penalty = 200;
      const cost = Math.abs(w1 - w2) + penalty;
      if (cost < bestCost) {
        bestCost = cost;
        best = [first, second];
      }
    }
    if (best) return { ...step, rows: best };
  }
  return { ...FALLBACK[1], rows: null };
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

export function OfferTemplate({
  product,
  photo,
  format,
}: {
  product: OgProduct;
  photo: string | null;
  format: OfferFormat;
}) {
  const frame = FRAMES[format];
  const discount = captionDiscount(product);
  const hasList = discount > 0 && !!product.original_price;
  const checked = chileDateTime(product.price_checked_at);
  const brand = product.brand?.trim();
  const freeShipping = product.offer_info?.free_shipping === true;
  const full = product.offer_info?.is_full === true;
  const hasChips = freeShipping || full;

  // Si hubo que cortar el nombre, se dice con puntos suspensivos: "… Astro Bot y Gran" a secas parece un error.
  // El nombre de redes (tipo y modelo si parte con un código), sin la marca, que ya va arriba.
  const short = socialProductName(product, { max: 64, withBrand: !brand });
  const name = short.length < socialProductName(product, { max: 200, withBrand: !brand }).length ? `${short}…` : short;
  const title = fitName(name);
  const nameStyle = { fontSize: title.size, fontWeight: 600, lineHeight: `${title.line}px`, letterSpacing: NAME_SPACING };
  const titleH = (brand ? KICKER_H : 0) + (title.rows ? title.rows.length : 2) * title.line;

  // Precio: las cifras lo más grandes que quepan en el panel, con tope. El "$" va a la mitad del tamaño
  // (0,39 em = su ancho más la separación).
  const digits = formatPrice(product.price).slice(1);
  const priceEm = textWidth(digits, W800, 1) + PRICE_TRACK * digits.length + 0.39;
  const priceSize = Math.min(PRICE_MAX, Math.floor((INNER_W - CARD_PAD * 2) / priceEm));

  // La tarjeta empieza donde termina el nombre y acaba siempre en el mismo punto; la foto ocupa lo que quede.
  const cardH = frame.cardBottom - (frame.top + HEADER_H + TITLE_GAP + titleH + CARD_GAP);
  const bandH = hasList ? BAND_H : RULE_H;
  const panelH = hasChips ? PANEL_CHIPS_H : PANEL_H;
  const photoH = cardH - HAIRLINE * 2 - bandH - panelH;
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
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        position: 'relative',
        width: 1080,
        height: frame.height,
        paddingTop: frame.top,
        paddingLeft: MARGIN,
        paddingRight: MARGIN,
        fontFamily: 'Inter',
        color: COLORS.white,
        backgroundColor: COLORS.bg,
      }}
    >
      {/* Luz desde arriba, pareja de lado a lado. Llega hasta donde empieza la tarjeta: más abajo no se vería. */}
      <div style={{ display: 'flex', position: 'absolute', left: 0, top: 0, width: 1080, height: 600, backgroundImage: 'linear-gradient(180deg, #0D1B36 0%, #070B14 100%)' }} />
      {/* Luz bajo la tarjeta: la historia se ve terminada aunque no lleve el sticker del enlace */}
      {frame.glow ? <div style={{ display: 'flex', position: 'absolute', left: 0, top: frame.cardBottom - 70, width: 1080, height: 400, backgroundImage: 'radial-gradient(ellipse at 50% 22%, rgba(0,212,255,0.2) 0%, rgba(0,212,255,0) 68%)' }} /> : null}

      {/* Marca a la izquierda, datos del precio a la derecha */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: HEADER_H, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <img src={LOGO_PNG} alt="" width={62} height={62} />
          <div style={{ display: 'flex', marginLeft: 14, fontSize: 50, fontWeight: 800, letterSpacing: -1.5 }}>
            <span>Compara</span>
            <span style={{ color: COLORS.cyan }}>Tech</span>
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', fontSize: 31, lineHeight: '36px', color: COLORS.muted }}>
          <span>{checked ? `Precio revisado ${checked.date} ${checked.time}` : 'Precio sujeto a cambios'}</span>
          <span>Precios en Mercado Libre</span>
        </div>
      </div>

      {/* Marca del producto y nombre */}
      <div style={{ display: 'flex', flexDirection: 'column', height: titleH, marginTop: TITLE_GAP, marginBottom: CARD_GAP, flexShrink: 0 }}>
        {brand ? (
          <div style={{ display: 'block', height: KICKER_H, fontSize: 30, fontWeight: 800, lineHeight: '34px', color: COLORS.cyan, textTransform: 'uppercase', letterSpacing: 5, lineClamp: 1 }}>
            {brand}
          </div>
        ) : null}
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

      {/* Tarjeta de la oferta: foto, franja del descuento y precio. El fondo cian asoma 2 px por el borde: es el filete. */}
      <div style={{ display: 'flex', flexDirection: 'column', width: CONTENT_W, height: cardH, flexShrink: 0, padding: HAIRLINE, borderRadius: RADIUS, background: 'rgba(0,212,255,0.34)' }}>
        {photo ? (
          // La foto va entera, sobre blanco y sin nada encima
          <div style={{ ...stage, background: COLORS.white }}>
            <img src={photo} alt="" width={INNER_W - CARD_PAD * 2} height={photoH - PHOTO_PAD * 2} style={{ objectFit: 'contain' }} />
          </div>
        ) : (
          // Sin foto: un fondo oscuro con el logo se lee como algo pensado, no como una imagen rota
          <div style={{ ...stage, flexDirection: 'column', background: COLORS.surface }}>
            <img src={LOGO_PNG} alt="" width={168} height={168} />
            <div style={{ display: 'flex', marginTop: 28, fontSize: 28, fontWeight: 600, letterSpacing: 4, textTransform: 'uppercase', color: COLORS.muted }}>
              Foto no disponible
            </div>
          </div>
        )}

        {hasList ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: INNER_W, height: bandH, padding: `0 ${CARD_PAD}px`, background: COLORS.cyan, color: COLORS.ink }}>
            <div style={{ display: 'flex', marginLeft: -7, fontSize: 98, fontWeight: 800, letterSpacing: -3.5, lineHeight: 1 }}>{`${MINUS}${discount}%`}</div>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
              {/* La cifra tachada la pone el vendedor: "sin descuento", nunca "antes" ni "precio normal" */}
              <div style={{ display: 'flex', fontSize: 28, fontWeight: 600, lineHeight: '34px' }}>sin descuento</div>
              {/* Tachado con una línea propia de 3 px: la del dibujante es más gruesa y se come las cifras */}
              <div style={{ display: 'flex', position: 'relative', fontSize: 40, fontWeight: 600, lineHeight: '46px', color: INK_SOFT }}>
                <span>{formatPrice(product.original_price as number)}</span>
                <div style={{ display: 'flex', position: 'absolute', left: -5, right: -5, top: 22, height: 3, background: INK_SOFT }} />
              </div>
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', width: INNER_W, height: bandH, background: COLORS.cyan }} />
        )}

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
          {/* La fila mide siempre lo mismo: un precio de 8 cifras se achica un poco y queda centrado en ella */}
          <div style={{ display: 'flex', alignItems: 'center', height: PRICE_ROW_H }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', fontWeight: 800 }}>
              <div style={{ display: 'flex', fontSize: Math.round(priceSize * 0.5), lineHeight: PRICE_LH, marginTop: Math.round(priceSize * 0.04), marginRight: Math.round(priceSize * 0.05), color: COLORS.cyan }}>$</div>
              <div style={{ display: 'flex', fontSize: priceSize, lineHeight: PRICE_LH, letterSpacing: PRICE_TRACK * priceSize }}>{digits}</div>
            </div>
          </div>
          {hasChips ? (
            <div style={{ display: 'flex', gap: 16, marginTop: 26 }}>
              {freeShipping ? <Chip text="Envío gratis" icon={ICON_SHIPPING} /> : null}
              {full ? <Chip text="Full" icon={ICON_FULL} /> : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

// Logo del sitio (186 px) e íconos de las etiquetas (56 px) en PNG. Los genera
// scripts/piezas/iconos.mjs, que tiene los SVG de origen.
export const LOGO_PNG = 'data:image/png;base64,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';
export const ICON_SHIPPING = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADgAAAA4BAMAAABaqCYtAAAAMFBMVEVMaXEA0/8A0/8A1P8A1P8A1f8A0/8A1P8A1P8A1P8A1P8A1P8A1f8A1P8A1P8A1P/rr3ElAAAAD3RSTlMA5Yg83UYLwa1gd/An4xsF/uXoAAAACXBIWXMAABnWAAAZ1gEY0crtAAABQElEQVQ4y2NgGAUUAWYlZKCMKjn/PwqYgCLpjyrpgCIpjyopQIrkD7hzNDAlPyNcTjPJraFAcACHJBj8SMAj+b8Mn+T3BDySMK1okl9cXFz84VqxeIULrhWbP9fDtGKThGvFGkIwrVglYVqxhy1Q6yeckkCtX3DHiv7/j7gl7SmW/OgCA46QsAUBeagkDgCSvI9L8i9Qsh6X5Heg5FlckneAkmymoff/f5wKNGAqKOFFArVEyv//GxoMTSn//39lSPz/PwDEZv3/X4wh/v9/mO/Y/v//x8AOzZqc//8XMLz//x+WOBn2///FcB6h8w8wTn7DA6b///+O/VDFQGN+dwCTNVwyHpLM4Sr/gxwBAxxg/j4I5zWY0wCXZAMFxG8DaODvR0rxIJAEFOiBcU4AFaoh58PMRXMQnJNa0wauWAQAfCC0jCXUxHQAAAAASUVORK5CYII=';
export const ICON_FULL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADgAAAA4BAMAAABaqCYtAAAAMFBMVEVMaXEA1f8A0/8A1P8A1f8A1P8A1P8A0/8A0/8A1P8A0/8A0v8A1P8A1f8A1f8A1P+dE9ktAAAAD3RSTlMAQwvaMua9aqr4gRaSKVDLk0NWAAAACXBIWXMAABnWAAAZ1gEY0crtAAABDElEQVQ4y62VOwrCQBRFR8EPioUrME1qxdpC3IBLUHABZge6AxHsXUKwsLATV2Blq2vwgwmI19GAM+R5B4uc9hThzNwkSmXEoeNRVx1gS2URaFEZOmQOwJTJtZb0mWMtA+Iq2uFEZOMtuzRS49FIIOaRwIVHAhGPBB48ErjzSODJI4ErjwTONFIzr3/oyUjDbS8iLYYi0qIlIi22ItJw8USkYSEjDYGM/BLxSKDtiIytIflpad9bPy3t1W8ckaq0pJGaVXJPoYw0TOAYYCgiLWYi8s9xqoGINORlpKH2IzJ1/uS1LznesmRIbSLLPDIZy519hQqu71eTRmqONDJZS0ClTyPfxzfaZfU3UC/KsaRCB2mrRwAAAABJRU5ErkJggg==';
