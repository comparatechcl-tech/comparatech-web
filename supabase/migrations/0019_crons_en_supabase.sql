-- ComparaTech — los crons del sitio pasan de Vercel a Supabase (mudanza a Railway).
--
-- CORRER EL DÍA DEL CAMBIO, EN EL SQL EDITOR DE SUPABASE, y solo cuando
-- https://www.comparatech.cl ya responda desde Railway con su certificado
-- (candado). En el mismo rato se publica el commit que saca los crons de
-- vercel.json: si corrieran los dos, el reel diario, el carrusel, la
-- prospección y el respaldo se pedirían dos veces.
-- Antes de eso NO: hasta el cambio, los crons los sigue llamando Vercel.
--
-- Usa el mismo secreto que la migración 0011, que ya está en Vault con el
-- nombre 'cron_secret'. No hay que crearlo de nuevo, y el secreto NO va en
-- este archivo: el repositorio es público. CRON_SECRET en Railway tiene que
-- ser el mismo valor (se copia de Vercel).
--
-- Qué hace:
-- 1. El refresco de precios cada 30 minutos (job 'refrescar-precios' de la
--    0011) pasa a llamar a www.comparatech.cl en vez de
--    comparatech-web.vercel.app, que deja de ser el sitio. Ese mismo job
--    cubre el refresco diario de las 13:00 UTC de vercel.json: no se duplica.
-- 2. Los otros 7 crons de vercel.json, a la misma hora UTC que allá (pg_cron
--    usa UTC; Chile en verano es UTC-3):
--      prospect          12:07 todos los días (allá "0 12"; ver abajo)
--      social-telegram   14:00 todos los días
--      backup            15:00 los lunes
--      meta-diario       13:30, 15:30 y 18:30 (pasadas 1, 2 y 3)
--      carrusel          14:45 todos los días (solo publica los jueves)
--    prospect va a las 12:07 y no en punto: Mercado Libre responde 429 a los
--    pedidos de token unos segundos después de cada hora en punto, y pg_cron
--    es puntual (Vercel Hobby lo corría en algún minuto de esa hora).
-- 3. Al final muestra los jobs que quedaron, para revisarlos.
--
-- timeout_milliseconds es lo que pg_net espera la respuesta. En Railway no
-- hay tope de 60 s como en Vercel, y el reel diario espera a Meta: 5 minutos
-- de margen. Si pg_net se cansa antes, el sitio igual termina su trabajo y lo
-- anota en cron_runs.
--
-- Se puede correr más de una vez: primero borra los jobs por nombre (solo los
-- que existen) y después los vuelve a crear.

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule(jobid)
from cron.job
where jobname in (
  'refrescar-precios',
  'prospect',
  'social-telegram',
  'backup',
  'meta-diario-1',
  'meta-diario-2',
  'meta-diario-3',
  'carrusel'
);

select cron.schedule(
  'refrescar-precios',
  '*/30 * * * *',
  $$
  select net.http_get(
    url := 'https://www.comparatech.cl/api/cron/refresh-prices',
    headers := jsonb_build_object(
      'Authorization',
      'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    timeout_milliseconds := 120000
  );
  $$
);

select cron.schedule(
  'prospect',
  '7 12 * * *',
  $$
  select net.http_get(
    url := 'https://www.comparatech.cl/api/cron/prospect',
    headers := jsonb_build_object(
      'Authorization',
      'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    timeout_milliseconds := 300000
  );
  $$
);

select cron.schedule(
  'social-telegram',
  '0 14 * * *',
  $$
  select net.http_get(
    url := 'https://www.comparatech.cl/api/cron/social-telegram',
    headers := jsonb_build_object(
      'Authorization',
      'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    timeout_milliseconds := 300000
  );
  $$
);

select cron.schedule(
  'backup',
  '0 15 * * 1',
  $$
  select net.http_get(
    url := 'https://www.comparatech.cl/api/cron/backup',
    headers := jsonb_build_object(
      'Authorization',
      'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    timeout_milliseconds := 300000
  );
  $$
);

select cron.schedule(
  'meta-diario-1',
  '30 13 * * *',
  $$
  select net.http_get(
    url := 'https://www.comparatech.cl/api/cron/meta-diario?pasada=1',
    headers := jsonb_build_object(
      'Authorization',
      'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    timeout_milliseconds := 300000
  );
  $$
);

select cron.schedule(
  'meta-diario-2',
  '30 15 * * *',
  $$
  select net.http_get(
    url := 'https://www.comparatech.cl/api/cron/meta-diario?pasada=2',
    headers := jsonb_build_object(
      'Authorization',
      'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    timeout_milliseconds := 300000
  );
  $$
);

select cron.schedule(
  'meta-diario-3',
  '30 18 * * *',
  $$
  select net.http_get(
    url := 'https://www.comparatech.cl/api/cron/meta-diario?pasada=3',
    headers := jsonb_build_object(
      'Authorization',
      'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    timeout_milliseconds := 300000
  );
  $$
);

select cron.schedule(
  'carrusel',
  '45 14 * * *',
  $$
  select net.http_get(
    url := 'https://www.comparatech.cl/api/cron/carrusel',
    headers := jsonb_build_object(
      'Authorization',
      'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    timeout_milliseconds := 300000
  );
  $$
);

-- Lo que quedó: tienen que salir 8 filas, todas con active = true.
select jobname, schedule, active
from cron.job
where jobname in (
  'refrescar-precios', 'prospect', 'social-telegram', 'backup',
  'meta-diario-1', 'meta-diario-2', 'meta-diario-3', 'carrusel'
)
order by jobname;

-- Para revisar después cómo respondió el sitio (no hace falta correrlo ahora):
--   select id, status_code, timed_out, error_msg, created
--   from net._http_response order by created desc limit 20;
-- y la bitácora propia del sitio:
--   select job, ok, started_at, finished_at, error from cron_runs order by started_at desc limit 20;


-- ─────────────────────────────────────────────────────────────────────────
-- VOLVER ATRÁS (solo si se decide devolver los crons a vercel.json).
--
-- Si se vuelve a Vercel solo con el DNS (www apuntando de nuevo a Vercel),
-- NO hace falta: estos jobs llaman a www.comparatech.cl y les responde
-- Vercel igual. Esto es para el caso de restaurar los crons en vercel.json
-- (revertir el commit "solo el día del cambio"), para que no corran dos
-- veces. Copiar sin los "-- " del comienzo y correr en el SQL Editor:
--
-- select cron.unschedule(jobid)
-- from cron.job
-- where jobname in (
--   'prospect', 'social-telegram', 'backup',
--   'meta-diario-1', 'meta-diario-2', 'meta-diario-3', 'carrusel'
-- );
--
-- select cron.schedule(
--   'refrescar-precios',
--   '*/30 * * * *',
--   $$
--   select net.http_get(
--     url := 'https://comparatech-web.vercel.app/api/cron/refresh-prices',
--     headers := jsonb_build_object(
--       'Authorization',
--       'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
--     ),
--     timeout_milliseconds := 60000
--   );
--   $$
-- );
