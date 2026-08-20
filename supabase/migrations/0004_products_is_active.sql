-- Permite ocultar un producto del sitio público sin borrar su historial,
-- cuando el cron diario detecta que se dio de baja en ML o el vendedor
-- perdió reputación verde.

alter table products add column if not exists is_active boolean not null default true;
create index if not exists products_is_active_idx on products (is_active);
