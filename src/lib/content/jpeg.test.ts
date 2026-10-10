import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { isJpeg, pngToJpeg } from '@/lib/content/jpeg';

/**
 * La conversión usa una librería con binarios por sistema. Este test corre
 * también en GitHub Actions (Linux, como Vercel): si el binario no carga,
 * se sabe acá y no cuando Metricool pide la primera imagen.
 */
describe('pngToJpeg', () => {
  it('convierte un PNG con transparencia en un JPG del mismo tamaño', async () => {
    const png = await sharp({
      create: { width: 8, height: 6, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    })
      .png()
      .toBuffer();

    const jpeg = await pngToJpeg(png, '#070B14');
    expect(isJpeg(jpeg)).toBe(true);

    const meta = await sharp(jpeg).metadata();
    expect(meta).toMatchObject({ format: 'jpeg', width: 8, height: 6 });

    // Lo transparente queda del color de fondo de las piezas, no negro ni blanco.
    const { data } = await sharp(jpeg).raw().toBuffer({ resolveWithObject: true });
    expect(Math.abs(data[0] - 0x07)).toBeLessThan(6);
    expect(Math.abs(data[1] - 0x0b)).toBeLessThan(6);
    expect(Math.abs(data[2] - 0x14)).toBeLessThan(6);
  });

  it('isJpeg no confunde un PNG ni un texto con un JPG', () => {
    expect(isJpeg(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBe(false);
    expect(isJpeg(new TextEncoder().encode('No encontrado'))).toBe(false);
    expect(isJpeg(new Uint8Array())).toBe(false);
  });
});
