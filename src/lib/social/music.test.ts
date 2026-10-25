import { describe, expect, it } from 'vitest';
import { listMusic, pickTrack, signMusic } from './music';

/** La música de fondo de los reels (lib/social/music): qué canción le toca a cada video y qué se lista. */

describe('pickTrack', () => {
  const tracks = ['a.mp3', 'b.mp3', 'c.mp3', 'd.mp3'];

  it('sin canciones, ninguna', () => {
    expect(pickTrack([], '2026-10-25|x')).toBeNull();
  });

  it('el mismo video recibe siempre la misma canción', () => {
    expect(pickTrack(tracks, '2026-10-25|p1')).toBe(pickTrack(tracks, '2026-10-25|p1'));
  });

  it('se reparten entre todas', () => {
    const used = new Set(Array.from({ length: 60 }, (_, i) => pickTrack(tracks, `2026-10-25|p${i}`)));
    expect(used.size).toBe(tracks.length);
  });
});

describe('listMusic y signMusic', () => {
  const admin = (list: unknown, signed: unknown = null) =>
    ({
      storage: {
        from: () => ({
          list: async () => list,
          createSignedUrl: async () => signed,
        }),
      },
    }) as never;

  it('solo archivos de audio con nombre simple, ordenados', async () => {
    const files = [{ name: 'z.mp3' }, { name: 'a.m4a' }, { name: 'nota.txt' }, { name: 'con espacio.mp3' }, { name: '.vacio.mp3' }];
    expect(await listMusic(admin({ data: files, error: null }))).toEqual(['a.m4a', 'z.mp3']);
  });

  it('sin bucket o con error: lista vacía y sin dirección', async () => {
    expect(await listMusic(admin({ data: null, error: { message: 'Bucket not found' } }))).toEqual([]);
    expect(await signMusic(admin(null, { data: null, error: { message: 'x' } }), 'a.mp3')).toBeNull();
    expect(await signMusic(admin(null, { data: { signedUrl: 'https://x/storage/v1/object/sign/musica/a.mp3?token=t' }, error: null }), 'a.mp3')).toBe(
      'https://x/storage/v1/object/sign/musica/a.mp3?token=t'
    );
  });
});
