# ComparaTech: guía para trabajar en este repositorio

Comparador de precios de tecnología para Chile. Los productos vienen del catálogo de Mercado Libre (ML) y el botón de compra lleva un link de afiliado de ML: esa comisión es el único ingreso. Next.js 15 (App Router) + Supabase, publicado en Railway con `next start` desde el 22-11-2026 (antes en Vercel). El funcionamiento general y las variables de entorno están en [README.md](README.md).

**Desde el 23-11-2026 Mercado Libre no entrega precios a esta aplicación** (su soporte confirmó que es a propósito para aplicaciones no certificadas). El sitio muestra cada precio con la fecha de su última revisión y manda a ver el de hoy en Mercado Libre: ver `src/lib/price-freshness.ts`. Nada nuevo puede depender de precios automáticos de ML.

Este archivo es público, como todo el repositorio: no lleva secretos ni datos de cuentas.

## Antes de empezar

1. Si existe `C:\Proyectos\comparatech-web\_local\LEEME-PRIMERO.md`, léelo entero antes de tocar nada. Es el documento privado del dueño (fuera de git): estado del proyecto, trabajo a medias, pendientes, cuentas y decisiones. Si trabajas en una copia (worktree) o en la nube y no lo tienes, pídeselo al dueño.
2. Lee las últimas entradas de `_local/BITACORA.md`. Al terminar cada tarea, agrega la tuya: fecha y hora de Chile, cuenta de Claude, qué cambió (commits), qué quedó pendiente y qué se le pidió al dueño.
3. Mira `git status -sb`. Puede haber trabajo sin commitear de otra sesión: no lo pises ni lo metas en tus commits sin revisarlo.

## Cómo se trabaja

- En español de Chile y simple: el dueño no es programador. Los pasos de Railway, Supabase, GitHub y redes los hace a mano cuando se le piden, con instrucciones clic a clic. Lo que se le proponga no puede depender de una tarea diaria suya (como revisar precios a mano).
- Commits directo a `main` y push, sin pull requests. Un problema a la vez: se termina, se prueba y se publica antes de pasar al siguiente.
- Cada push a `main` publica el sitio en producción. Después de cada push, confirma el despliegue en `https://api.github.com/repos/comparatechcl-tech/comparatech-web/deployments?sha=<sha completo>`: el `statuses_url` de esa respuesta trae `success` o `failure` (lo anota Railway).
- CI corre `tsc` y `vitest`, pero no `next build`: si el cambio toca páginas, corre `npm run build` antes de publicar.
- Las migraciones de `supabase/migrations` las corre el dueño a mano en el SQL Editor de Supabase. El código tiene que seguir funcionando si una migración nueva todavía no está aplicada.
- Nunca le digas al dueño que vuelva a correr la migración 0011: apunta el refresco de precios al dominio viejo de Vercel. La 0019 lo apunta a `www.comparatech.cl`.

## Reglas técnicas

- Repositorio público: ningún secreto en el código, las migraciones, los tests ni los logs de GitHub Actions (también son públicos). Los scripts leen `.env.local` sin imprimirlo.
- `.env.local` apunta a la base y a la app de ML de **producción**: un servidor local lee y escribe datos reales. En pruebas locales del admin, solo mirar (no aprobar, publicar ni marcar).
- El catálogo tiene miles de productos: pagina las lecturas (Supabase corta en 1.000 filas sin avisar), ninguna entrada del caché de datos puede pasar de 2 MB, y no se pregeneran todas las fichas.
- No uses `dynamicParams = false`: con `next start`, después de cada purga de caché esas rutas responden 404 hasta el siguiente despliegue. Una dirección que no existe se corta con `notFound()`.
- La API de ML se usa con `client_credentials`. Varias rutas responden 403: `/sites/MLC/search`, `/items` (también `/items/{id}/sale_price` y `/prices`), `/highlights` desde el 14-10-2026 y `/products/{id}/items` desde el 23-11-2026. Esta última era la de los precios: `getWinners` (`src/lib/ml-catalog.ts`) la da por cerrada y hace una sola consulta de prueba por hora. Siguen respondiendo `/products/{id}`, `/products/search`, `/users/{id}`, `/trends` y las categorías. `/oauth/token` responde 429 unos segundos después de cada hora en punto: no programes nada que pida token en el segundo 0 de una hora.
- ML bloquea aplicaciones por exceso de llamadas: nada de reintentar en masa una ruta que responde 403.
- Nunca intentes saltarte el muro de inicio de sesión de mercadolibre.cl ni su protección contra programas (responde 403 a lo que no es un navegador): no se leen sus páginas con un programa disfrazado de persona, ni con servicios que lo hagan. Abrir un link de afiliado (`meli.la` o con `matt_word`) cuenta como clic en el panel de afiliados: para revisar una ficha usa el link limpio `https://www.mercadolibre.cl/p/{id}` (`mlProductUrl` en `src/lib/ml-urls.ts`).
- Lo anterior no es solo prudencia: desde abril de 2026 los términos del sitio de ML (cláusula 12) prohíben usar sistemas automatizados para leer o reutilizar su contenido, directa o indirectamente, sin autorización expresa, y los términos de afiliados tratan como fraude el eludir sus medidas de seguridad. Su `robots.txt` cierra el sitio a los agentes de IA: las páginas de mercadolibre.cl tampoco se abren con las herramientas de navegador de Claude; lo que haga falta ver se le pide al dueño en una captura.
- El canal oficial de afiliados de ML (WhatsApp y Telegram, privado) sí es una fuente permitida de precios: Mercado Libre publica ahí productos con su precio. Los avisos se pegan en `/admin/historias/aviso`; sus links de `tinyurl.com` no se abren, pero se le puede preguntar al acortador adónde apuntan sin seguir la redirección (`src/lib/short-links.ts`): el pedido no llega a Mercado Libre y entrega la ficha exacta. `meli.la` no se resuelve nunca. Un precio del canal se guarda con `offer_info.source = 'canal'` y, como el revisado a mano, no dice nada del vendedor (`priceOnlyKnown` en `src/lib/price-freshness.ts`).
- Links de afiliado de ML: se permiten hacia productos, ofertas, búsquedas, más vendidos y campañas; nunca hacia la portada, el carrito, el checkout ni favoritos (asistente de afiliados de ML, 24-11-2026). Su generador oficial solo arma links de producto y nadie confirmó que los demás se atribuyan: mientras no se sepa, no se agregan links de afiliado nuevos a páginas que no son de producto. El botón de ofertas anota sus clics como `ofertas-ml` para compararlos con el panel.
- Otras tiendas (`src/lib/stores.ts`, `/admin/tiendas`): solo se lee el precio de la ficha en tiendas que no lo prohíben en sus términos ni bloquean programas. El programa se identifica como `ComparaTechBot`, respeta el `robots.txt`, pide de a una ficha, no reintenta, y ante un bloqueo deja de pedir (`src/lib/store-reader.ts`, `src/lib/store-sync.ts`): nada de disfrazarse de navegador ni de proxies. Una tienda entra a la lista solo después de revisar una ficha suya de verdad: el precio que se toma es el que paga cualquiera (en Paris nunca el de la Tarjeta Cencosud). Samsung, Xiaomi y Entel prohíben la lectura; Falabella, Ripley, Lider y otras bloquean: no se agregan. El bloque público se enciende en `/admin/tiendas`, cada precio va con el día en que se revisó (nunca "hoy"), y sus clics se guardan en `store_clicks`, aparte de los de Mercado Libre.
- El horario de GitHub Actions no es confiable en este repositorio: de lo programado "cada 2 horas" corren unas 2 pasadas al día, a cualquier hora. Lo que tiene que correr a tiempo se programa en `pg_cron` de Supabase (migraciones 0019, 0020 y 0023) y GitHub queda de respaldo. Los videos los arma GitHub (necesitan ffmpeg), pero se los pide el sitio cuando hay algo por armar (`src/lib/video-build.ts`, variable `GITHUB_VIDEOS_TOKEN` solo en Railway).
- Las páginas se guardan armadas y lo que muestran depende de la hora (un precio deja de ser "de hoy" a las 12 horas): lo que dependa del tiempo se prueba con el reloj adelantado, y el refresco vuelve a armar el sitio cuando un precio cambia de estado.
- `next dev` no manda la política de contenido (CSP). Lo que toque imágenes `blob:`, dominios externos, workers o scripts inline se prueba en un build de producción local.
- En código que corre en el navegador, nada de lookbehind ni grupos con nombre en las expresiones regulares (Safari anterior a 16.4).
- La hora: en Git Bash `TZ=America/Santiago date` no convierte. Usa `date` (el PC está en hora de Chile) o `Intl` en Node.

## Voz de marca (todo texto público: sitio, redes, videos, Telegram)

- Roxy es un personaje creado con inteligencia artificial, el rostro de la marca. Nunca "fundadora", nunca alguien que revisa, prueba o recomienda productos. Mientras el avatar no esté implementado, el sitio no la menciona ni la muestra (decisión del dueño, 24-11-2026): no se vuelve a poner sin que él lo pida.
- No se afirma que alguien revise cada producto. Lo cierto: los productos salen de listas de Mercado Libre por un proceso automático y se agregaron cuando su vendedor tenía reputación verde; cada precio es el de su última revisión, con su fecha, y el de hoy está en Mercado Libre; la comisión influye en qué aparece.
- Ya no se dice que los precios "se actualizan solos" o "varias veces al día", ni "solo vendedores con reputación verde" en presente: desde el 23-11-2026 no se puede volver a revisar ni el precio ni quién vende.
- Un precio que no se revisó hoy nunca va como "hoy": va con su fecha ("Precio del 23/11", "en nuestra última revisión, el 23-11-2026") y sin descuento, envío, vendedor ni bajas. El botón dice "Ver precio de hoy en Mercado Libre".
- Descuentos: "N% de descuento" y "sin descuento $X". Nunca "precio de lista", "antes $X", "rebajado" ni "precio normal". "Bajó $X" solo si el historial de precios propio lo confirma y el precio se revisó hoy.
- Prohibido: "mejor precio", "el más barato", "recomendado" (se dice "Destacado"), "imperdible", "solo hoy", "verificado" (se dice "precio revisado").
- Sin etiqueta "Publicidad" y sin hablar de la comisión, ni en el sitio ni en las publicaciones, historias, videos o descripciones (decisión del dueño, 18-10-2026). La comisión se menciona solo en `/terminos`, en una frase. Textos cortos y con poco detalle. En TikTok sigue el interruptor de contenido comercial de la plataforma (no es texto).
- El titular de la portada y los títulos SEO de las categorías los decide el dueño: pregunta antes de cambiarlos.

## Comandos

```bash
npm run typecheck                     # tipos
npm test                              # tests (vitest)
npm run build                         # el mismo build de producción
node scripts/redes.mjs plan 1         # qué publicar en redes (pide al sitio en producción)
node scripts/reels/generar.mjs --seco # qué videos armaría, sin subir nada
```
