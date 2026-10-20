import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

/**
 * /historial-de-precios dibujada a HTML con datos fijos: el buscador que
 * lleva a /buscar, las páginas por modelo con versiones a la venta, qué
 * pasa sin bajas, cómo se arma el registro y la voz de la marca.
 */

vi.mock('next/navigation', () => ({ usePathname: () => '/historial-de-precios', useSearchParams: () => null }));
vi.mock('@/lib/queries/deals', () => ({
  getDealsWithStats: vi.fn(async () => ({ deals: [], stats: new Map(), unread: new Set() })),
}));
vi.mock('@/lib/queries/products', () => ({ getCatalogProducts: vi.fn(async () => []) }));

import HistorialDePreciosPage, { metadata } from '@/app/historial-de-precios/page';
import { getCatalogProducts } from '@/lib/queries/products';
import { SEO_TITLE_MAX } from '@/lib/seo-title';
import type { Product } from '@/lib/types';

const AVOIDED =
  /precio de lista|lista \$|recomendad|verificad|mejor precio|m[aá]s barat|imperdible|ofert[oó]n|solo hoy|[uú]ltimas unidades|antes \$|rebaj|precio normal|ahorra|comisi[oó]n|publicidad|probad/i;

function text(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ');
}

const iphone = {
  id: 'p1',
  slug: 'iphone-17-256gb-lavanda',
  name: 'Apple iPhone 17 (256 GB) - Lavanda',
  brand: 'Apple',
  category: 'celulares',
  ml_domain_id: 'MLC-CELLPHONES',
  price: 1_099_990,
  original_price: null,
} as unknown as Product;

async function render(catalog: Product[]) {
  vi.mocked(getCatalogProducts).mockResolvedValue(catalog);
  return renderToStaticMarkup(await HistorialDePreciosPage());
}

describe('/historial-de-precios', () => {
  it('título para Google que cabe, canonical propio y descripción corta', () => {
    const title = (metadata.title as { absolute: string }).absolute;
    expect(title).toBe('Historial de precios de Mercado Libre Chile | ComparaTech');
    expect(title.length).toBeLessThanOrEqual(SEO_TITLE_MAX);
    expect(String(metadata.description).length).toBeLessThanOrEqual(160);
    expect(metadata.alternates?.canonical).toBe('/historial-de-precios');
  });

  it('el buscador lleva a /buscar, y cuenta cuántos productos se siguen', async () => {
    const html = await render([iphone]);
    const t = text(html);
    expect(html).toMatch(/<form[^>]*action="\/buscar"[^>]*method="get"/);
    expect(html).toContain('name="q"');
    expect(t).toContain('Historial de precios de Mercado Libre');
    expect(t).toContain('el precio de 1 productos');
  });

  it('las páginas por modelo, solo las que tienen alguna versión a la venta', async () => {
    const html = await render([iphone]);
    expect(html).toContain('href="/modelo/iphone-17"');
    expect(html).not.toContain('href="/modelo/ps5"');
    const empty = await render([]);
    expect(text(empty)).not.toContain('Historial por modelo');
  });

  it('sin bajas lo dice; explica cómo saber si un descuento es real y cómo se arma el registro', async () => {
    const t = text(await render([]));
    expect(t).toContain('Hoy no registramos bajas de precio en las ofertas.');
    expect(t).toContain('Cómo saber si un descuento es de verdad');
    expect(t).toContain('Cómo armamos el historial');
    expect(t).toContain('"Bajó $X" sale solo cuando el precio de hoy es 3% o más menor');
    expect(t).not.toMatch(AVOIDED);
  });
});
