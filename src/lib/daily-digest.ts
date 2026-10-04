/**
 * Arma el resumen diario que se envía por correo.
 *
 * Vive en el servidor y no en el escenario de Make a propósito: los campos
 * de asunto y contenido del módulo de Gmail estaban vacíos, y por eso el
 * correo llegaba todos los días "(sin asunto)" y en blanco. Dejando el texto
 * acá, Make solo tiene que mapear dos campos y el contenido queda
 * versionado, revisable y probable como cualquier otro código.
 *
 * El correo existe para una sola cosa: que se apruebe lo que más paga. Antes
 * listaba primero lo más barato, que es justo lo que menos comisión deja, y
 * nada avisaba cuando pasaban días sin publicar. Ahora el asunto cambia
 * cuando el sitio lleva más de 3 días sin productos nuevos, y arriba va la
 * tanda que más deja con un botón directo a aprobarla.
 *
 * El HTML usa tablas y estilos en línea a propósito: los clientes de correo
 * no soportan flexbox ni hojas de estilo externas.
 */

import { formatCLP, formatDiscountPct } from '@/lib/format';
import { getCategoryInfo } from '@/lib/categories';
import { estimateCommission } from '@/lib/commission';

export interface DigestCandidate {
  name: string;
  price: number;
  category: string;
  image_url: string;
  seller_nickname: string | null;
  original_price?: number | null;
  /** Raíz de ML (migración 0018). Sin ella la comisión se estima con la tasa más baja. */
  ml_root_category?: string | null;
  /** Familia de ML: los colores de un mismo modelo la comparten. */
  ml_family_id?: string | null;
}

export type DigestAttribution = 'pendiente' | 'confirmada' | 'fallida';

export interface DigestInput {
  /** Entraron en las últimas 24 horas, de la que más comisión deja a la que menos. */
  newCandidates: DigestCandidate[];
  /** Los que más pagan de toda la cola de revisión, ya ordenados (máximo 10). */
  topToApprove: DigestCandidate[];
  pendingTotal: number;
  publishedTotal: number;
  /** Fuera del sitio y no se arreglan solos: el link lleva a otro producto. */
  needsLink: { name: string }[];
  /**
   * Fuera del sitio pero en pausa automática: Mercado Libre se quedó sin
   * vendedor para esa ficha, o el que tiene no es verde. Vuelven solos.
   */
  pausedCount: number;
  adminUrl: string;
  /** Días de calendario desde la última aprobación; null si no se sabe. */
  daysSinceLastApproval: number | null;
  /** A dónde lleva hoy el botón de compra del sitio. */
  linkMode: { directLinks: boolean; word: string | null };
  /** Resultado de la prueba de atribución de los links directos. */
  attribution: DigestAttribution;
  /** Minutos desde la revisión de precios más reciente; null si no se sabe. */
  lastPriceCheckMinutes: number | null;
  /** Clics hacia Mercado Libre ayer (hora de Chile); null si no se miden todavía. */
  clicsAyer: number | null;
  /** Consultas que fallaron al armar el correo. */
  errors: string[];
}

const BG = '#f4f6f9';
const CARD = '#ffffff';
const TEXT = '#0f172a';
const MUTED = '#64748b';
const BORDER = '#e2e8f0';
const ACCENT = '#0e7490';
const WARN_BG = '#fff7ed';
const WARN_BORDER = '#fed7aa';
const WARN_TEXT = '#9a3412';

/** Cuántos van en el bloque "Top 10 para aprobar hoy". */
export const TOP_TO_APPROVE = 10;

/**
 * Desde cuántos días sin aprobar nada el asunto pasa a avisarlo. Un fin de
 * semana sin publicar es normal; más que eso, el sitio se estanca y deja de
 * aparecer en búsquedas nuevas.
 */
export const STALE_APPROVAL_DAYS = 3;

/**
 * Elige entre singular y plural. Existe para no volver a escribir frases
 * como "4 productos salió del sitio": pluralizar solo el sustantivo con un
 * `${n === 1 ? '' : 's'}` deja el verbo en singular.
 */
function plural(count: number, singular: string, many: string): string {
  return count === 1 ? singular : many;
}

function categoryName(slug: string): string {
  return getCategoryInfo(slug)?.name ?? slug;
}

/** Comisión estimada de una venta del candidato, en pesos. */
export function candidateCommission(c: Pick<DigestCandidate, 'price' | 'ml_root_category'>): number {
  return estimateCommission(c.price, c.ml_root_category ?? null);
}

function discountOf(c: Pick<DigestCandidate, 'price' | 'original_price'>): number {
  return formatDiscountPct(c.price, c.original_price ?? null) ?? 0;
}

/**
 * De la que más comisión deja a la que menos; a igual comisión, el de mayor
 * descuento primero (es el que más fácil se vende). No modifica la lista.
 */
export function rankForApproval<T extends DigestCandidate>(candidates: T[]): T[] {
  return [...candidates].sort(
    (a, b) => candidateCommission(b) - candidateCommission(a) || discountOf(b) - discountOf(a)
  );
}

/**
 * Los primeros `max` de una lista ya ordenada, uno por familia: diez colores
 * del mismo iPhone no son diez decisiones distintas. El admin los agrupa
 * igual al revisar.
 */
export function pickTopToApprove<T extends DigestCandidate>(ranked: T[], max = TOP_TO_APPROVE): T[] {
  const families = new Set<string>();
  const top: T[] = [];
  for (const c of ranked) {
    if (top.length >= max) break;
    if (c.ml_family_id) {
      if (families.has(c.ml_family_id)) continue;
      families.add(c.ml_family_id);
    }
    top.push(c);
  }
  return top;
}

/** "86 de Computación · 10 de Audio · …", de la categoría con más a la con menos. */
function countByCategory(candidates: DigestCandidate[]): string {
  const counts = new Map<string, number>();
  for (const c of candidates) counts.set(c.category, (counts.get(c.category) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([slug, n]) => `${n} de ${categoryName(slug)}`)
    .join(' · ');
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Link del botón principal: la cola ordenada por lo que más paga. */
function approveUrl(adminUrl: string): string {
  return `${adminUrl}/admin/candidatos?orden=valor`;
}

/** "Modo de links: meli.la · matt_word=comparatech". */
export function linkModeLine(input: Pick<DigestInput, 'linkMode' | 'attribution'>): string {
  const { directLinks, word } = input.linkMode;
  const mode = directLinks
    ? `directos (${input.attribution === 'confirmada' ? 'atribución confirmada' : 'sin comprobar'})`
    : 'meli.la';
  return `Modo de links: ${mode}${word ? ` · matt_word=${word}` : ''}`;
}

/** "Salud: precios revisados hace 12 min". */
export function healthLine(minutes: number | null): string {
  return minutes === null
    ? 'Salud: no se sabe cuándo se revisaron los precios por última vez'
    : `Salud: precios revisados hace ${minutes} min`;
}

/** "⚠ Datos incompletos: falló productos publicados, clics de ayer". Vacío si no hubo errores. */
export function errorsLine(errors: string[]): string {
  return errors.length > 0 ? `⚠ Datos incompletos: falló ${errors.join(', ')}` : '';
}

function isStale(days: number | null): days is number {
  return days !== null && days > STALE_APPROVAL_DAYS;
}

export function buildDigestSubject(input: DigestInput): string {
  const { newCandidates, pendingTotal, needsLink, daysSinceLastApproval } = input;

  // Lo más caro de todo es no publicar: el ingreso sale de productos nuevos
  // en el sitio. Cuando eso pasa, el asunto lo dice antes que nada.
  if (isStale(daysSinceLastApproval)) {
    return (
      `ComparaTech · ${daysSinceLastApproval} días sin publicar · ` +
      `${pendingTotal} ${plural(pendingTotal, 'listo para aprobar', 'listos para aprobar')}`
    );
  }

  const parts: string[] = [];
  if (newCandidates.length > 0) {
    parts.push(`${newCandidates.length} ${plural(newCandidates.length, 'producto nuevo', 'productos nuevos')}`);
  }
  if (pendingTotal > 0) {
    parts.push(`${pendingTotal} por revisar`);
  }
  // Solo lo que requiere acción va al asunto. Antes decía "47 con
  // problema" sumando productos que se arreglan solos, y el número asustaba
  // sin decir qué hacer.
  if (needsLink.length > 0) {
    parts.push(`${needsLink.length} ${plural(needsLink.length, 'necesita link nuevo', 'necesitan link nuevo')}`);
  }

  return parts.length > 0 ? `ComparaTech · ${parts.join(' · ')}` : 'ComparaTech · sin novedades hoy';
}

function candidateRow(c: DigestCandidate): string {
  const discount = formatDiscountPct(c.price, c.original_price ?? null);
  return `
  <tr>
    <td style="padding:12px 0;border-bottom:1px solid ${BORDER};" valign="top" width="64">
      <img src="${escapeHtml(c.image_url)}" width="56" height="56" alt=""
           style="display:block;width:56px;height:56px;object-fit:contain;background:#fff;border:1px solid ${BORDER};border-radius:8px;">
    </td>
    <td style="padding:12px 0 12px 12px;border-bottom:1px solid ${BORDER};" valign="top">
      <div style="font-size:14px;color:${TEXT};font-weight:600;line-height:1.35;">${escapeHtml(c.name)}</div>
      <div style="font-size:12px;color:${MUTED};margin-top:3px;">
        ${escapeHtml(categoryName(c.category))}${c.seller_nickname ? ` · ${escapeHtml(c.seller_nickname)}` : ''}
      </div>
    </td>
    <td style="padding:12px 0;border-bottom:1px solid ${BORDER};text-align:right;white-space:nowrap;" valign="top">
      <div style="font-size:15px;color:${TEXT};font-weight:700;">${escapeHtml(formatCLP(c.price))}</div>
      <div style="font-size:12px;color:${ACCENT};font-weight:600;margin-top:3px;">
        Comisión est. ${escapeHtml(formatCLP(candidateCommission(c)))}${discount ? ` · -${discount}%` : ''}
      </div>
    </td>
  </tr>`;
}

export function buildDigestHtml(input: DigestInput): string {
  const {
    newCandidates,
    topToApprove,
    pendingTotal,
    publishedTotal,
    needsLink,
    pausedCount,
    adminUrl,
    daysSinceLastApproval,
    clicsAyer,
    errors,
  } = input;

  const top = topToApprove.slice(0, TOP_TO_APPROVE);
  const staleNote = isStale(daysSinceLastApproval)
    ? `<div style="font-size:13px;color:${WARN_TEXT};margin-top:8px;font-weight:600;">
         ${daysSinceLastApproval} días sin publicar productos nuevos
       </div>`
    : '';

  const errorsBlock =
    errors.length > 0
      ? `
      <div style="margin-top:20px;padding:10px 14px;background:${WARN_BG};border:1px solid ${WARN_BORDER};border-radius:10px;font-size:13px;color:${WARN_TEXT};line-height:1.5;">
        ${escapeHtml(errorsLine(errors))}. Los números de abajo pueden estar incompletos.
      </div>`
      : '';

  const heroSection =
    pendingTotal > 0
      ? `<div style="font-size:34px;font-weight:700;color:${TEXT};line-height:1;">${pendingTotal}</div>
         <div style="font-size:13px;color:${MUTED};margin-top:6px;">
           ${plural(pendingTotal, 'producto listo para aprobar', 'productos listos para aprobar')}
         </div>
         ${staleNote}
         <a href="${escapeHtml(approveUrl(adminUrl))}"
            style="display:inline-block;margin-top:14px;padding:10px 20px;background:${ACCENT};color:#fff;
                   font-size:14px;font-weight:600;text-decoration:none;border-radius:8px;">
           Aprobar la tanda de hoy
         </a>`
      : // Un "0" gigante con un botón al lado invita a entrar a una pantalla vacía.
        `<div style="font-size:15px;font-weight:600;color:${TEXT};">Cola de revisión al día</div>
         <div style="font-size:13px;color:${MUTED};margin-top:4px;">No queda nada pendiente por aprobar.</div>
         ${staleNote}`;

  const topSection =
    top.length > 0
      ? `
      <h2 style="font-size:15px;color:${TEXT};margin:28px 0 4px;">Top ${TOP_TO_APPROVE} para aprobar hoy</h2>
      <p style="font-size:13px;color:${MUTED};margin:0 0 4px;line-height:1.5;">
        Los que más comisión dejan por venta de toda la cola.
      </p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
        ${top.map(candidateRow).join('')}
      </table>
      <p style="font-size:13px;margin:12px 0 0;">
        <a href="${escapeHtml(approveUrl(adminUrl))}" style="color:${ACCENT};font-weight:600;">Aprobar la tanda de hoy →</a>
      </p>`
      : '';

  const newSection =
    newCandidates.length > 0
      ? `
      <h2 style="font-size:15px;color:${TEXT};margin:28px 0 4px;">Nuevos desde ayer (${newCandidates.length})</h2>
      <p style="font-size:13px;color:${MUTED};margin:0;line-height:1.5;">${escapeHtml(countByCategory(newCandidates))}</p>`
      : `
      <p style="font-size:14px;color:${MUTED};margin:28px 0 0;">
        Hoy no entraron productos nuevos. Los destacados de Mercado Libre cambian
        de a poco, así que hay días sin novedades.
      </p>`;

  // Lo único del correo que requiere acción además de aprobar: links que
  // llevan a otro producto. El resto de lo que está fuera del sitio vuelve
  // solo.
  const attentionSection =
    needsLink.length > 0
      ? `
      <div style="margin-top:28px;padding:14px 16px;background:${WARN_BG};border:1px solid ${WARN_BORDER};border-radius:10px;">
        <div style="font-size:14px;color:${WARN_TEXT};font-weight:600;">
          ${needsLink.length}
          ${plural(needsLink.length, 'producto necesita', 'productos necesitan')}
          un link nuevo
        </div>
        <div style="font-size:13px;color:${WARN_TEXT};margin-top:4px;line-height:1.5;">
          ${plural(
            needsLink.length,
            'Su link de afiliado abre otra ficha, así que el comprador vería otro producto.',
            'Sus links de afiliado abren otra ficha, así que el comprador vería otro producto.'
          )}
          Se arregla generando el link desde la ficha correcta y guardándolo en el admin.
        </div>
        <ul style="margin:8px 0 0;padding-left:18px;font-size:13px;color:${WARN_TEXT};">
          ${needsLink.map((p) => `<li style="margin:2px 0;">${escapeHtml(p.name)}</li>`).join('')}
        </ul>
        <a href="${escapeHtml(adminUrl)}/admin/problemas"
           style="display:inline-block;margin-top:10px;font-size:13px;font-weight:600;color:${WARN_TEXT};">
          Resolver en el admin →
        </a>
      </div>`
      : '';

  const pausedNote =
    pausedCount > 0
      ? `
      <p style="font-size:13px;color:${MUTED};margin:20px 0 0;line-height:1.5;">
        ${pausedCount} ${plural(pausedCount, 'producto está', 'productos están')} en pausa automática:
        Mercado Libre se quedó sin vendedor verde para esa ficha.
        ${plural(pausedCount, 'Vuelve', 'Vuelven')} a publicarse solos, sin que hagas nada.
      </p>`
      : '';

  const clicksLine =
    clicsAyer === null
      ? ''
      : `<br>${clicsAyer} ${plural(clicsAyer, 'clic', 'clics')} hacia Mercado Libre ayer.`;

  return `<!doctype html>
<html lang="es">
<body style="margin:0;padding:24px 12px;background:${BG};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0"
             style="border-collapse:collapse;max-width:600px;width:100%;background:${CARD};border:1px solid ${BORDER};border-radius:14px;">
        <tr><td style="padding:24px 24px 0;">

          <div style="font-size:18px;font-weight:700;color:${TEXT};">
            Compara<span style="color:${ACCENT};">Tech</span>
          </div>
          <div style="font-size:13px;color:${MUTED};margin-top:2px;">Qué aprobar hoy</div>

          ${errorsBlock}

          <div style="margin-top:20px;padding:18px;background:${BG};border-radius:10px;text-align:center;">
            ${heroSection}
          </div>

          ${topSection}
          ${newSection}
          ${attentionSection}
          ${pausedNote}

          <p style="font-size:12px;color:${MUTED};margin:28px 0 24px;border-top:1px solid ${BORDER};padding-top:16px;line-height:1.6;">
            ${publishedTotal} ${plural(publishedTotal, 'producto publicado', 'productos publicados')} en el sitio.${clicksLine}<br>
            ${escapeHtml(linkModeLine(input))}<br>
            ${escapeHtml(healthLine(input.lastPriceCheckMinutes))}
          </p>

        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

export function buildDigestText(input: DigestInput): string {
  const {
    newCandidates,
    topToApprove,
    pendingTotal,
    publishedTotal,
    needsLink,
    pausedCount,
    adminUrl,
    daysSinceLastApproval,
    clicsAyer,
    errors,
  } = input;

  const lines = [`ComparaTech — qué aprobar hoy`, ``];
  if (errors.length > 0) lines.push(errorsLine(errors), ``);
  if (isStale(daysSinceLastApproval)) lines.push(`${daysSinceLastApproval} días sin publicar productos nuevos.`);

  lines.push(
    `${pendingTotal} ${plural(pendingTotal, 'producto listo', 'productos listos')} para aprobar.`,
    `Aprobar la tanda de hoy: ${approveUrl(adminUrl)}`,
    ``
  );

  const top = topToApprove.slice(0, TOP_TO_APPROVE);
  if (top.length > 0) {
    lines.push(`Top ${TOP_TO_APPROVE} para aprobar hoy:`);
    for (const c of top) {
      const discount = formatDiscountPct(c.price, c.original_price ?? null);
      lines.push(
        `  - ${c.name} — ${formatCLP(c.price)} · Comisión est. ${formatCLP(candidateCommission(c))}` +
          `${discount ? ` · -${discount}%` : ''} (${categoryName(c.category)})`
      );
    }
    lines.push('');
  }

  if (newCandidates.length > 0) {
    lines.push(`Nuevos desde ayer (${newCandidates.length}): ${countByCategory(newCandidates)}`);
  } else {
    lines.push('Hoy no entraron productos nuevos.');
  }

  if (needsLink.length > 0) {
    lines.push('', `${needsLink.length} ${plural(needsLink.length, 'producto necesita', 'productos necesitan')} un link nuevo: ${adminUrl}/admin/problemas`);
    needsLink.forEach((p) => lines.push(`  - ${p.name}`));
  }
  if (pausedCount > 0) {
    lines.push('', `${pausedCount} ${plural(pausedCount, 'producto en pausa automática', 'productos en pausa automática')} (vuelven solos).`);
  }

  lines.push('', `${publishedTotal} ${plural(publishedTotal, 'producto publicado', 'productos publicados')} en el sitio.`);
  if (clicsAyer !== null) lines.push(`${clicsAyer} ${plural(clicsAyer, 'clic', 'clics')} hacia Mercado Libre ayer.`);
  lines.push(linkModeLine(input), healthLine(input.lastPriceCheckMinutes));
  return lines.join('\n');
}
