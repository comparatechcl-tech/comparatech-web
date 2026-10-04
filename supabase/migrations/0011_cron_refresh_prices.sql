-- ComparaTech — refresco de precios cada 30 minutos desde Supabase.
--
-- Vercel Hobby solo permite crons diarios, y el workflow programado de
-- GitHub Actions resultó poco confiable: en vez de cada 30 minutos corrió
-- cada 3 a 6 horas (GitHub atrasa o salta las ejecuciones programadas cuando
-- tiene carga). pg_cron corre dentro de la base y es puntual.
--
-- ANTES de correr este archivo, guardar el secreto del cron en Vault (una
-- sola vez, con el mismo valor de CRON_SECRET en Vercel):
--
--   select vault.create_secret('<valor de CRON_SECRET>', 'cron_secret');
--
-- El secreto NO va en este archivo: el repositorio es público.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Volver a correr esto actualiza el job en vez de duplicarlo.
select cron.schedule(
  'refrescar-precios',
  '*/30 * * * *',
  $$
  select net.http_get(
    url := 'https://comparatech-web.vercel.app/api/cron/refresh-prices',
    headers := jsonb_build_object(
      'Authorization',
      'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    timeout_milliseconds := 60000
  );
  $$
);
