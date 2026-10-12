import { describe, expect, it } from 'vitest';
import { ImageResponse } from 'next/og';
import sharp from 'sharp';
import { interFonts } from '@/lib/content/og-fonts';
import type { OgProduct } from '@/lib/content/og-template';
import { StoryTemplate, fitName, textWidth } from '@/lib/content/story-template';

const product = (over: Partial<OgProduct> = {}): OgProduct => ({
  name: 'Parlante Bluetooth JBL Grip bt Squad',
  brand: 'JBL',
  price: 61_990,
  original_price: 99_990,
  image_url: 'https://http2.mlstatic.com/D_NQ_NP_123-F.jpg',
  price_checked_at: '2026-10-12T01:00:00.000Z',
  offer_info: { free_shipping: true, is_full: true },
  ...over,
});

describe('textWidth', () => {
  const W = Array.from({ length: 95 }, () => 500);

  it('mide en px según el tamaño y suma el interletrado por letra', () => {
    expect(textWidth('abcd', W, 100)).toBe(200);
    expect(textWidth('abcd', W, 100, -1)).toBe(196);
  });

  it('una letra con tilde mide lo que su letra base, y lo desconocido se cuenta ancho', () => {
    expect(textWidth('á', W, 100)).toBe(textWidth('a', W, 100));
    expect(textWidth('ñ', W, 100)).toBe(textWidth('n', W, 100));
    expect(textWidth('日', W, 100)).toBe(100);
  });
});

describe('fitName', () => {
  it('un nombre corto va en un renglón, al tamaño grande', () => {
    expect(fitName('Dji Osmo Pocket 4 Creator Combo')).toEqual({ size: 52, line: 60, rows: ['Dji Osmo Pocket 4 Creator Combo'] });
  });

  it('un nombre largo va en dos renglones parejos, sin perder palabras', () => {
    const name = 'FA607NUQ-RL060W AMD Ryzen 7 170C 16GB 512GB 16" 4050 RTX 6GB';
    const fit = fitName(name);
    expect(fit.size).toBe(50);
    expect(fit.rows).toHaveLength(2);
    expect(fit.rows!.join(' ')).toBe(name);
    // "Ryzen 7" no se separa: el número va con su modelo.
    expect(fit.rows![0].endsWith('Ryzen')).toBe(false);
  });

  it('no deja un conector colgando ni separa un número de su unidad', () => {
    const fit = fitName('Refrigerador Side by Side 578 lt Space Max con Dispensador');
    expect(fit.rows).toHaveLength(2);
    expect(fit.rows![0]).not.toMatch(/ (con|de|578)$/);
  });

  it('una palabra más ancha que el renglón queda para que la corte el dibujante', () => {
    expect(fitName('X'.repeat(80)).rows).toBeNull();
  });
});

describe('StoryTemplate', () => {
  async function draw(p: OgProduct): Promise<{ width?: number; height?: number; format?: string }> {
    const response = new ImageResponse(<StoryTemplate product={p} photo={null} />, {
      width: 1080,
      height: 1920,
      fonts: await interFonts(),
    });
    const meta = await sharp(Buffer.from(await response.arrayBuffer())).metadata();
    return { width: meta.width, height: meta.height, format: meta.format };
  }

  it('se dibuja con las fuentes del repositorio, también en los casos extremos', async () => {
    const full = product({ name: `${'Notebook Gamer Pantalla 144 Hz '.repeat(3)}Windows 11 Home`, price: 12_345_678, original_price: 19_999_990 });
    const bare = product({ brand: null, original_price: null, offer_info: null, price_checked_at: null });
    for (const p of [product(), full, bare]) {
      expect(await draw(p)).toEqual({ width: 1080, height: 1920, format: 'png' });
    }
  }, 60_000);
});
