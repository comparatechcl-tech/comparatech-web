# ComparaTech — Web (Next.js)

Migración de la base técnica del comparador de precios de ComparaTech a
Next.js (App Router, SSR/SSG), partiendo desde cero según lo acordado.
Reusa el diseño visual del scaffold original de Bolt.new (fondo `#080C14`,
acento `#00D4FF`, Space Grotesk + Inter).

## Estado de este scaffold

El sitio corre **sin credenciales reales**: si no hay variables de entorno
de Supabase configuradas, `lib/queries/products.ts` sirve 8 productos de
ejemplo (`lib/mock-data.ts`) para que todas las páginas sean navegables
desde el día uno. En cuanto agregues las credenciales de Supabase, el mismo
código pasa a leer productos reales, sin cambios adicionales.

## Requisitos

- Node.js 20+
- pnpm, npm o yarn (los comandos abajo usan npm; ajusta si prefieres otro)

## Puesta en marcha local

```bash
npm install
cp .env.local.example .env.local
npm run dev
```

Abre http://localhost:3000.

## Variables de entorno (`.env.local`)

| Variable | Para qué sirve |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Conectar el catálogo real de Supabase (lectura pública). |
| `SUPABASE_SERVICE_ROLE_KEY` | Solo usada por `/api/catalog-sync` (server-side) para escribir productos. Nunca exponerla al cliente. |
| `NEXT_PUBLIC_SITE_URL` | Usada en sitemap, robots, Open Graph y JSON-LD. |
| `ENABLE_CATALOG_SYNC` | En `false` por defecto — el endpoint de sincronización responde 404 hasta que lo actives a propósito. |
| `CATALOG_SYNC_TOKEN` | Token compartido que Make.com debe enviar en el header `x-catalog-sync-token`. |

## Configurar Supabase (proyecto nuevo)

1. Crea un proyecto nuevo en https://supabase.com/dashboard.
2. Corre `supabase/migrations/0001_products.sql` en el SQL editor. Crea la
   tabla `products` con RLS habilitado (lectura pública, sin escritura desde
   el cliente).
3. Copia la URL y el `anon key` a `.env.local`. Copia el `service_role key`
   solo si vas a activar `/api/catalog-sync`.

## Activar la sincronización con Make.com

El endpoint `POST /api/catalog-sync` está implementado pero **desactivado**
por defecto (devuelve 404), tal como se pidió — actívalo solo después de
revisarlo:

1. Define `CATALOG_SYNC_TOKEN` (un secreto largo cualquiera) y
   `SUPABASE_SERVICE_ROLE_KEY` en las variables de entorno de Vercel.
2. Cambia `ENABLE_CATALOG_SYNC` a `true`.
3. En Make.com, configura el módulo HTTP para hacer `POST` a
   `https://<tu-dominio>/api/catalog-sync` con header
   `x-catalog-sync-token: <el mismo secreto>` y body
   `{ "products": [ { ...campos de la tabla products... } ] }`.

## Deploy en Vercel

1. Sube este proyecto a un repositorio de GitHub nuevo.
2. Importa el repo en https://vercel.com/new.
3. Agrega las variables de entorno de la tabla de arriba en el proyecto de
   Vercel (Settings → Environment Variables).
4. El dominio propio (a comprar en NIC.cl) se puede conectar en cualquier
   momento desde Vercel → Settings → Domains, sin bloquear el deploy inicial
   en el dominio `*.vercel.app`.

## Sobre el posicionamiento personal en RRSS

Se agregó una página `/nosotros` y un componente `FounderBio` (usado también
en el home) pensados como ancla del sitio para el bio-link de Instagram/
TikTok de tu pareja como cara del proyecto. Hoy tienen placeholders
(`[Nombre]`, foto genérica) — hay que reemplazarlos con la info real antes
de publicar. La idea de fondo: como no hay años de trayectoria técnica que
mostrar, la propuesta de autoridad se construye con transparencia y
constancia — contenido real probando/comparando productos, no
credenciales — y esta página funciona como el "punto de verdad" al que
apunta cualquier bio de redes.

También se incluye el texto de disclosure de afiliado (exigido por las
reglas del programa de ML) tanto en el footer como en la ficha de producto y
en `/nosotros`.

## Roadmap de automatización con IA (más allá de Make + Haiku para catálogo/copys)

Ideas para evaluar una vez que el sitio esté en producción, aprovechando que
ya van a apoyarse en IA para el catálogo diario:

- **Descripciones y meta descriptions únicas por producto**: generar con
  Claude a partir de las specs crudas, para evitar contenido duplicado
  (malo para SEO) cuando el catálogo se carga en volumen.
- **Texto "por qué lo recomendamos"**: 2-3 líneas por producto generadas a
  partir de sus specs y precio relativo a la categoría, mostradas en la
  ficha de producto.
- **Alt text de imágenes**: generado automáticamente para accesibilidad y
  SEO de imágenes.
- **Detección de bajadas de precio**: comparar el catálogo de hoy contra el
  de ayer (ya disponible vía Make) y generar automáticamente un copy de
  "oferta detectada" para redes, en vez de redactarlo manualmente cada vez.
- **QA de datos cargados**: antes de que el sync escriba en Supabase,
  validar con un modelo económico (Haiku) que categoría/specs sean
  coherentes con el nombre del producto, para filtrar errores de carga.
- **Calendario editorial de RRSS**: generar semanalmente una batería de
  ideas de posts (comparativas, "top 3 del mes", tips de compra) para que
  la persona a cargo de redes solo tenga que grabar/publicar, no idear desde
  cero.

Ninguna de estas ideas está implementada todavía — quedan como propuesta
para priorizar según lo que más ayude a la carga de trabajo real del
proyecto.
