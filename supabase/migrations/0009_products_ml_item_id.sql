-- ComparaTech — guardar a que oferta exacta apunta el link de afiliado.
--
-- El problema: el precio publicado seguia a `seller_id`, elegido durante la
-- prospeccion como el vendedor mas barato con reputacion verde. Pero el link
-- de afiliado se genera aparte, a mano, desde la oferta que Mercado Libre
-- destacaba en ese momento. Son dos cosas independientes y se separaban: en
-- una revision, 6 de 16 productos publicados mostraban el precio de un
-- vendedor distinto al que llevaba el link. En un caso el sitio anunciaba
-- $17.990 y el comprador se encontraba con $19.990.
--
-- `ml_item_id` es el `wid` incrustado en el link (ver lib/affiliate-link).
-- Con eso el precio pasa a seguir al link, que es lo unico que el usuario
-- realmente ve al hacer clic.

alter table products add column if not exists ml_item_id text;
create index if not exists products_ml_item_id_idx on products (ml_item_id);

alter table product_candidates add column if not exists ml_item_id text;
