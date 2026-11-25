-- ComparaTech — leer el canal de afiliados de Mercado Libre cada media hora.
--
-- CORRER EN EL SQL EDITOR DE SUPABASE cuando el código de /api/cron/canal ya
-- esté publicado. Mientras no se corra, la pasada igual sale cada 2 horas
-- desde GitHub Actions (.github/workflows/canal.yml), solo que más atrasada.
--
-- Qué hace la pasada: lee la vista pública del canal oficial de afiliados en
-- Telegram y, para los productos que ya están en el sitio, guarda el precio
-- que Mercado Libre publicó ahí, con la hora del aviso. No le pide nada a
-- Mercado Libre.
--
-- Usa el mismo secreto que las migraciones 0019 y 0020, que ya está en Vault
-- con el nombre 'cron_secret'. El secreto NO va en este archivo: el
-- repositorio es público.
--
-- A los minutos 11 y 41: lejos de la hora en punto y del refresco de precios
-- (que corre a los 3 y a los 33).
--
-- Se puede correr más de una vez: primero borra el job por nombre (si existe)
-- y después lo vuelve a crear.

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule(jobid)
from cron.job
where jobname = 'canal-afiliados';

select cron.schedule(
  'canal-afiliados',
  '11,41 * * * *',
  $$
  select net.http_get(
    url := 'https://www.comparatech.cl/api/cron/canal',
    headers := jsonb_build_object(
      'Authorization',
      'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    timeout_milliseconds := 60000
  );
  $$
);

-- Lo que quedó: tiene que salir 1 fila, con active = true.
select jobname, schedule, active
from cron.job
where jobname = 'canal-afiliados';

-- PARA APAGARLA:
--   select cron.unschedule(jobid) from cron.job where jobname = 'canal-afiliados';
