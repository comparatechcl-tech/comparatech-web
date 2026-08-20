-- Guarda el vendedor específico (seller_id) al que apunta el affiliate_url
-- ya generado. Sin esto, el refresco de precio no puede distinguir "el
-- vendedor de este link cambió de precio" de "otro vendedor más barato
-- apareció" — y terminaría mostrando un precio que no coincide con lo que
-- el usuario paga al hacer click.

alter table products add column if not exists seller_id bigint;

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
    ml_product_id, seller_id
  )
  select
    p_slug, name, coalesce(brand, ''), category, price, original_price, image_url,
    p_affiliate_url, description, specs, seller_reputation, seller_sales_count,
    ml_product_id, seller_id
  from product_candidates
  where id = candidate_id
  returning id into new_id;

  update product_candidates
  set status = 'approved', reviewed_at = now(), affiliate_url = p_affiliate_url
  where id = candidate_id;

  return new_id;
end;
$$;
