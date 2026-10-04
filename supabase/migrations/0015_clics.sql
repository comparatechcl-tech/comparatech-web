-- ComparaTech — medicion de clics hacia Mercado Libre y datos de la
-- Central de Afiliados.
--
-- Aditiva y segura de correr antes o despues del deploy: mientras no
-- exista, /api/e descarta los clics en silencio y /admin/metricas pide
-- aplicar esta migracion. Se puede volver a correr sin problema.
--
-- Ambas tablas tienen RLS activado y ninguna policy: solo el backend (con
-- la service role key) lee y escribe. El anon key, que va en el HTML del
-- sitio, no puede ni leer los clics ni inventarlos.

-- 1. Un clic en "Ver en Mercado Libre". Sin IP, sin user-agent y sin
--    cookies: solo lo necesario para saber que paginas y productos mueven
--    ventas. Si se borra el producto, el clic queda (cuenta en los totales
--    por dia) sin producto asociado.
create table if not exists outbound_clicks (
  id bigserial primary key,
  product_id uuid references products(id) on delete set null,
  placement text not null,
  link_mode text check (link_mode in ('meli_la','directo','otro')),
  src text,
  is_mobile boolean,
  created_at timestamptz not null default now()
);
create index if not exists outbound_clicks_created_idx on outbound_clicks (created_at desc);
create index if not exists outbound_clicks_product_idx on outbound_clicks (product_id, created_at desc);
alter table outbound_clicks enable row level security; -- sin policies

-- Llave diaria del cliente (hash de IP + user-agent + fecha + secreto del
-- servidor, 16 caracteres; ver src/lib/click-client-key.ts). No se puede
-- volver a la IP y cambia cada dia. Sirve para el tope de clics por cliente
-- en /api/e: sin el, un solo script agotaba el cupo global del dia y se
-- perdian los clics reales. Sin esta columna /api/e usa solo el tope global.
alter table outbound_clicks add column if not exists client_key text;
create index if not exists outbound_clicks_client_idx on outbound_clicks (client_key, created_at desc);

-- 2. Lo que informa la Central de Afiliados de ML, cargado a mano una vez
--    por semana desde /admin/metricas. Sirve para comparar los clics
--    propios con los de ML y calcular la ganancia por clic.
create table if not exists affiliate_reports (
  week_start date primary key,
  ml_clicks integer,
  ml_sales integer,
  ml_pending_clp integer,
  ml_approved_clp integer,
  notes text,
  updated_at timestamptz not null default now()
);
alter table affiliate_reports enable row level security; -- sin policies
