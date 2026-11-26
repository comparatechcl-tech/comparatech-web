-- ComparaTech — precios de otras tiendas, junto al de Mercado Libre.
--
-- CORRER EN EL SQL EDITOR DE SUPABASE. Aditiva y segura de correr antes o
-- despues del deploy: mientras no se corra, el sitio y el admin funcionan
-- igual y simplemente no muestran otras tiendas. Se puede volver a correr.
--
-- Por que existe: desde el 23-11-2026 Mercado Libre no entrega precios a la
-- aplicacion. Otras tiendas chilenas si dejan leer el precio de su ficha, y
-- hay programas de afiliados con precios oficiales (AliExpress, Awin). Cada
-- fila es la ficha de un producto del sitio en UNA de esas tiendas, con el
-- ultimo precio que se vio y cuando.
--
-- Una fila por producto y tienda. El precio es el publicado por la tienda
-- para cualquiera (nunca el que exige su tarjeta), en pesos chilenos.

create table if not exists store_offers (
  id bigserial primary key,
  product_id uuid not null references products(id) on delete cascade,
  -- La tienda, con la clave de lib/stores.ts ('paris', 'maconline', 'aliexpress', ...).
  store text not null,
  -- La direccion limpia de la ficha en la tienda, sin parametros de afiliado.
  url text not null,
  -- El codigo del producto en la tienda (sku). En las tiendas de una ficha por
  -- modelo (MacOnline) dice cual de las versiones es.
  external_id text,
  -- El nombre como lo publica la tienda: sirve para revisar que sea el mismo producto.
  title text,
  -- Quien lo vende dentro de la tienda, si lo dice (Paris vende tambien productos de terceros).
  seller text,
  price integer check (price is null or price > 0),
  -- Cuando se vio ese precio.
  checked_at timestamptz,
  -- Cuando se intento leer por ultima vez, haya resultado o no.
  tried_at timestamptz,
  -- 'activo': con precio. 'sin_stock': la tienda no lo vende ahora.
  -- 'error': varias lecturas fallidas seguidas (no se muestra; se sigue intentando una vez al dia).
  -- 'pausado': no se muestra ni se lee.
  status text not null default 'activo'
    check (status in ('activo', 'sin_stock', 'error', 'pausado')),
  -- Lecturas fallidas seguidas.
  fail_count integer not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  created_by text,
  unique (product_id, store)
);

create index if not exists store_offers_product_idx on store_offers (product_id);
-- La pasada lee primero lo que lleva mas tiempo sin intentarse.
create index if not exists store_offers_tried_idx on store_offers (tried_at asc nulls first);

-- Lectura publica solo de lo que el sitio muestra: ofertas activas de
-- productos visibles. La ficha las lee con el anon key. Las escrituras las
-- hace el backend con la service role, que se salta RLS.
alter table store_offers enable row level security;
drop policy if exists "Lectura publica de otras tiendas" on store_offers;
create policy "Lectura publica de otras tiendas" on store_offers for select
  using (
    status = 'activo'
    and price is not null
    and exists (select 1 from products p where p.id = product_id and not p.is_hidden)
  );

-- Clics hacia otras tiendas. Van aparte de outbound_clicks, que son los
-- clics hacia Mercado Libre y se comparan con su Central de Afiliados: asi
-- esa comparacion no se ensucia. Igual que alla, no se guarda IP,
-- user-agent ni cookies. Sin policies: solo la service role lee y escribe.
create table if not exists store_clicks (
  id bigserial primary key,
  product_id uuid references products(id) on delete set null,
  store text not null,
  src text,
  is_mobile boolean,
  -- Llave diaria irreversible del cliente, para el tope por cliente (lib/click-client-key).
  client_key text,
  created_at timestamptz not null default now()
);
create index if not exists store_clicks_created_idx on store_clicks (created_at desc);
alter table store_clicks enable row level security;

-- Lo que quedo: tiene que salir 1 fila por cada tabla.
select c.relname as tabla, c.relrowsecurity as con_rls,
       (select count(*) from pg_policies p where p.tablename = c.relname) as politicas
from pg_class c
where c.relname in ('store_offers', 'store_clicks') and c.relkind = 'r'
order by c.relname;
