-- ComparaTech — estado de uso en RRSS para productos ya aprobados.
-- Permite marcar desde el admin qué productos aprobados ya se usaron (o se van a usar)
-- como contenido en redes sociales, sin depender de una planilla aparte.

alter table products
  add column if not exists rrss_status text not null default 'sin_usar'
    check (rrss_status in ('sin_usar', 'seleccionado', 'publicado'));

create index if not exists products_rrss_status_idx on products (rrss_status);
