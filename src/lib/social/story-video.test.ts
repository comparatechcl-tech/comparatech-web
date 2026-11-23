import { describe, expect, it, vi } from 'vitest';
import { findStoryVideo, storyVideoObject, type StoryVideoItem } from './story-video';

vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  cache: <T,>(fn: T) => fn,
}));

const ID = '3f2b6c1e-9a4d-4e7b-8c21-5d6e7f8a9b0a';
const ITEM: StoryVideoItem = { id: ID, name: 'Control', brand: 'Sony', price: 59_990, listPrice: 79_990, freeShipping: true, full: false };
const AT = new Date('2026-11-23T15:40:00Z');

describe('storyVideoObject', () => {
  it('lleva el día de Chile, el producto y el precio, y no se confunde con un reel', () => {
    expect(storyVideoObject(ITEM, AT)).toMatch(new RegExp(`^2026-11-23/historia-${ID}-59990-[0-9a-f]{8}\\.mp4$`));
    // A las 23:30 de Chile del 23 ya es 24 en UTC.
    expect(storyVideoObject(ITEM, new Date('2026-11-24T02:30:00Z')).startsWith('2026-11-23/')).toBe(true);
  });

  it('cambia si cambia cualquier dato que la imagen muestra', () => {
    const base = storyVideoObject(ITEM, AT);
    expect(storyVideoObject({ ...ITEM }, new Date(AT.getTime() + 3600_000))).toBe(base);
    for (const change of [{ price: 54_990 }, { listPrice: 89_990 }, { freeShipping: false }, { full: true }, { name: 'Otro' }, { brand: 'Otra' }]) {
      expect(storyVideoObject({ ...ITEM, ...change }, AT)).not.toBe(base);
    }
  });
});

describe('findStoryVideo', () => {
  function admin(entries: { name: string }[] | null, error: unknown = null) {
    const list = vi.fn(async () => ({ data: entries, error }));
    const getPublicUrl = vi.fn((object: string) => ({ data: { publicUrl: `https://almacen.example/reels/${object}` } }));
    return { list, client: { storage: { from: () => ({ list, getPublicUrl }) } } as never };
  }

  it('entrega la dirección solo si está ese nombre exacto', async () => {
    const object = storyVideoObject(ITEM, AT);
    const file = object.split('/')[1];
    const found = admin([{ name: file }]);
    expect(await findStoryVideo(found.client, ITEM, AT)).toBe(`https://almacen.example/reels/${object}`);
    expect(found.list).toHaveBeenCalledWith('2026-11-23', { limit: 5, search: file });
    expect(await findStoryVideo(admin([{ name: `${file}.parcial` }]).client, ITEM, AT)).toBeNull();
  });

  it('si no se puede mirar, sigue sin video', async () => {
    expect(await findStoryVideo(admin(null, { message: 'sin almacén' }).client, ITEM, AT)).toBeNull();
  });
});
