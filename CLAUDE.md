# ComparaTech: guía para trabajar en este repositorio

Comparador de precios de tecnología para Chile. Los productos vienen del catálogo de Mercado Libre (ML) y el botón de compra lleva un link de afiliado de ML: esa comisión es el único ingreso. Next.js 15 (App Router) + Supabase, publicado en Vercel (plan Hobby). El funcionamiento general y las variables de entorno están en [README.md](README.md).

Este archivo es público, como todo el repositorio: no lleva secretos ni datos de cuentas.

## Antes de empezar

1. Si existe `C:\Proyectos\comparatech-web\_local\LEEME-PRIMERO.md`, léelo entero antes de tocar nada. Es el documento privado del dueño (fuera de git): estado del proyecto, trabajo a medias, pendientes, cuentas y decisiones. Si trabajas en una copia (worktree) o en la nube y no lo tienes, pídeselo al dueño.
2. Lee las últimas entradas de `_local/BITACORA.md`. Al terminar cada tarea, agrega la tuya: fecha y hora de Chile, cuenta de Claude, qué cambió (commits), qué quedó pendiente y qué se le pidió al dueño.
3. Mira `git status -sb`. Puede haber trabajo sin commitear de otra sesión: no lo pises ni lo metas en tus commits sin revisarlo.

## Cómo se trabaja

- En español de Chile y simple: el dueño no es programador. Los pasos de Vercel, Supabase, GitHub y redes los hace a mano cuando se le piden, con instrucciones clic a clic.
- Commits directo a `main` y push, sin pull requests. Un problema a la vez: se termina, se prueba y se publica antes de pasar al siguiente.
- Cada push a `main` publica el sitio en producción. Después de cada push, confirma el despliegue: `curl -s https://api.github.com/repos/comparatechcl-tech/comparatech-web/commits/<sha>/status` (Vercel deja ahí success o failure).
- CI corre `tsc` y `vitest`, pero no `next build`: si el cambio toca páginas, corre `npm run build` antes de publicar.
- Las migraciones de `supabase/migrations` las corre el dueño a mano en el SQL Editor de Supabase. El código tiene que seguir funcionando si una migración nueva todavía no está aplicada.

## Reglas técnicas

- Repositorio público: ningún secreto en el código, las migraciones, los tests ni los logs de GitHub Actions (también son públicos). Los scripts leen `.env.local` sin imprimirlo.
- `.env.local` apunta a la base y a la app de ML de **producción**: un servidor local lee y escribe datos reales. En pruebas locales del admin, solo mirar (no aprobar, publicar ni marcar).
- El catálogo tiene miles de productos: pagina las lecturas (Supabase corta en 1.000 filas sin avisar), ninguna entrada del caché de datos de Vercel puede pasar de 2 MB, y no se pregeneran todas las fichas.
- La API de ML se usa con `client_credentials`. Varias rutas responden 403 (`/sites/MLC/search`, `/items` y, desde el 14-10-2026, `/highlights`). `/oauth/token` responde 429 unos segundos después de cada hora en punto: no programes nada que pida token en el segundo 0 de una hora.
- Nunca intentes saltarte el muro de inicio de sesión de mercadolibre.cl. Abrir un link de afiliado (`meli.la` o con `matt_word`) cuenta como clic en el panel de afiliados: para revisar una ficha usa el link limpio `https://www.mercadolibre.cl/p/{id}` (`mlProductUrl` en `src/lib/ml-urls.ts`).
- `next dev` no manda la política de contenido (CSP). Lo que toque imágenes `blob:`, dominios externos, workers o scripts inline se prueba en un build de producción local.
- En código que corre en el navegador, nada de lookbehind ni grupos con nombre en las expresiones regulares (Safari anterior a 16.4).
- La hora: en Git Bash `TZ=America/Santiago date` no convierte. Usa `date` (el PC está en hora de Chile) o `Intl` en Node.

## Voz de marca (todo texto público: sitio, redes, videos, Telegram)

- Roxy es un personaje creado con inteligencia artificial, el rostro de la marca. Nunca "fundadora", nunca alguien que revisa, prueba o recomienda productos.
- No se afirma que alguien revise cada producto. Lo cierto: los productos salen de listas de Mercado Libre por un proceso automático, solo de vendedores con reputación verde; los precios se actualizan solos varias veces al día y pueden cambiar; la comisión influye en qué aparece.
- Descuentos: "N% de descuento" y "sin descuento $X". Nunca "precio de lista", "antes $X", "rebajado" ni "precio normal". "Bajó $X" solo si el historial de precios propio lo confirma.
- Prohibido: "mejor precio", "el más barato", "recomendado" (se dice "Destacado"), "imperdible", "solo hoy", "verificado" (se dice "precio revisado").
- Sin etiqueta "Publicidad" en las piezas ni en los textos (decisión del dueño). La frase de la comisión sí va en los textos de las publicaciones.
- El titular de la portada y los títulos SEO de las categorías los decide el dueño: pregunta antes de cambiarlos.

## Comandos

```bash
npm run typecheck                     # tipos
npm test                              # tests (vitest)
npm run build                         # el mismo build de Vercel
node scripts/redes.mjs plan 1         # qué publicar en redes (pide al sitio en producción)
node scripts/reels/generar.mjs --seco # qué videos armaría, sin subir nada
```
