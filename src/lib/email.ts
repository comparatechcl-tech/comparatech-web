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

export async function sendEmail(params: {
  to: string;
  subject: string;
  html: string;
  text?: string;
}): Promise<SendResult> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return { ok: false, error: 'RESEND_API_KEY no configurada' };

  try {
    const res = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        from: process.env.DIGEST_FROM?.trim() || DEFAULT_FROM,
        to: [params.to],
        subject: params.subject,
        html: params.html,
        ...(params.text ? { text: params.text } : {}),
      }),
      signal: AbortSignal.timeout(10_000),
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
