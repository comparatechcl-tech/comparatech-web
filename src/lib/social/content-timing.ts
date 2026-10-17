/**
 * Cuándo aparece contenido nuevo en /admin/historias y /admin/videos, para
 * que la página lo pueda decir ("próxima revisión de precios a las 10:30",
 * "próximos videos cerca de las 13:10").
 *
 * Sin imports a propósito: lo usan componentes de cliente.
 *
 * Las horas se calculan en UTC, que es como corren los dos relojes (pg_cron y
 * GitHub Actions), y se muestran en hora de Chile con chileTime: así el
 * cambio de hora de abril y septiembre se ajusta solo.
 */

/**
 * Cada cuánto se revisan los precios en Mercado Libre: pg_cron llama al
 * refresco a las :00 y a las :30 (supabase/migrations/0011). Es lo que trae
 * ofertas nuevas a Historias: cambian precios, descuentos y la hora de
 * revisión.
 */
export const PRICE_REFRESH_MINUTES = 30;

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;
const REFRESH_MS = PRICE_REFRESH_MINUTES * MINUTE_MS;

/**
 * La próxima revisión de precios después de `now` (nunca la de este mismo
 * instante: a las 10:30:00 en punto la próxima es la de las 11:00).
 *
 * Chile está a una cantidad entera de horas de UTC, así que las :00 y las :30
 * de UTC son las :00 y las :30 de Chile. La revisión tarda hasta un minuto en
 * terminar: el precio nuevo se ve un rato después de esa hora.
 */
export function nextPriceRefresh(now: Date): Date {
  const t = now.getTime();
  return new Date(Math.floor(t / REFRESH_MS) * REFRESH_MS + REFRESH_MS);
}

/**
 * Las pasadas que arman los videos del día, en hora UTC y en orden. Tiene que
 * calzar con el cron de .github/workflows/reels.yml (un test lo compara): si
 * se cambia allá, se cambia acá.
 *
 * GitHub atrasa las ejecuciones programadas (a veces decenas de minutos) y
 * cada pasada tarda hasta 15 minutos en armar los videos: la página debe
 * decir "cerca de", nunca una hora exacta.
 */
export const REEL_PASSES_UTC: readonly string[] = ['01:10', '10:10', '13:10', '16:10', '19:10', '22:10'];

function passMinutes(pass: string): number {
  const match = /^(\d{2}):(\d{2})$/.exec(pass);
  return match ? Number(match[1]) * 60 + Number(match[2]) : NaN;
}

/** La próxima pasada de los videos después de `now`, según REEL_PASSES_UTC. */
export function nextReelPass(now: Date): Date {
  const t = now.getTime();
  const day = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  // Hoy y mañana alcanzan: entre dos pasadas nunca hay más de un día.
  for (let d = 0; d < 2; d++) {
    for (const pass of REEL_PASSES_UTC) {
      const minutes = passMinutes(pass);
      if (!Number.isFinite(minutes)) continue;
      const at = day + d * DAY_MS + minutes * MINUTE_MS;
      if (at > t) return new Date(at);
    }
  }
  // Solo sin pasadas válidas: no hay próxima que decir.
  return new Date(NaN);
}

const CHILE_TIME = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Santiago',
  hourCycle: 'h23',
  hour: '2-digit',
  minute: '2-digit',
});

/**
 * "HH:MM" en hora de Chile, con el cambio de hora que corresponda a esa
 * fecha (lo sabe Intl). Vacío si la fecha no sirve.
 */
export function chileTime(date: Date): string {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
  let hour = '';
  let minute = '';
  for (const part of CHILE_TIME.formatToParts(date)) {
    if (part.type === 'hour') hour = part.value;
    else if (part.type === 'minute') minute = part.value;
  }
  // Algunos motores escriben la medianoche como "24".
  if (hour === '24') hour = '00';
  return hour && minute ? `${hour.padStart(2, '0')}:${minute.padStart(2, '0')}` : '';
}
