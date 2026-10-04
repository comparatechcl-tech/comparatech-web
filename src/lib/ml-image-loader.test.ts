import { describe, expect, it } from 'vitest';
import mlImageLoader from '@/lib/ml-image-loader';

const BASE = 'https://http2.mlstatic.com/D_NQ_NP_898382-MLA99937961431_112025';

describe('mlImageLoader', () => {
  it('usa -V.webp hasta 320 px', () => {
    expect(mlImageLoader({ src: `${BASE}-F.jpg`, width: 16 })).toBe(`${BASE}-V.webp`);
    expect(mlImageLoader({ src: `${BASE}-F.jpg`, width: 320 })).toBe(`${BASE}-V.webp`);
  });

  it('usa -O.webp entre 321 y 500 px', () => {
    expect(mlImageLoader({ src: `${BASE}-F.jpg`, width: 321 })).toBe(`${BASE}-O.webp`);
    expect(mlImageLoader({ src: `${BASE}-F.jpg`, width: 500 })).toBe(`${BASE}-O.webp`);
  });

  it('usa -F.webp sobre 500 px', () => {
    expect(mlImageLoader({ src: `${BASE}-F.jpg`, width: 501 })).toBe(`${BASE}-F.webp`);
    expect(mlImageLoader({ src: `${BASE}-O.jpg`, width: 1920, quality: 75 })).toBe(`${BASE}-F.webp`);
  });

  it('acepta cualquier letra de tamaño y extensión de origen', () => {
    for (const letter of ['I', 'E', 'V', 'O', 'W', 'F']) {
      for (const ext of ['jpg', 'jpeg', 'webp', 'png']) {
        expect(mlImageLoader({ src: `${BASE}-${letter}.${ext}`, width: 300 })).toBe(`${BASE}-V.webp`);
      }
    }
  });

  it('conserva el prefijo D_Q_NP_ y otros subdominios de mlstatic', () => {
    const src = 'https://mla-s1-p.mlstatic.com/D_Q_NP_2X_123456-MLC123_012026-W.jpg';
    expect(mlImageLoader({ src, width: 400 })).toBe(
      'https://mla-s1-p.mlstatic.com/D_Q_NP_2X_123456-MLC123_012026-O.webp'
    );
  });

  it('no toca URLs que no son de mlstatic', () => {
    for (const src of [
      '/hero.jpg',
      'https://picsum.photos/seed/x/600/600',
      'https://evil.com/D_NQ_NP_1-MLA1_1-F.jpg',
      'https://mlstatic.com.evil.com/D_NQ_NP_1-MLA1_1-F.jpg',
      'data:image/png;base64,AAAA',
    ]) {
      expect(mlImageLoader({ src, width: 300 })).toBe(src);
    }
  });

  it('no toca fotos de ML sin el sufijo de tamaño', () => {
    const src = 'https://http2.mlstatic.com/storage/logo.png';
    expect(mlImageLoader({ src, width: 300 })).toBe(src);
  });
});
