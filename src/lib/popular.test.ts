import { describe, expect, it } from 'vitest';
import { POPULAR_MIN_CLICKS, rankPopular, type PopularProduct } from '@/lib/popular';

/*
 * "Los más populares" de la portada: los productos que más se abren en
 * Mercado Libre desde el sitio. Lo que importa: que el orden salga de los
 * clics de verdad, que el clic en otro color cuente para la tarjeta de su
 * modelo, y que no aparezca nada que ya no esté a la venta.
 */

const p = (id: string, name: string, family: string | null = null): PopularProduct => ({ id, name, ml_family_id: family });

const negro = p('negro', 'Audífonos Sony WH-1000XM6 Negro', 'fam-sony');
const plata = p('plata', 'Audífonos Sony WH-1000XM6 Plata', 'fam-sony');
const ps5 = p('ps5', 'Consola PS5 Slim');
const tele = p('tele', 'Smart TV LG 55');
const mouse = p('mouse', 'Mouse Logitech G304');
const mouseOtraFicha = p('mouse2', 'Mouse  Logitech G304'); // la misma, en otra ficha (mismo nombre)

/** Todo lo que está a la venta, y las tarjetas del catálogo (una por producto real). */
const all = [negro, plata, ps5, tele, mouse, mouseOtraFicha];
const catalog = [negro, ps5, tele, mouse];

const times = (id: string, n: number) => Array.from({ length: n }, () => id);

describe('rankPopular', () => {
  it('ordena por clics, del más abierto al menos', () => {
    const clicks = [...times('tele', 3), ...times('ps5', 7), ...times('negro', 5)];
    expect(rankPopular(clicks, all, catalog, 8).map((x) => x.id)).toEqual(['ps5', 'negro', 'tele']);
  });

  it('el clic en otro color, o en otra ficha del mismo artículo, cuenta para su tarjeta', () => {
    const clicks = [...times('plata', 4), ...times('negro', 1), ...times('mouse2', 3), ...times('ps5', 4)];
    // Sony: 4 + 1 = 5. PS5: 4. Mouse: 3 (por el nombre).
    expect(rankPopular(clicks, all, catalog, 8).map((x) => x.id)).toEqual(['negro', 'ps5', 'mouse']);
  });

  it('no cuenta lo que ya no está a la venta ni los clics sin producto', () => {
    const clicks = [...times('borrado', 9), null, undefined, '', ...times('ps5', 2)];
    expect(rankPopular(clicks, all, catalog, 8).map((x) => x.id)).toEqual(['ps5']);
  });

  it('con un solo clic no es popular', () => {
    expect(POPULAR_MIN_CLICKS).toBe(2);
    expect(rankPopular(['tele', ...times('ps5', 2)], all, catalog, 8).map((x) => x.id)).toEqual(['ps5']);
  });

  it('con los mismos clics mantiene el orden del catálogo, y respeta el tope', () => {
    const clicks = [...times('mouse', 2), ...times('tele', 2), ...times('ps5', 2), ...times('negro', 2)];
    expect(rankPopular(clicks, all, catalog, 8).map((x) => x.id)).toEqual(['negro', 'ps5', 'tele', 'mouse']);
    expect(rankPopular(clicks, all, catalog, 2).map((x) => x.id)).toEqual(['negro', 'ps5']);
    expect(rankPopular(clicks, all, catalog, 0)).toEqual([]);
  });

  it('sin clics, nada', () => {
    expect(rankPopular([], all, catalog, 8)).toEqual([]);
  });
});
