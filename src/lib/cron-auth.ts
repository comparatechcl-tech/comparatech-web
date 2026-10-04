import { safeEqual } from '@/lib/safe-equal';

/**
 * Largo mínimo del secreto de los crons. Uno corto se adivina probando, y
 * estos endpoints escriben precios en la base.
 */
export const MIN_CRON_SECRET_LENGTH = 16;

/**
 * ¿La llamada trae el secreto de los crons?
 *
 * Falla cerrado: si CRON_SECRET falta en Vercel, la comparación antigua
 * (`!== \`Bearer ${process.env.CRON_SECRET}\``) aceptaba a cualquiera que
 * mandara literalmente "Bearer undefined".
 */
export function isCronAuthorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < MIN_CRON_SECRET_LENGTH) return false;
  const header = req.headers.get('authorization') ?? '';
  return safeEqual(header, `Bearer ${secret}`);
}
