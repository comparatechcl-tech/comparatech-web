/**
 * Arma el resumen diario que se envía por correo.
 *
 * Vive en el servidor y no en el escenario de Make a propósito: los campos
 * de asunto y contenido del módulo de Gmail estaban vacíos, y por eso el
 * correo llegaba todos los días "(sin asunto)" y en blanco. Dejando el texto
 * acá, Make solo tiene que mapear dos campos y el contenido queda
 * versionado, revisable y probable como cualquier otro código.
 *
 * El HTML usa tablas y estilos en línea a propósito: los clientes de correo
 * no soportan flexbox ni hojas de estilo externas.
 */

import { formatCLP } from '@/lib/format';

export interface DigestCandidate {
  name: string;
  price: number;
  category: string;
  image_url: string;
  seller_nickname: string | null;
}

export interface DigestInput {
  newCandidates: DigestCandidate[];
  pendingTotal: number;
  publishedTotal: number;
  needsAttention: { name: string }[];
  adminUrl: string;
}

const BG = '#f4f6f9';
const CARD = '#ffffff';
const TEXT = '#0f172a';
const MUTED = '#64748b';
const BORDER = '#e2e8f0';
const ACCENT = '#0e7490';

/**
 * Elige entre singular y plural. Existe para no volver a escribir frases
 * como "4 productos salió del sitio": pluralizar solo el sustantivo con un
 * `${n === 1 ? '' : 's'}` deja el verbo en singular.
 */
function plural(count: number, singular: string, many: string): string {
  return count === 1 ? singular : many;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function buildDigestSubject(input: DigestInput): string {
  const { newCandidates, pendingTotal, needsAttention } = input;

  const parts: string[] = [];
  if (newCandidates.length > 0) {
    parts.push(`${newCandidates.length} ${plural(newCandidates.length, 'producto nuevo', 'productos nuevos')}`);
  }
  if (pendingTotal > 0) {
    parts.push(`${pendingTotal} por revisar`);
  }
  if (needsAttention.length > 0) {
    parts.push(`${needsAttention.length} con problema`);
  }

  return parts.length > 0 ? `ComparaTech · ${parts.join(' · ')}` : 'ComparaTech · sin novedades hoy';
}

function candidateRow(c: DigestCandidate): string {
  return `
  <tr>
    <td style="padding:12px 0;border-bottom:1px solid ${BORDER};" valign="top" width="64">
      <img src="${escapeHtml(c.image_url)}" width="56" height="56" alt=""
           style="display:block;width:56px;height:56px;object-fit:contain;background:#fff;border:1px solid ${BORDER};border-radius:8px;">
    </td>
    <td style="padding:12px 0 12px 12px;border-bottom:1px solid ${BORDER};" valign="top">
      <div style="font-size:14px;color:${TEXT};font-weight:600;line-height:1.35;">${escapeHtml(c.name)}</div>
      <div style="font-size:12px;color:${MUTED};margin-top:3px;">
        ${escapeHtml(c.category)}${c.seller_nickname ? ` · ${escapeHtml(c.seller_nickname)}` : ''}
      </div>
    </td>
    <td style="padding:12px 0;border-bottom:1px solid ${BORDER};text-align:right;white-space:nowrap;" valign="top">
      <div style="font-size:15px;color:${ACCENT};font-weight:700;">${formatCLP(c.price)}</div>
    </td>
  </tr>`;
}

export function buildDigestHtml(input: DigestInput): string {
  const { newCandidates, pendingTotal, publishedTotal, needsAttention, adminUrl } = input;

  const newSection =
    newCandidates.length > 0
      ? `
      <h2 style="font-size:15px;color:${TEXT};margin:28px 0 4px;">Nuevos desde ayer</h2>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
        ${newCandidates.map(candidateRow).join('')}
      </table>`
      : `
      <p style="font-size:14px;color:${MUTED};margin:28px 0 0;">
        Hoy no entraron productos nuevos. Los destacados de Mercado Libre cambian
        de a poco, así que hay días sin novedades.
      </p>`;

  // Estos son los que se cayeron del sitio solos: el vendedor dejó de
  // ofrecer el producto o el link quedó apuntando a otra oferta. No se
  // arreglan solos, hay que generarles un link nuevo.
  const attentionSection =
    needsAttention.length > 0
      ? `
      <div style="margin-top:28px;padding:14px 16px;background:#fff7ed;border:1px solid #fed7aa;border-radius:10px;">
        <div style="font-size:14px;color:#9a3412;font-weight:600;">
          ${needsAttention.length}
          ${plural(needsAttention.length, 'producto necesita', 'productos necesitan')}
          un link nuevo
        </div>
        <div style="font-size:13px;color:#9a3412;margin-top:4px;line-height:1.5;">
          ${plural(
            needsAttention.length,
            'Dejó de mostrarse en el sitio porque el vendedor ya no lo ofrece, o porque su link apunta a otra oferta.',
            'Dejaron de mostrarse en el sitio porque el vendedor ya no los ofrece, o porque sus links apuntan a otra oferta.'
          )}
          ${plural(needsAttention.length, 'Se recupera', 'Se recuperan')} generando el link
          de nuevo desde Mercado Libre.
        </div>
        <ul style="margin:8px 0 0;padding-left:18px;font-size:13px;color:#9a3412;">
          ${needsAttention.map((p) => `<li style="margin:2px 0;">${escapeHtml(p.name)}</li>`).join('')}
        </ul>
      </div>`
      : '';

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
          <div style="font-size:13px;color:${MUTED};margin-top:2px;">Resumen del catálogo</div>

          <div style="margin-top:20px;padding:18px;background:${BG};border-radius:10px;text-align:center;">
            ${
              pendingTotal > 0
                ? `<div style="font-size:34px;font-weight:700;color:${TEXT};line-height:1;">${pendingTotal}</div>
                   <div style="font-size:13px;color:${MUTED};margin-top:6px;">
                     ${plural(pendingTotal, 'producto esperando revisión', 'productos esperando revisión')}
                   </div>
                   <a href="${escapeHtml(adminUrl)}/admin/candidatos"
                      style="display:inline-block;margin-top:14px;padding:10px 20px;background:${ACCENT};color:#fff;
                             font-size:14px;font-weight:600;text-decoration:none;border-radius:8px;">
                     Revisar ahora
                   </a>`
                : // Un "0" gigante con un botón "Revisar ahora" al lado invita
                  // a entrar a una pantalla vacía.
                  `<div style="font-size:15px;font-weight:600;color:${TEXT};">Cola de revisión al día</div>
                   <div style="font-size:13px;color:${MUTED};margin-top:4px;">No queda nada pendiente por aprobar.</div>`
            }
          </div>

          ${newSection}
          ${attentionSection}

          <p style="font-size:12px;color:${MUTED};margin:28px 0 24px;border-top:1px solid ${BORDER};padding-top:16px;line-height:1.6;">
            ${publishedTotal} ${plural(publishedTotal, 'producto publicado', 'productos publicados')} en el sitio.
            Los precios se actualizan solos todos los días siguiendo la oferta a la que apunta cada link.
          </p>

        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

export function buildDigestText(input: DigestInput): string {
  const { newCandidates, pendingTotal, publishedTotal, needsAttention, adminUrl } = input;
  const lines = [
    `ComparaTech — resumen del catálogo`,
    ``,
    `${pendingTotal} ${plural(pendingTotal, 'producto espera', 'productos esperan')} revisión: ${adminUrl}/admin/candidatos`,
    ``,
  ];

  if (newCandidates.length > 0) {
    lines.push(`Nuevos desde ayer (${newCandidates.length}):`);
    newCandidates.forEach((c) => lines.push(`  - ${c.name} — ${formatCLP(c.price)} (${c.category})`));
  } else {
    lines.push('Hoy no entraron productos nuevos.');
  }

  if (needsAttention.length > 0) {
    lines.push('', `${needsAttention.length} ${plural(needsAttention.length, 'producto necesita', 'productos necesitan')} un link nuevo:`);
    needsAttention.forEach((p) => lines.push(`  - ${p.name}`));
  }

  lines.push('', `${publishedTotal} ${plural(publishedTotal, 'producto publicado', 'productos publicados')} en el sitio.`);
  return lines.join('\n');
}
