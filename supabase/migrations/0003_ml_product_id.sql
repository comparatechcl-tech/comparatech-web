-- Guarda el ID de Mercado Libre en products para poder refrescar precio/stock
-- después de aprobar un candidato (antes se perdía ese vínculo).

alter table products add column if not exists ml_product_id text;
create index if not exists products_ml_product_id_idx on products (ml_product_id);

-- Reemplaza la función para que copie ml_product_id al promover un candidato.
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
    ml_product_id
  )
  select
    p_slug, name, coalesce(brand, ''), category, price, original_price, image_url,
    p_affiliate_url, description, specs, seller_reputation, seller_sales_count,
    ml_product_id
  from product_candidates
  where id = candidate_id
  returning id into new_id;

  update product_candidates
  set status = 'approved', reviewed_at = now(), affiliate_url = p_affiliate_url
  where id = candidate_id;

  return new_id;
end;
$$;
