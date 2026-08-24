-- ComparaTech — agrupar variantes del mismo producto.
--
-- El prospector trae cada color como un producto distinto: la Silla Gamer
-- GX2000 negra/azul y la negra/roja son dos ml_product_id separados, con dos
-- fichas y dos tarjetas en el home. De 11 productos publicados, 10 eran
-- pares de variantes — el catalogo real eran 6 productos.
--
-- Mercado Libre ya resuelve esto: /products/{id} devuelve `parent_id`, que es
-- el identificador de la familia (todos los colores del mismo modelo lo
-- comparten). Lo guardamos para poder mostrar una sola tarjeta por familia
-- en los listados, sin perder las fichas individuales de cada variante.

alter table products add column if not exists ml_family_id text;
create index if not exists products_ml_family_id_idx on products (ml_family_id);

alter table product_candidates add column if not exists ml_family_id text;
create index if not exists product_candidates_ml_family_id_idx on product_candidates (ml_family_id);

-- Reemplaza la funcion para que copie ml_family_id al promover un candidato.
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
    ml_product_id, seller_id, ml_family_id
  )
  select
    p_slug, name, coalesce(brand, ''), category, price, original_price, image_url,
    p_affiliate_url, description, specs, seller_reputation, seller_sales_count,
    ml_product_id, seller_id, ml_family_id
  from product_candidates
  where id = candidate_id
  returning id into new_id;

  update product_candidates
  set status = 'approved', reviewed_at = now(), affiliate_url = p_affiliate_url
  where id = candidate_id;

  return new_id;
end;
$$;
