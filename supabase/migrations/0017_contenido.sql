-- ComparaTech — contenido para redes y borrado logico de productos.
--
-- Aditiva y segura de correr antes o despues del deploy: el codigo funciona
-- sin estas columnas ni la tabla (reintenta sin ellas) y empieza a usarlas
-- apenas existen. Se puede volver a correr sin problema.

-- 1. Productos.
--
--    rrss_published_at / rrss_channel: cuando y donde se publico por ultima
--    vez en redes. Alimentan /hoy (el link de la bio) y evitan repetir el
--    mismo producto en Telegram.
--
--    deleted_at: "Eliminar" desde el admin pasa a ser un borrado logico. El
--    borrado real se llevaba el affiliate_url, que hay que generar a mano en
--    la Central de Afiliados; ahora el producto solo se oculta y el link
--    queda guardado.
--
--    admin_note: nota interna desde "Editar" en /admin/productos. No se
--    muestra en el sitio.
alter table products add column if not exists rrss_published_at timestamptz;
alter table products add column if not exists rrss_channel text;
alter table products add column if not exists deleted_at timestamptz;
alter table products add column if not exists admin_note text;

-- 2. Publicaciones en redes.
--
--    Una fila por post. Las de Telegram las escribe el cron (y las edita
--    cuando cambia el precio o la oferta termina); las demas, el boton
--    "Marcar publicado en" del admin.
create table if not exists social_posts (
  id bigserial primary key,
  product_id uuid references products(id) on delete set null,
  channel text not null check (channel in ('telegram','instagram','tiktok','whatsapp','facebook','pinterest','youtube')),
  external_id text,
  posted_price integer,
  caption text,
  status text not null default 'publicado' check (status in ('borrador','publicado','editado','terminado','error')),
  error text,
  posted_at timestamptz not null default now(),
  updated_at timestamptz
);
create index if not exists social_posts_channel_idx on social_posts (channel, posted_at desc);
create index if not exists social_posts_product_idx on social_posts (product_id);

-- Sin policies: solo el backend (service role) lee y escribe. Los tokens de
-- Telegram viven en las variables de entorno, NUNCA en site_settings, que
-- es de lectura publica.
alter table social_posts enable row level security;
