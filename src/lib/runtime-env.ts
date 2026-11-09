/**
 * Dónde corre el sitio.
 *
 * Hasta noviembre de 2026 corría solo en Vercel, y "el sitio publicado" se
 * reconocía por VERCEL_ENV === 'production'. En Railway esa variable no
 * existe: allá se pone APP_ENV=production a mano (Railway → Variables).
 *
 * Solo el sitio publicado publica en redes (reel diario y carrusel), escribe
 * precios desde el admin y le avisa a IndexNow. Las vistas previas de
 * Vercel, la copia de prueba, el PC del dueño y las pruebas usan la misma base
 * y las mismas cuentas, y no deben hacer nada de eso. Por eso la comparación
 * es exacta: "Production" o "production " no cuentan.
 *
 * APP_ENV va SOLO en Railway: en Vercel (que ya trae VERCEL_ENV) o en
 * .env.local, una vista previa o el PC pasarían a publicar de verdad.
 */
/** Las variables que se miran (VERCEL, VERCEL_ENV, APP_ENV); por defecto, las del proceso. */
export type RuntimeEnv = Record<string, string | undefined>;

export function isProductionRuntime(env: RuntimeEnv = process.env): boolean {
  return env.VERCEL_ENV === 'production' || env.APP_ENV === 'production';
}

/** ¿Corre en Vercel? Solo para lo que existe nada más que allá, como Vercel Analytics. */
export function isVercel(env: RuntimeEnv = process.env): boolean {
  return env.VERCEL === '1';
}
