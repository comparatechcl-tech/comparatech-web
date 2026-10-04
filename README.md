# ComparaTech — Web

Comparador de precios de tecnología para Chile. Los productos vienen del
catálogo de Mercado Libre y el botón "Ver en Mercado Libre" lleva un link de
afiliado: la comisión de esas compras es el único ingreso del proyecto.

Next.js 15 (App Router) + Supabase, publicado en Vercel (plan Hobby).
Cada push a `main` se publica solo en producción.

## Cómo funciona

1. **Prospección (una vez al día).** `/api/cron/prospect` recorre los
   productos destacados de Mercado Libre en las categorías que sigue el
   sitio, descarta lo que ya conoce o no conviene (vendedor sin reputación
   verde, comisión baja, etc.) y deja el resto en la cola de candidatos
   (`product_candidates`). Al terminar manda el correo diario con lo que
   entró y lo que falta revisar.
2. **Revisión en el admin.** En `/admin/candidatos` una persona aprueba o
   rechaza cada candidato y le pega su link de afiliado (meli.la, generado
   en la Central de Afiliados de ML). Aprobar lo publica en `products`.
3. **Refresco de precios (cada 30 minutos).** `/api/cron/refresh-prices`
   pregunta a ML el precio del ganador de la caja de compra (el que ve el
   comprador al llegar a la ficha), marca sin stock lo que ya no se vende y
   vuelve a generar las páginas que cambiaron.

### Quién llama a los crons

| Origen | Qué llama | Cuándo |
|---|---|---|
| Supabase `pg_cron` (migración `0011`) | `/api/cron/refresh-prices` | Cada 30 minutos. Es el que manda. |
| Vercel Cron (`vercel.json`) | `/api/cron/prospect` y `/api/cron/refresh-prices` | Una vez al día cada uno (Hobby no permite más). |
| GitHub Actions (`.github/workflows/refresh-prices.yml`) | `/api/cron/refresh-prices` | Respaldo, y para lanzarlo a mano desde Actions. |

Todos se identifican con `Authorization: Bearer <CRON_SECRET>`. El secreto
tiene que ser el mismo en los tres lugares: variable de Vercel, secreto
`CRON_SECRET` de GitHub y secreto `cron_secret` del Vault de Supabase. Si
mide menos de 16 caracteres los crons responden 401.

`/api/daily-digest?preview=1` (con el mismo secreto) muestra el correo
diario sin enviarlo.

### Admin

`/admin` está protegido con Basic Auth: el navegador pide usuario y clave.
Cada persona tiene la suya en `ADMIN_USERS` y cada acción del admin vuelve a
verificarla en el servidor. Secciones:

- **Candidatos**: la cola para aprobar o rechazar, con carga de links en
  bloque.
- **Productos**: el catálogo publicado; ocultar, cambiar el link, etc.
- **Problemas**: productos que salieron del sitio y por qué.
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
`HEALTHCHECK_BACKUP_URL`, `HEALTH_MAX_PRICE_AGE_MIN`, `MIN_COMMISSION_CLP`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHANNEL_ID`,
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
- Pendientes, en este orden:
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

Sin las variables de Supabase el sitio muestra 8 productos de ejemplo, para
poder navegarlo igual.

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
