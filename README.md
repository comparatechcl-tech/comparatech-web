# ComparaTech — Web

Comparador de precios de tecnología para Chile. Los productos vienen del
catálogo de Mercado Libre y el botón "Ver en Mercado Libre" lleva un link de
afiliado: la comisión de esas compras es el único ingreso del proyecto.

Next.js 15 (App Router) + Supabase, publicado en Vercel (plan Hobby).
Cada push a `main` se publica solo en producción.

## Cómo funciona

1. **Prospección (una vez al día).** `/api/cron/prospect` toma lo más
   buscado en Mercado Libre en las categorías que sigue el sitio, busca esas
   palabras en el catálogo de ML dentro del tipo de producto que corresponde,
   descarta lo que ya conoce o no conviene (sin vendedor, vendedor sin
   reputación verde, comisión baja, etc.) y deja hasta 40 en la cola de
   candidatos (`product_candidates`). Al terminar manda el correo diario con
   lo que entró y lo que falta revisar. Hasta el 13-10-2026 usaba la lista
   de más vendidos, que ML bloqueó (403, también con token de usuario); sigue
   disponible con `?fuente=destacados`. Si ML no deja leer la fuente, la
   corrida queda como fallida en `cron_runs` y el correo lo dice arriba.
2. **Aprobación en el admin.** En `/admin/candidatos` los candidatos se
   aprueban o rechazan, normalmente en bloque: nadie revisa ni prueba cada
   producto. Aprobar los publica en `products` con su link de afiliado
   (directo a la ficha, o un meli.la generado en la Central de Afiliados de
   ML).
3. **Refresco de precios (cada 30 minutos).** `/api/cron/refresh-prices`
   pregunta a ML el precio del ganador de la caja de compra (el que ve el
   comprador al llegar a la ficha), marca sin stock lo que ya no se vende y
   vuelve a generar las páginas que cambiaron. Si el catálogo no cabe en una
   corrida, primero van las ofertas y lo que tuvo clics o salió en redes, y
   lo demás rota desde el precio más viejo (`src/lib/refresh-queue.ts`).

### Quién llama a los crons

| Origen | Qué llama | Cuándo |
|---|---|---|
| Supabase `pg_cron` (migración `0011`) | `/api/cron/refresh-prices` | Cada 30 minutos. Es el que manda. |
| Vercel Cron (`vercel.json`) | `/api/cron/prospect`, `/api/cron/refresh-prices`, `/api/cron/social-telegram` y `/api/cron/backup` | Una vez al día cada uno (el respaldo, los lunes). Hobby no permite más. |
| GitHub Actions (`.github/workflows/refresh-prices.yml`) | `/api/cron/refresh-prices` | Respaldo, y para lanzarlo a mano desde Actions. |
| GitHub Actions (`.github/workflows/reels.yml`) | `/api/social/videos/plan` | Arma los videos del día con ffmpeg (`scripts/reels/generar.mjs`) y los sube a Supabase Storage. |

Todos se identifican con `Authorization: Bearer <CRON_SECRET>`. El secreto
tiene que ser el mismo en los tres lugares: variable de Vercel, secreto
`CRON_SECRET` de GitHub y secreto `cron_secret` del Vault de Supabase. Si
mide menos de 16 caracteres los crons responden 401.

`/api/daily-digest?preview=1` (con el mismo secreto) muestra el correo
diario sin enviarlo.

### Redes sociales

Instagram, Facebook y TikTok se programan desde Metricool. El sitio no
guarda ninguna clave de las redes: solo prepara qué publicar y anota lo que
se programó.

1. `node scripts/redes.mjs plan 2` pide a `/api/social/plan` los productos
   elegidos (precio revisado hace menos de 6 horas, 20% o más de descuento
   según la cifra tachada que pone el vendedor, o una baja comprobada, sin
   repetir en 14 días),
   con el texto de cada red, la imagen y los ajustes exactos para Metricool
   (en TikTok, la etiqueta de contenido comercial). También dice cuántas
   publicaciones van en el mes: el plan gratis de Metricool publica 20 y
   cada red cuenta como una.
2. La imagen es la misma pieza del kit del admin, en JPG y en una dirección
   pública y firmada (`/social/pieza/...`). El precio y la hora van dentro
   de la dirección: la imagen dice siempre lo mismo que el texto, y nadie
   puede armar una dirección con otro precio. El script baja cada imagen
   antes de entregar el plan, porque Metricool no avisa si no pudo bajarla.
3. Quien programa (el asistente conectado a Metricool) crea las
   publicaciones y después corre `node scripts/redes.mjs registrar
   _local/archivo.json`. Con eso `/hoy` (el link de la bio) muestra el
   producto y la selección no lo repite.

Reglas que el código hace cumplir:

- Nada se programa con más de 48 horas de anticipación: el precio de la
  imagen y del texto es el de hoy. El plan avisa de lo ya programado cuyo
  producto se agotó o cambió de precio 3% o más
  (`pendientes_con_problemas`), para retirarlo de Metricool y avisar con
  `"retiradas"` en el mismo `registrar`.
- Cada texto lleva la frase de la comisión ("Si compras con nuestro
  link...") antes de los hashtags. La etiqueta "Publicidad" se sacó de los
  textos y de las imágenes por decisión del dueño (octubre de 2026); el
  SERNAC pide identificar la publicidad, así que esa frase no se quita sin
  que él lo decida.
- Las direcciones firmadas dependen de `CRON_SECRET` (mínimo 32
  caracteres para firmar). Si se cambia ese secreto, las imágenes de lo que
  esté programado dejan de servir: hay que volver a programarlo.

Lo que el código no puede hacer y queda a mano: Instagram y Facebook piden
la etiqueta "Colaboración pagada" en el contenido con links de afiliado, y
solo se puede poner desde sus aplicaciones.

Además de lo programado en Metricool, el admin prepara lo que el dueño sube a
mano desde el teléfono:

- **Historias** (`/admin/historias`): las ofertas del momento con su imagen
  9:16 y el link de afiliado listo para el sticker de enlace de Instagram,
  que ninguna herramienta para programar publicaciones puede poner.
- **Carrusel de la semana** (`/admin/historias/carrusel`): el "Top 5 bajas
  de la semana" para Instagram y Facebook, solo con bajas que confirma el
  historial de precios propio. Portada, una lámina por producto y cierre en
  1080x1350, servidas en direcciones públicas firmadas
  (`/social/carrusel/...`), con su texto para cada red. Marcarlo como
  publicado suma sus productos a `/hoy`.
- **Videos** (`/admin/videos`): los reels del día, que arma GitHub Actions
  (`.github/workflows/reels.yml`) y guarda en el bucket `reels` de Supabase
  Storage. Se marcan por red al subirlos.

El canal de Telegram (`/api/cron/social-telegram`) publica solo, pero solo
si están `TELEGRAM_BOT_TOKEN` y `TELEGRAM_CHANNEL_ID`; sin ellas no hace
nada. El botón "Recibe las ofertas en Telegram" aparece con
`NEXT_PUBLIC_TELEGRAM_URL`.

### Admin

`/admin` está protegido con Basic Auth: el navegador pide usuario y clave.
Cada persona tiene la suya en `ADMIN_USERS` y cada acción del admin vuelve a
verificarla en el servidor. Secciones:

- **Resumen**: salud del sitio, clics hacia Mercado Libre y cobertura por
  categoría.
- **Candidatos**: la cola para aprobar o rechazar, con carga de links en
  bloque. Con "Agregar desde Mercado Libre" (`/admin/candidatos/agregar`) se
  pega el link de un producto visto en ML: se revisa como en la prospección
  (ganador, vendedor verde, categoría, comisión), se arma su link de afiliado
  y queda en la cola o publicado. Los links cortos (meli.la) no se abren:
  cada apertura cuenta como un clic de afiliado.
- **Productos**: el catálogo publicado; ocultar, cambiar el link, etc. En
  "Limpiar catálogo" (`/admin/productos/limpiar`) se sacan de a varios los
  que sobran (en pausa hace días, poca comisión, colores repetidos o lo
  recién aprobado en bloque): dejan de revisarse cada 30 minutos y se
  reponen desde Productos → Eliminados.
- **Historias** y **Videos**: lo que hay para subir hoy a las redes.
- **Problemas**: productos que salieron del sitio y por qué.
- **Métricas**: clics hacia Mercado Libre y los datos de la Central de
  Afiliados que se anotan a mano.
- **Actividad**: quién hizo qué en el admin.
- **Configuración**: parámetros de afiliado y links directos.

## Variables de entorno

La lista completa, con la explicación de cada una, está en
[`.env.local.example`](.env.local.example). Las indispensables:

| Variable | Para qué sirve |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Leer el catálogo (lectura pública). |
| `SUPABASE_SERVICE_ROLE_KEY` | Escribir desde los crons y el admin. Solo en el servidor. |
| `ADMIN_USERS` | Claves del admin, una por persona: `nombre:clave,nombre2:clave2`. |
| `CRON_SECRET` | Secreto de los crons, 16 caracteres o más (idealmente 32). |
| `ML_CLIENT_ID` / `ML_CLIENT_SECRET` | App de Mercado Libre para leer precios y fichas. |
| `AFFILIATE_TOOL` / `AFFILIATE_WORD` | `AFFILIATE_TOOL` (matt_tool) identifica la cuenta de afiliado: el admin rechaza links con otro matt_tool (sin la variable, compara con el guardado en /admin/configuracion). `AFFILIATE_WORD` solo fija el matt_word de los links directos y no se usa para decidir de quién es un link. |
| `RESEND_API_KEY` / `DIGEST_TO` / `DIGEST_FROM` | Correo diario y respaldo semanal. `DIGEST_TO` acepta varias casillas separadas por coma. |
| `NEXT_PUBLIC_SITE_URL` | Dominio público (sitemap, Open Graph). Vacía = el dominio de Vercel. |

Opcionales: `HEALTHCHECK_REFRESH_URL`, `HEALTHCHECK_PROSPECT_URL`,
`HEALTHCHECK_BACKUP_URL`, `HEALTH_MAX_PRICE_AGE_MIN`, `HEALTH_MAX_OLDEST_PRICE_AGE_MIN`, `MIN_COMMISSION_CLP`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHANNEL_ID`,
`NEXT_PUBLIC_TELEGRAM_URL`.

Las variables se cargan en Vercel → Settings → Environment Variables. Un
cambio de variable recién se aplica en el siguiente deploy.

## Base de datos (Supabase)

Las migraciones están en `supabase/migrations` y se corren **a mano, en
orden**, en el SQL Editor de Supabase. El código está hecho para seguir
funcionando si una migración nueva todavía no se aplicó (la parte nueva
simplemente no aparece), así que el orden seguro es: aplicar la migración y
después publicar, o publicar y aplicarla apenas se pueda.

- `0001` a `0010`: tablas de productos, candidatos y configuración. Ya
  aplicadas.
- `0011`: refresco cada 30 minutos con `pg_cron`. Ya aplicada. Antes de
  correrla por primera vez se guarda el secreto en el Vault:
  `select vault.create_secret('<valor de CRON_SECRET>', 'cron_secret');`
- `0012` a `0018`: ya aplicadas (comprobado el 05-10-2026).
  1. `0012_seguridad.sql` — cierra la función de aprobación para que solo
     la use el servidor, oculta de la API pública los productos ocultos y
     evita productos repetidos. Para comprobar que quedó bien:
     `select has_function_privilege('anon', 'public.promote_candidate_to_product(uuid,text,text)', 'execute');`
     debe dar `false`.
  2. `0013_auditoria_admin.sql` — registro de quién hizo qué en el admin.
  3. `0014_revision_candidatos.sql` — revisión de candidatos por tandas y
     rechazos recuperables.
  4. `0015_clics.sql` — medición de clics hacia Mercado Libre.
  5. `0016_historial_precios.sql` — historial de precios.
  6. `0017_contenido.sql` — contenido para redes y Telegram.
  7. `0018_operacion.sql` — historial de los crons (`cron_runs`) y datos
     extra de la prospección.

## Desarrollo local

Requiere Node.js 20 o más nuevo.

```bash
npm install
cp .env.local.example .env.local   # y completar los valores
npm run dev                        # http://localhost:3000
```

Sin las variables de Supabase el sitio no funciona, a propósito: ya no hay
datos de ejemplo, porque un deploy con las variables mal puestas habría
publicado productos inventados.

Antes de subir un cambio:

```bash
npm run typecheck   # revisa tipos
npm test            # tests (vitest)
npm run build       # el mismo build que hace Vercel
```

GitHub Actions corre `typecheck` y los tests en cada push y pull request
(`.github/workflows/ci.yml`). Dependabot propone una vez por semana los
parches de seguridad de las dependencias.

## Seguridad

- Cabeceras de seguridad en todo el sitio (`next.config.js`): sin iframes,
  política de contenido (CSP) en producción y `noindex` en `/admin` y
  `/api`.
- Las imágenes de productos se piden directo al CDN de Mercado Libre en el
  tamaño justo (`src/lib/ml-image-loader.ts`), sin gastar la cuota de
  optimización de imágenes de Vercel.
- El repositorio es público: ningún secreto va en el código ni en las
  migraciones.
