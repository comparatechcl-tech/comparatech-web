-- ComparaTech — precio del ganador de la caja de compra, motivos de
-- desactivacion, memoria de la prospeccion y configuracion editable.
--
-- Todo es aditivo: el codigo actual ignora estas columnas y tablas, asi que
-- se puede correr antes del deploy sin riesgo.

-- 1. Productos: por que esta inactivo, desde cuando, y que tan fresco es el
--    precio.
--
--    El precio pasa a seguir al GANADOR de la caja de compra de Mercado Libre
--    (el primero de /products/{id}/items), que es lo que ve el comprador al
--    llegar a la ficha. Antes seguia a la oferta del link de afiliado, y en
--    una auditoria 26 de 80 productos activos mostraban un precio distinto al
--    de la ficha -- en un caso, $735.072 mas caro.
alter table products add column if not exists inactive_reason text
  check (inactive_reason is null or inactive_reason in
    ('sin_ganador', 'ganador_no_verde', 'link_otro_producto'));
alter table products add column if not exists inactive_since timestamptz;
alter table products add column if not exists price_checked_at timestamptz;
alter table products add column if not exists winner_item_id text;

-- Producto de catalogo que muestra el perfil de afiliado al abrir el link.
-- Si no coincide con ml_product_id, el link lleva a otro producto (paso con
-- un Blik Gris que llevaba al Negro, y con un Redmi Watch que abria una
-- Huawei Band). Null = no verificado todavia.
alter table products add column if not exists link_target_product_id text;
alter table products add column if not exists link_checked_at timestamptz;

create index if not exists products_inactive_reason_idx on products (inactive_reason);

-- 2. Lo que la prospeccion ya miro y descarto.
--
--    Sin esto el cron analizaba cada dia los mismos ~60 destacados -- el 82%
--    fuera del mapa de dominios -- y nunca llegaba al resto de la lista: habia
--    675 sin revisar y entraban 1 a 4 candidatos por dia.
--
--    domain_id queda guardado para que, si mas adelante se suma un dominio al
--    mapa, esos productos vuelvan a ser elegibles solos.
create table if not exists prospect_seen (
  ml_product_id text primary key,
  reason        text not null,
  domain_id     text,
  seen_at       timestamptz not null default now()
);
create index if not exists prospect_seen_reason_idx on prospect_seen (reason);
alter table prospect_seen enable row level security;

-- 3. Configuracion editable desde /admin/configuracion.
--
--    Lectura publica a proposito: el sitio la lee para decidir a donde apunta
--    el boton "Ver en Mercado Libre". NO guardar secretos aca -- solo datos que
--    ya son publicos, como los parametros de afiliado que viajan en cada link.
create table if not exists site_settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);
alter table site_settings enable row level security;

drop policy if exists "Lectura publica de configuracion" on site_settings;
create policy "Lectura publica de configuracion"
  on site_settings for select
  using (true);
