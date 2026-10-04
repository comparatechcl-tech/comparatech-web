-- ComparaTech — registro de actividad del admin y configuracion privada.
--
-- Aditiva: el codigo funciona sin estas tablas (solo faltan la vista de
-- actividad y la prueba de atribucion), asi que se puede correr antes o
-- despues del deploy. Se puede volver a correr sin problema.

-- 1. Quien cambio que y cuando. Los links de afiliado son la unica fuente de
--    ingresos: si una comision deja de llegar, hay que poder ver quien
--    cambio el matt_word, encendio los links directos o pego un link.
create table if not exists admin_audit_log (
  id bigserial primary key,
  at timestamptz not null default now(),
  actor text not null,
  action text not null,
  target text,
  before jsonb,
  after jsonb
);
create index if not exists admin_audit_log_at_idx on admin_audit_log (at desc);
alter table admin_audit_log enable row level security; -- sin policies: solo service_role

-- 2. Configuracion que no debe ser publica (site_settings se lee con la
--    anon key desde el sitio). Por ahora, el resultado de la prueba de
--    atribucion de los links directos.
create table if not exists admin_private_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);
alter table admin_private_settings enable row level security; -- sin policies (site_settings es publica; esto NO)
