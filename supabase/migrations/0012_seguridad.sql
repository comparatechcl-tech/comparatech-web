-- ComparaTech — cerrar la funcion de aprobacion, ocultar de verdad los
-- productos ocultos e impedir productos duplicados.
--
-- Aditiva y segura de correr antes o despues del deploy: el codigo llama a
-- promote_candidate_to_product con la service role key, que conserva el
-- permiso. Se puede volver a correr sin problema.

-- 1. promote_candidate_to_product es SECURITY DEFINER (corre con permisos
--    del dueno de la tabla y se salta RLS). Postgres le da EXECUTE a PUBLIC
--    por defecto, asi que cualquiera con el anon key -- que va en el HTML
--    del sitio -- podia llamarla por la API y publicar un producto con el
--    link de afiliado que quisiera. Ahora solo la puede ejecutar el backend.
revoke execute on function public.promote_candidate_to_product(uuid, text, text) from public, anon, authenticated;
grant execute on function public.promote_candidate_to_product(uuid, text, text) to service_role;

-- Misma firma que en 0008, con tres cambios:
--  - Rechaza links de afiliado que no sean de Mercado Libre. Se aceptan los
--    mismos formatos que reconoce el admin: meli.la, mercadolibre.com/sec
--    (acortador antiguo de ML) y fichas de www.mercadolibre.cl (links
--    directos con matt_word). Un http:// de esos mismos hosts se guarda
--    como https://.
--  - Marca el candidato como aprobado ANTES de insertar y solo si seguia
--    pendiente: si dos personas aprueban el mismo candidato a la vez, la
--    segunda recibe un error en vez de crear un producto repetido.
--  - search_path fijo: una funcion SECURITY DEFINER sin el puede terminar
--    usando tablas de otro esquema con el mismo nombre.
create or replace function public.promote_candidate_to_product(candidate_id uuid, p_slug text, p_affiliate_url text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_id uuid;
  v_url text := regexp_replace(coalesce(p_affiliate_url, ''), '^http://', 'https://');
begin
  if not (
    v_url like 'https://meli.la/%'
    or v_url like 'https://www.mercadolibre.cl/%'
    or v_url like 'https://mercadolibre.com/sec/%'
    or v_url like 'https://www.mercadolibre.com/sec/%'
  ) then
    raise exception 'affiliate_url no permitido';
  end if;

  update product_candidates
  set status = 'approved', reviewed_at = now(), affiliate_url = v_url
  where id = candidate_id and status = 'pending_review';
  if not found then
    raise exception 'Este candidato ya fue revisado';
  end if;

  insert into products (
    slug, name, brand, category, price, original_price, image_url,
    affiliate_url, description, specs, seller_reputation, seller_sales_count,
    ml_product_id, seller_id, ml_family_id, ml_domain_id
  )
  select
    p_slug, name, coalesce(brand, ''), category, price, original_price, image_url,
    v_url, description, specs, seller_reputation, seller_sales_count,
    ml_product_id, seller_id, ml_family_id, ml_domain_id
  from product_candidates
  where id = candidate_id
  returning id into new_id;

  return new_id;
end;
$$;

-- create or replace conserva los permisos, pero se repiten por las dudas.
revoke execute on function public.promote_candidate_to_product(uuid, text, text) from public, anon, authenticated;
grant execute on function public.promote_candidate_to_product(uuid, text, text) to service_role;

-- Las funciones que se creen de aqui en adelante tampoco quedan abiertas a
-- todos por defecto.
-- Postgres da EXECUTE a PUBLIC en toda funcion nueva como default GLOBAL; un
-- "in schema" no lo puede quitar (la version anterior de esta linea no hacia
-- nada para PUBLIC). Se quita globalmente (para el rol que corre las
-- migraciones, normalmente postgres) y ademas se deshace el grant por esquema
-- que Supabase da a anon/authenticated. OJO: toda funcion nueva que deba
-- ejecutar anon (RPC publica o helper usado en una policy RLS) necesita un
-- grant explicito. Igual, despues de cada funcion SECURITY DEFINER nueva,
-- repetir:
--   revoke execute on function ... from public, anon, authenticated;
--   grant execute on function ... to service_role;
-- Para comprobar: select defaclnamespace, defaclobjtype, defaclacl from pg_default_acl;
-- y, con una funcion de prueba, has_function_privilege('anon', 'public.<fn>()', 'execute')
-- debe dar false.
alter default privileges revoke execute on functions from public;
alter default privileges in schema public revoke execute on functions from anon, authenticated;

-- 2. Lectura publica solo de productos no ocultos. is_hidden es la decision
--    de bajar un producto desde el admin; antes la respetaba solo el codigo
--    del sitio, y la API con el anon key seguia entregandolos. Los inactivos
--    (sin stock) siguen legibles para mostrar la ficha 'sin stock'. El admin
--    usa la service role key, que se salta RLS y sigue viendo todo.
drop policy if exists "Lectura pública de productos" on products;
drop policy if exists "Lectura publica de productos visibles" on products;
create policy "Lectura publica de productos visibles"
  on products for select
  using (not is_hidden);

-- 3. Un producto de ML una sola vez en el catalogo, aunque dos aprobaciones
--    lleguen al mismo tiempo. Verificado antes de escribir esto: 129
--    productos con ml_product_id y 0 duplicados, asi que el indice se crea
--    sin conflicto.
create unique index if not exists products_ml_product_id_uniq
  on products (ml_product_id)
  where ml_product_id is not null;

-- Verificacion despues de correr el archivo (debe dar false):
--   select has_function_privilege('anon', 'public.promote_candidate_to_product(uuid,text,text)', 'execute');
