import 'server-only';
import { createHash } from 'node:crypto';
import { chileDateKey } from '@/lib/clicks';

/**
 * Tope de clics por cliente y día en /api/e. Una persona real no toca "Ver
 * en Mercado Libre" 50 veces en un día; sin este tope, un solo script con
 * un user-agent de navegador agotaba el cupo global (MAX_CLICKS_PER_DAY) y
 * desde ahí se descartaban los clics reales hasta medianoche.
 */
export const MAX_CLICKS_PER_CLIENT_PER_DAY = 50;

/**
 * Llave del cliente para el tope diario: hash de IP + user-agent + fecha de
 * Chile + un secreto del servidor, cortado a 16 caracteres. Cambia cada día
 * y sin el secreto no se puede volver a la IP, así que no se guarda la IP
 * (ver /privacidad). Null si no hay secreto: un hash sin sal de una IPv4 se
 * revierte probando todas, y entonces mejor no guardar nada.
 */
export function clickClientKey(
  headers: Headers,
  now: Date,
  secret: string | undefined = process.env.CLICK_SALT || process.env.CRON_SECRET
): string | null {
  if (!secret) return null;
  const ip =
    headers.get('x-forwarded-for')?.split(',')[0]?.trim() || headers.get('x-real-ip')?.trim() || '';
  const ua = headers.get('user-agent') ?? '';
  return createHash('sha256')
    .update(`${ip}|${ua}|${chileDateKey(now)}|${secret}`)
    .digest('hex')
    .slice(0, 16);
}
