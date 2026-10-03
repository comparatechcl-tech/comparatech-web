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
import { getCategoryInfo } from '@/lib/categories';

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
  /** Fuera del sitio y no se arreglan solos: el link lleva a otro producto. */
  needsLink: { name: string }[];
  /**
   * Fuera del sitio pero en pausa automática: Mercado Libre se quedó sin
   * vendedor para esa ficha, o el que tiene no es verde. Vuelven solos.
   */
  pausedCount: number;
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

/**
 * Cuántos candidatos nuevos se listan con foto. Desde que la prospección
 * recuerda lo descartado entran decenas por día —113 en la primera corrida—
 * y un correo con todos no se lee: más arriba va el conteo por categoría y
 * el resto se revisa en el admin.
 */
const MAX_LISTED = 10;

function categoryName(slug: string): string {
  return getCategoryInfo(slug)?.name ?? slug;
}

/**
 * Muestra variada: uno de cada categoría por vuelta. Tomar los primeros por
 * precio daba diez repetidores wifi seguidos.
 */
function sampleAcrossCategories(candidates: DigestCandidate[], max: number): DigestCandidate[] {
  const groups = new Map<string, DigestCandidate[]>();
  for (const c of candidates) groups.set(c.category, [...(groups.get(c.category) ?? []), c]);

  const sample: DigestCandidate[] = [];
  while (sample.length < Math.min(max, candidates.length)) {
    for (const group of groups.values()) {
      const next = group.shift();
      if (next) sample.push(next);
      if (sample.length === max) break;
    }
  }
  return sample;
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

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function buildDigestSubject(input: DigestInput): string {
  const { newCandidates, pendingTotal, needsLink } = input;

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
      <div style="font-size:15px;color:${ACCENT};font-weight:700;">${formatCLP(c.price)}</div>
    </td>
  </tr>`;
}

export function buildDigestHtml(input: DigestInput): string {
  const { newCandidates, pendingTotal, publishedTotal, needsLink, pausedCount, adminUrl } = input;

  const listed = sampleAcrossCategories(newCandidates, MAX_LISTED);
  const notListed = newCandidates.length - listed.length;

  const newSection =
    newCandidates.length > 0
      ? `
      <h2 style="font-size:15px;color:${TEXT};margin:28px 0 4px;">Nuevos desde ayer (${newCandidates.length})</h2>
      ${
        notListed > 0
          ? `<p style="font-size:13px;color:${MUTED};margin:0 0 4px;line-height:1.5;">${escapeHtml(countByCategory(newCandidates))}</p>`
          : ''
      }
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
        ${listed.map(candidateRow).join('')}
      </table>
      ${
        notListed > 0
          ? `<p style="font-size:13px;color:${MUTED};margin:12px 0 0;">
               … y ${notListed} más.
               <a href="${escapeHtml(adminUrl)}/admin/candidatos" style="color:${ACCENT};font-weight:600;">Verlos todos en el admin →</a>
             </p>`
          : ''
      }`
      : `
      <p style="font-size:14px;color:${MUTED};margin:28px 0 0;">
        Hoy no entraron productos nuevos. Los destacados de Mercado Libre cambian
        de a poco, así que hay días sin novedades.
      </p>`;

  // Lo único del correo que requiere acción: links que llevan a otro
  // producto. El resto de lo que está fuera del sitio vuelve solo.
  const attentionSection =
    needsLink.length > 0
      ? `
      <div style="margin-top:28px;padding:14px 16px;background:#fff7ed;border:1px solid #fed7aa;border-radius:10px;">
        <div style="font-size:14px;color:#9a3412;font-weight:600;">
          ${needsLink.length}
          ${plural(needsLink.length, 'producto necesita', 'productos necesitan')}
          un link nuevo
        </div>
        <div style="font-size:13px;color:#9a3412;margin-top:4px;line-height:1.5;">
          ${plural(
            needsLink.length,
            'Su link de afiliado abre otra ficha, así que el comprador vería otro producto.',
            'Sus links de afiliado abren otra ficha, así que el comprador vería otro producto.'
          )}
          Se arregla generando el link desde la ficha correcta y guardándolo en el admin.
        </div>
        <ul style="margin:8px 0 0;padding-left:18px;font-size:13px;color:#9a3412;">
          ${needsLink.map((p) => `<li style="margin:2px 0;">${escapeHtml(p.name)}</li>`).join('')}
        </ul>
        <a href="${escapeHtml(adminUrl)}/admin/problemas"
           style="display:inline-block;margin-top:10px;font-size:13px;font-weight:600;color:#9a3412;">
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
          ${pausedNote}

          <p style="font-size:12px;color:${MUTED};margin:28px 0 24px;border-top:1px solid ${BORDER};padding-top:16px;line-height:1.6;">
            ${publishedTotal} ${plural(publishedTotal, 'producto publicado', 'productos publicados')} en el sitio.
            Los precios se comparan contra Mercado Libre cada 30 minutos.
          </p>

        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

export function buildDigestText(input: DigestInput): string {
  const { newCandidates, pendingTotal, publishedTotal, needsLink, pausedCount, adminUrl } = input;
  const lines = [
    `ComparaTech — resumen del catálogo`,
    ``,
    `${pendingTotal} ${plural(pendingTotal, 'producto espera', 'productos esperan')} revisión: ${adminUrl}/admin/candidatos`,
    ``,
  ];

  if (newCandidates.length > 0) {
    const listed = sampleAcrossCategories(newCandidates, MAX_LISTED);
    lines.push(`Nuevos desde ayer (${newCandidates.length}): ${countByCategory(newCandidates)}`);
    listed.forEach((c) => lines.push(`  - ${c.name} — ${formatCLP(c.price)} (${categoryName(c.category)})`));
    if (newCandidates.length > listed.length) lines.push(`  … y ${newCandidates.length - listed.length} más en el admin.`);
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
  return lines.join('\n');
}
