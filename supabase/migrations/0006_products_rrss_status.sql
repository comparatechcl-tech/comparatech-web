-- ComparaTech — estado de uso en RRSS para productos ya aprobados.
-- Permite a Roxana marcar qué productos aprobados ya usó (o va a usar)
-- como contenido en redes sociales, sin depender de una planilla aparte.

alter table products
  add column if not exists rrss_status text not null default 'sin_usar'
    check (rrss_status in ('sin_usar', 'seleccionado', 'publicado'));

create index if not exists products_rrss_status_idx on products (rrss_status);
