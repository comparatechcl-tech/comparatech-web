-- ComparaTech — operacion confiable: bitacora de los crons y senales de
-- prospeccion en los candidatos.
--
-- Aditiva y segura de correr antes o despues del deploy: mientras no exista,
-- los crons trabajan sin bitacora y la prospeccion guarda los candidatos sin
-- las columnas nuevas (reintenta sin ellas). Se puede volver a correr sin
-- problema.

-- 1. Una fila por corrida de cada cron (prospect, refresh-prices, backup,
--    social-telegram). Sirve para que el admin y /api/health digan cuando
--    corrio cada uno y como termino: un cron que se cae de madrugada no
--    avisa de ninguna otra forma.
--
--    RLS activado y sin policies: solo el backend (service role) lee y
--    escribe. Puede tener mensajes de error con detalles internos.
create table if not exists cron_runs (
  id bigserial primary key,
  job text not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  ok boolean,
  summary jsonb,
  error text
);
create index if not exists cron_runs_job_started_idx on cron_runs (job, started_at desc);
alter table cron_runs enable row level security; -- sin policies

-- 2. Senales de cada candidato para ordenar la cola por lo que mas paga.
--
--    highlight_position / highlight_category_id: mejor posicion en los
--    destacados de ML (1 = el mas vendido) y en que categoria. Si aparece en
--    varias, queda la mejor.
--    ml_root_category: categoria raiz del ganador. Define la comision de
--    afiliado (Hogar paga el doble que Tecnologia, ver lib/commission).
--    is_full / official_store: el ganador despacha con Full o es tienda
--    oficial; se muestran como insignias en la revision.
--    checked_at: ultima vez que el cron volvio a mirar el candidato en ML.
--    Con mas de 100 pendientes no alcanzan todos en una corrida: se refrescan
--    primero los que llevan mas tiempo sin revisar.
alter table product_candidates add column if not exists highlight_position integer;
alter table product_candidates add column if not exists highlight_category_id text;
alter table product_candidates add column if not exists ml_root_category text;
alter table product_candidates add column if not exists is_full boolean;
alter table product_candidates add column if not exists official_store boolean;
alter table product_candidates add column if not exists checked_at timestamptz;

-- El refresco de la cola lee los pendientes por checked_at (nulls primero).
create index if not exists product_candidates_status_checked_idx
  on product_candidates (status, checked_at asc nulls first);
