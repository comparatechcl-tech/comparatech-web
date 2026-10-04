/**
 * Envío de correo vía Resend.
 *
 * Reemplaza al módulo de Gmail en Make. El correo diario llegaba vacío
 * porque los campos de asunto y contenido del módulo quedaban sin llenar, y
 * cada intento de arreglarlo era a ciegas: la configuración vive en una
 * interfaz que no se versiona ni se puede probar. Enviando desde acá, si
 * algo falla queda en los logs de Vercel con el error concreto.
 *
 * Se usa la API REST directamente en vez del SDK: es un solo POST y así no
 * se agrega una dependencia al proyecto.
 */

const RESEND_ENDPOINT = 'https://api.resend.com/emails';

/**
 * Remitente. Mientras comparatech.cl no esté registrado y verificado en
 * Resend, hay que usar su dominio de prueba, que solo puede escribirle a la
 * casilla dueña de la cuenta — suficiente para un resumen interno.
 */
const DEFAULT_FROM = 'ComparaTech <onboarding@resend.dev>';

export type SendResult =
  | { ok: true; id: string }
  | { ok: false; error: string };

/** Archivo adjunto. `content` va en base64, que es lo que pide Resend. */
export interface EmailAttachment {
  filename: string;
  content: string;
}

/**
 * Destinatarios a partir de un texto como el de DIGEST_TO, que acepta una
 * lista separada por comas: así el resumen y el respaldo pueden llegarle a
 * más de una persona sin tocar código. Quita espacios, vacíos y repetidos.
 */
export function parseRecipients(to: string | string[] | null | undefined): string[] {
  const list = Array.isArray(to) ? to : (to ?? '').split(',');
  return [...new Set(list.map((t) => t.trim()).filter(Boolean))];
}

/** Texto a base64 (UTF-8), para los adjuntos. */
export function toBase64(text: string): string {
  return Buffer.from(text, 'utf8').toString('base64');
}

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value);
  // Comillas, comas, punto y coma o saltos de línea obligan a encerrar la
  // celda; las comillas de adentro se duplican (RFC 4180). Un nombre como
  // 'Monitor 27" 144Hz, IPS' rompería las columnas si no.
  return /[",;\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * Arma un CSV con encabezado. Empieza con BOM para que Excel lo abra en
 * UTF-8: sin él, "Computación" aparece como "ComputaciÃ³n".
 */
export function toCsv<T extends Record<string, unknown>>(columns: (keyof T & string)[], rows: T[]): string {
  const lines = [columns.map(csvCell).join(',')];
  for (const row of rows) lines.push(columns.map((c) => csvCell(row[c])).join(','));
  return `﻿${lines.join('\r\n')}\r\n`;
}

export async function sendEmail(params: {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  attachments?: EmailAttachment[];
}): Promise<SendResult> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return { ok: false, error: 'RESEND_API_KEY no configurada' };

  const to = parseRecipients(params.to);
  if (to.length === 0) return { ok: false, error: 'Sin destinatarios' };

  try {
    const res = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        from: process.env.DIGEST_FROM?.trim() || DEFAULT_FROM,
        to,
        subject: params.subject,
        html: params.html,
        ...(params.text ? { text: params.text } : {}),
        ...(params.attachments?.length ? { attachments: params.attachments } : {}),
        // Gmail ofrecía traducir el resumen "del inglés": sin este
        // encabezado adivina el idioma y con textos cortos se equivoca.
        headers: { 'Content-Language': 'es' },
      }),
      // Con adjuntos el cuerpo pesa más: un poco más de margen.
      signal: AbortSignal.timeout(params.attachments?.length ? 20_000 : 10_000),
    });

    const data = await res.json().catch(() => null);

    if (!res.ok) {
      // Resend devuelve el motivo en `message`; sin eso queda el status,
      // que igual sirve para distinguir una key inválida de un remitente
      // no verificado.
      const detail = (data as { message?: string })?.message ?? `HTTP ${res.status}`;
      return { ok: false, error: detail };
    }

    return { ok: true, id: (data as { id?: string })?.id ?? '' };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Fallo al enviar el correo' };
  }
}
