/* eslint-disable @next/next/no-img-element -- esto lo dibuja next/og, que solo entiende <img> */
/**
 * La imagen "Cupones de Mercado Libre" para Instagram y Facebook: feed
 * (1080x1350) e historia (1080x1920), con la letra y los colores de las
 * piezas del sitio. Es la misma que se publicó a mano el 26-10-2026, ahora
 * armada por el sitio (/social/cupones).
 *
 * Sin emojis ni letras fuera de Inter (next/og los bajaría de otro servidor),
 * sin "Publicidad" ni la comisión. La historia deja libres las franjas de
 * arriba y de abajo, donde Instagram pone su barra y la respuesta.
 *
 * Necesita Inter en 400, 600 y 800 (lib/content/og-fonts).
 */
import { LOGO_PNG, W600, W800, textWidth } from '@/lib/content/offer-template';
import { COUPON_FOOTER, couponConditionText, couponDayLabel, couponDiscountText, type Coupon } from '@/lib/social/coupons';
import type { CouponFormat } from '@/lib/social/coupons-url';

export const COUPON_SIZES: Record<CouponFormat, { width: number; height: number }> = {
  feed: { width: 1080, height: 1350 },
  historia: { width: 1080, height: 1920 },
};

const C = { bg: '#070B14', surface: '#0B1220', cyan: '#00D4FF', white: '#FFFFFF', muted: '#94A3B8', border: '#1E2A44' };
const PAD_X = 80;
const BORDER = 3;
const STRIPE = 14;
const CARD_PAD_X = 40;
/** Lo que queda para el texto dentro de una tarjeta. */
const CARD_TEXT_W = 1080 - PAD_X * 2 - STRIPE - BORDER - CARD_PAD_X * 2;

interface Layout {
  padTop: number;
  padBottom: number;
  title: number;
  cardsTop: number;
  gap: number;
  cardPadY: number;
  code: number;
  discount: number;
  condition: number;
}

function layoutFor(format: CouponFormat, k: number): Layout {
  const story = format === 'historia';
  return {
    padTop: story ? 220 : 100,
    padBottom: story ? 260 : 80,
    title: story ? 92 : 80,
    cardsTop: Math.round((story ? 90 : 44) * k),
    gap: Math.round((story ? 34 : 22) * k),
    cardPadY: Math.round((story ? 30 : 24) * k),
    code: Math.round(66 * (story ? 1 : 0.86) * k),
    discount: Math.round(40 * k),
    condition: Math.round(34 * k),
  };
}

/** Cuántas líneas ocupa un texto en el ancho de la tarjeta (contado con la letra 600: un poco de más). */
function lines(text: string, size: number): number {
  if (!text) return 0;
  const words = text.split(' ');
  let count = 1;
  let row = '';
  for (const word of words) {
    const next = row ? `${row} ${word}` : word;
    if (row && textWidth(next, W600, size) > CARD_TEXT_W) {
      count += 1;
      row = word;
    } else {
      row = next;
    }
  }
  return count;
}

function estimateHeight(coupons: Coupon[], format: CouponFormat, l: Layout): number {
  const header = 56 + 22 + l.title * 1.08 * 2 + 18 + 40 * 1.2;
  const footer = 31 * 1.35 * 2;
  const cards = coupons.reduce((sum, c) => {
    const discountLines = lines(couponDiscountText(c), l.discount);
    const conditionLines = lines(couponConditionText(c), l.condition);
    return (
      sum +
      BORDER * 2 +
      l.cardPadY * 2 +
      l.code * 1.2 +
      8 +
      discountLines * l.discount * 1.25 +
      (conditionLines ? 4 + conditionLines * l.condition * 1.3 : 0)
    );
  }, 0);
  return l.padTop + header + l.cardsTop + cards + l.gap * (coupons.length - 1) + 32 + footer + l.padBottom;
}

/** El tamaño más grande que deja todo dentro de la imagen. */
export function couponLayout(coupons: Coupon[], format: CouponFormat): Layout {
  let l = layoutFor(format, 1);
  for (let k = 1; k >= 0.6; k -= 0.04) {
    l = layoutFor(format, k);
    if (estimateHeight(coupons, format, l) <= COUPON_SIZES[format].height) return l;
  }
  return l;
}

export function CouponPiece({ coupons, day, format }: { coupons: Coupon[]; day: number; format: CouponFormat }) {
  const { width, height } = COUPON_SIZES[format];
  const l = couponLayout(coupons, format);
  const fix = { display: 'flex', flexShrink: 0 } as const;
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        width,
        height,
        background: C.bg,
        backgroundImage: 'linear-gradient(180deg, #0D1B36 0%, #070B14 55%)',
        padding: `${l.padTop}px ${PAD_X}px ${l.padBottom}px`,
        fontFamily: 'Inter',
        color: C.white,
      }}
    >
      <div style={{ ...fix, alignItems: 'center', height: 56 }}>
        <img src={LOGO_PNG} alt="" width={56} height={56} />
        <div style={{ display: 'flex', marginLeft: 16, fontSize: 34, fontWeight: 600, color: C.cyan, letterSpacing: 1 }}>comparatech.cl</div>
      </div>
      <div style={{ ...fix, marginTop: 22, fontSize: l.title, fontWeight: 800, lineHeight: 1.08 }}>Cupones de</div>
      <div style={{ ...fix, fontSize: l.title, fontWeight: 800, lineHeight: 1.08 }}>Mercado Libre</div>
      <div style={{ ...fix, marginTop: 18, fontSize: 40, lineHeight: 1.2, fontWeight: 600, color: C.muted }}>
        {`Para hoy, ${couponDayLabel(day)}`}
      </div>
      <div style={{ ...fix, flexDirection: 'column', marginTop: l.cardsTop }}>
        {coupons.map((c, i) => {
          const condition = couponConditionText(c);
          // Un código muy largo se achica para que no se salga de la tarjeta.
          const codeSize = Math.min(l.code, Math.floor((l.code * CARD_TEXT_W) / textWidth(c.code, W800, l.code, 2)));
          return (
            <div
              key={c.code}
              style={{
                ...fix,
                flexDirection: 'column',
                marginTop: i === 0 ? 0 : l.gap,
                background: C.surface,
                border: `${BORDER}px solid ${C.border}`,
                borderLeft: `${STRIPE}px solid ${C.cyan}`,
                borderRadius: 28,
                padding: `${l.cardPadY}px ${CARD_PAD_X}px`,
              }}
            >
              <div style={{ display: 'flex', fontSize: codeSize, lineHeight: 1.2, fontWeight: 800, color: C.cyan, letterSpacing: 2 }}>{c.code}</div>
              <div style={{ display: 'flex', marginTop: 8, fontSize: l.discount, lineHeight: 1.25, fontWeight: 600 }}>{couponDiscountText(c)}</div>
              {condition && (
                <div style={{ display: 'flex', marginTop: 4, fontSize: l.condition, lineHeight: 1.3, color: C.muted }}>{condition}</div>
              )}
            </div>
          );
        })}
      </div>
      <div style={{ display: 'flex', flexGrow: 1, minHeight: 32 }} />
      <div style={{ ...fix, fontSize: 31, lineHeight: 1.35, color: C.muted }}>{COUPON_FOOTER}</div>
    </div>
  );
}

