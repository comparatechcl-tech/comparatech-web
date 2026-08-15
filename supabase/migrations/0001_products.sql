-- ComparaTech — tabla de catálogo de productos
-- Ejecutar en el SQL editor de Supabase (proyecto nuevo, según lo acordado
-- para el "fresh start" del proyecto).

create extension if not exists "pgcrypto";

create table if not exists products (
  id                  uuid primary key default gen_random_uuid(),
  slug                text not null unique,
  name                text not null,
  brand               text not null,
  category            text not null,
  price               integer not null check (price >= 0),
  original_price      integer check (original_price is null or original_price >= 0),
  image_url           text not null,
  affiliate_url       text not null,
  description         text not null default '',
  specs               jsonb not null default '{}'::jsonb,
  seller_reputation   text not null default 'verde'
                        check (seller_reputation in ('verde', 'amarillo', 'naranja', 'rojo')),
  seller_sales_count  integer not null default 0,
  is_featured         boolean not null default false,
  created_at          timestamptz not null default now()
);

create index if not exists products_category_idx on products (category);
create index if not exists products_is_featured_idx on products (is_featured);
create index if not exists products_created_at_idx on products (created_at desc);

-- Row Level Security: lectura pública, sin escritura desde el cliente.
-- El endpoint /api/catalog-sync escribe usando la service role key, que
-- bypassa RLS, así que no se necesita una policy de insert/update aquí.
alter table products enable row level security;

create policy "Lectura pública de productos"
  on products for select
  using (true);

-- Nota sobre reglas del Programa de Afiliados de Mercado Libre (CLAUDE.md):
-- solo cargar productos de vendedores con seller_reputation = 'verde', y
-- affiliate_url se completa manualmente hasta confirmar si existe API de
-- generación de links en Chile.
