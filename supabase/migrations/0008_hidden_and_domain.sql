-- ComparaTech — bajar productos a mano + categorizar por dominio de ML.
--
-- 1. is_hidden: permite sacar un producto del sitio desde /admin/productos
--    sin borrarlo. Es distinto de is_active, que lo maneja el cron solo:
--    si usaramos is_active, al dia siguiente el cron veria que el vendedor
--    sigue vigente y volveria a publicar el producto. is_hidden es una
--    decision humana y el cron no la toca.
--
-- 2. ml_domain_id: el tipo de producto exacto segun ML ("MLC-HEADPHONES").
--    La categoria que manda Make viene del bloque de destacados y es
--    demasiado gruesa -- por eso los audifonos entraban como "celulares" y
--    una silla gamer como "computacion". Guardarlo permite recategorizar
--    despues sin volver a consultar ML.

alter table products add column if not exists is_hidden boolean not null default false;
create index if not exists products_is_hidden_idx on products (is_hidden);

alter table products add column if not exists ml_domain_id text;
alter table product_candidates add column if not exists ml_domain_id text;

-- Reemplaza la funcion para que copie ml_domain_id al promover un candidato.
create or replace function promote_candidate_to_product(candidate_id uuid, p_slug text, p_affiliate_url text)
returns uuid
language plpgsql
security definer
as $$
declare
  new_id uuid;
begin
  insert into products (
    slug, name, brand, category, price, original_price, image_url,
    affiliate_url, description, specs, seller_reputation, seller_sales_count,
    ml_product_id, seller_id, ml_family_id, ml_domain_id
  )
  select
    p_slug, name, coalesce(brand, ''), category, price, original_price, image_url,
    p_affiliate_url, description, specs, seller_reputation, seller_sales_count,
    ml_product_id, seller_id, ml_family_id, ml_domain_id
  from product_candidates
  where id = candidate_id
  returning id into new_id;

  update product_candidates
  set status = 'approved', reviewed_at = now(), affiliate_url = p_affiliate_url
  where id = candidate_id;

  return new_id;
end;
$$;
