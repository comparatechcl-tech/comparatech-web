-- ComparaTech — la historia automática de Instagram (una al día).
--
-- CORRER EN EL SQL EDITOR DE SUPABASE, y solo cuando el dueño haya aprobado la
-- muestra de la imagen y el código de /api/cron/historia-diaria ya esté
-- publicado. Mientras no se corra, no sale ninguna historia automática y el
-- resto del sitio funciona igual.
--
-- Usa el mismo secreto que las migraciones 0011 y 0019, que ya está en Vault
-- con el nombre 'cron_secret'. El secreto NO va en este archivo: el
-- repositorio es público.
--
-- pg_cron usa UTC. Chile en verano es UTC-3:
--   15:40 UTC = 12:40 en Chile (publica)
--   18:40 UTC = 15:40 en Chile (solo reintenta si la primera no pudo)
-- Una pasada de más no publica dos veces (lib/social/meta-story). A los :40 y
-- no en punto: Mercado Libre responde 429 a los pedidos de token unos segundos
-- después de cada hora en punto.
--
-- Se puede correr más de una vez: primero borra el job por nombre (si existe)
-- y después lo vuelve a crear.

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule(jobid)
from cron.job
where jobname = 'historia-diaria';

select cron.schedule(
  'historia-diaria',
  '40 15,18 * * *',
  $$
  select net.http_get(
    url := 'https://www.comparatech.cl/api/cron/historia-diaria',
    headers := jsonb_build_object(
      'Authorization',
      'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    timeout_milliseconds := 120000
  );
  $$
);

-- Lo que quedó: tiene que salir 1 fila, con active = true.
select jobname, schedule, active
from cron.job
where jobname = 'historia-diaria';

-- PARA APAGARLA (también se puede pausar desde /admin/historias):
--   select cron.unschedule(jobid) from cron.job where jobname = 'historia-diaria';
