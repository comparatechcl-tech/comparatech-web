-- ComparaTech — historial de precios y senales de la oferta ganadora.
--
-- Aditiva y segura de correr antes o despues del deploy: el codigo funciona
-- sin estas tablas y columnas (reintenta sin ellas) y empieza a usarlas
-- apenas existen. Se puede volver a correr sin duplicar datos.

-- 1. Historial de precios.
--
--    El "% de descuento" se calcula sobre el precio de lista que informa el
--    vendedor, y hay vendedores con el mismo 55-64% todo el ano. El historial
--    propio es lo unico que permite decir "bajo" o "el mas bajo del mes" sin
--    exagerar. El cron de precios agrega una fila cada vez que cambia el
--    precio del ganador (no en cada revision: asi la tabla crece poco).
--
--    Cada dia sin registrar es un dato que no se recupera, y para Black
--    Friday hacen falta 30 dias de historial.
create table if not exists price_history (
  id bigserial primary key,
  product_id uuid not null references products(id) on delete cascade,
  ml_product_id text not null,
  price integer not null,
  original_price integer,
  seller_id bigint,
  winner_item_id text,
  observed_at timestamptz not null default now()
);

create index if not exists price_history_product_idx on price_history (product_id, observed_at desc);

-- Lectura publica solo del historial de productos visibles: la ficha lo lee
-- con el anon key. Las escrituras las hace el backend con la service role,
-- que se salta RLS, asi que no hay policy de insert.
alter table price_history enable row level security;
drop policy if exists "Lectura publica del historial" on price_history;
create policy "Lectura publica del historial" on price_history for select
  using (exists (select 1 from products p where p.id = product_id and not p.is_hidden));

-- Semilla: solo el precio de hoy de cada producto, visto en price_checked_at.
-- A proposito NO se siembra el precio del candidato al prospectarse: puesto
-- al lado del de hoy, la ficha y /ofertas lo leian como una baja ocurrida el
-- dia de la migracion y como "precio mas bajo desde que lo seguimos", sin
-- nada registrado entre medio. Asi cada fila del historial es un precio que
-- de verdad se vio en su observed_at, y las bajas aparecen solo despues de
-- seguimiento real (las registra applyPricing).
insert into price_history (product_id, ml_product_id, price, original_price, seller_id, winner_item_id, observed_at)
select p.id, p.ml_product_id, p.price, p.original_price, p.seller_id, p.winner_item_id, coalesce(p.price_checked_at, now())
from products p
where p.ml_product_id is not null
  and not exists (select 1 from price_history h where h.product_id = p.id);

-- 2. Senales de la oferta ganadora y categoria.
--
--    offer_info: envio gratis, Full, tienda oficial, garantia y cuantos
--    vendedores hay, tal como los informa Mercado Libre en la ultima
--    revision (ver offerInfoFrom en lib/pricing).
--
--    ml_root_category: la categoria raiz define si la comision de afiliado
--    es 4% (tecnologia) u 8% (hogar, deportes, belleza...). Ver lib/commission.
alter table products add column if not exists offer_info jsonb;
alter table products add column if not exists ml_category_id text;
alter table products add column if not exists ml_root_category text;
