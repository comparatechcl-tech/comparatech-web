-- ComparaTech — revision de candidatos en tandas (/admin/candidatos).
--
-- Aditiva: el admin funciona sin estas columnas (solo no guarda el motivo
-- del rechazo ni quien reviso), asi que se puede correr antes o despues del
-- deploy. Se puede volver a correr sin problema.

-- 1. Por que se rechazo un candidato, en un codigo corto que elige el admin
--    con un toque (no_es_tecnologia, muy_barato, accesorio, duplicado,
--    precio_alto_hoy, precio_o_vendedor_raro, otro). Sirve para ajustar los
--    filtros de la prospeccion y para decidir si conviene recuperarlo.
alter table product_candidates add column if not exists reject_reason text;

-- 2. Quien aprobo, rechazo o recupero el candidato (el usuario del admin).
alter table product_candidates add column if not exists reviewed_by text;

-- 3. 'expired': candidatos que la prospeccion dio de baja porque ya no
--    cumplian los filtros. Se pueden recuperar igual que los rechazados.
alter table product_candidates drop constraint if exists product_candidates_status_check;
alter table product_candidates add constraint product_candidates_status_check
  check (status in ('pending_review','approved','rejected','expired'));

-- 4. La cola se lee filtrando por estado y ordenando por fecha de ingreso.
create index if not exists product_candidates_status_prospected_idx on product_candidates (status, prospected_at desc);
