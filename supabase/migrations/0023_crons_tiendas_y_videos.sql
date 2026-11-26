-- ComparaTech — la revision de las otras tiendas y el armado de los videos
-- pasan a tener horario en Supabase.
--
-- CORRER EN EL SQL EDITOR DE SUPABASE, con el codigo de /api/cron/tiendas y
-- /api/cron/videos ya publicado. Mientras no se corra, las dos cosas siguen
-- dependiendo solo del horario de GitHub Actions.
--
-- Por que existe: GitHub atrasa o se salta casi todas las pasadas programadas
-- de este repositorio (el 26-11-2026, "cada 2 horas" eran 2 al dia). pg_cron
-- es puntual.
--
--   tiendas  cada 2 horas, al minuto 17. Vuelve a leer el precio de las fichas
--            de otras tiendas enlazadas en /admin/tiendas. Cada ficha se lee
--            solo cuando le toca (dos veces al dia): una pasada de mas no le
--            pide nada a ninguna tienda.
--   videos   cada media hora, a los minutos 12 y 42. Mira si hay videos por
--            armar y, si los hay, le pide a GitHub que corra la pasada que los
--            arma. Sin la llave GITHUB_VIDEOS_TOKEN en Railway no hace nada.
--
-- Ninguna de las dos le pide nada a Mercado Libre, asi que da lo mismo el
-- minuto respecto de la hora en punto.
--
-- Usa el mismo secreto que las migraciones 0011 y 0019, que ya esta en Vault
-- con el nombre 'cron_secret'. El secreto NO va en este archivo: el
-- repositorio es publico.
--
-- Se puede correr mas de una vez: primero borra los jobs por nombre (si
-- existen) y despues los vuelve a crear.

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule(jobid)
from cron.job
where jobname in ('tiendas', 'videos');

select cron.schedule(
  'tiendas',
  '17 */2 * * *',
  $$
  select net.http_get(
    url := 'https://www.comparatech.cl/api/cron/tiendas',
    headers := jsonb_build_object(
      'Authorization',
      'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    timeout_milliseconds := 300000
  );
  $$
);

select cron.schedule(
  'videos',
  '12,42 * * * *',
  $$
  select net.http_get(
    url := 'https://www.comparatech.cl/api/cron/videos',
    headers := jsonb_build_object(
      'Authorization',
      'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    timeout_milliseconds := 60000
  );
  $$
);

-- Lo que quedo: tienen que salir 2 filas, con active = true.
select jobname, schedule, active
from cron.job
where jobname in ('tiendas', 'videos')
order by jobname;

-- PARA APAGARLAS:
--   select cron.unschedule(jobid) from cron.job where jobname in ('tiendas', 'videos');
