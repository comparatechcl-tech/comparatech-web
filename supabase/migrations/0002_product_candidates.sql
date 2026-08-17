-- ComparaTech — staging de productos prospectados automáticamente vía la API
-- de Mercado Libre (highlights + products + items + users). Separada de
-- `products` a propósito: nada de acá se muestra en el sitio hasta que un
-- humano revise el candidato y complete `affiliate_url` a mano (CLAUDE.md).

create table if not exists product_candidates (
  id                  uuid primary key default gen_random_uuid(),
  ml_product_id       text not null unique,
  name                text not null,
  brand               text,
  category            text not null,
  price               integer not null check (price >= 0),
  original_price      integer check (original_price is null or original_price >= 0),
  image_url           text not null,
  description         text not null default '',
  specs               jsonb not null default '{}'::jsonb,
  seller_id           bigint not null,
  seller_nickname     text,
  seller_reputation   text not null
                        check (seller_reputation in ('verde', 'amarillo', 'naranja', 'rojo')),
  seller_sales_count  integer not null default 0,
  affiliate_url       text,
  status              text not null default 'pending_review'
                        check (status in ('pending_review', 'approved', 'rejected')),
  source              text not null default 'ml_api',
  prospected_at       timestamptz not null default now(),
  reviewed_at         timestamptz
);

create index if not exists product_candidates_status_idx on product_candidates (status);
create index if not exists product_candidates_category_idx on product_candidates (category);

-- Nada de lectura pública: esto es data interna de trabajo, no catálogo. Solo
-- se accede con la service role key (endpoint /api/catalog-prospect y, más
-- adelante, la vista de revisión).
alter table product_candidates enable row level security;

-- Promueve un candidato aprobado a la tabla pública `products`. Se llama a
-- mano (SQL editor) después de completar affiliate_url y revisar los datos.
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
    affiliate_url, description, specs, seller_reputation, seller_sales_count
  )
  select
    p_slug, name, coalesce(brand, ''), category, price, original_price, image_url,
    p_affiliate_url, description, specs, seller_reputation, seller_sales_count
  from product_candidates
  where id = candidate_id
  returning id into new_id;

  update product_candidates
  set status = 'approved', reviewed_at = now(), affiliate_url = p_affiliate_url
  where id = candidate_id;

  return new_id;
end;
$$;
