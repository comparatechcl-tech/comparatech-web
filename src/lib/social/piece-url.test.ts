import { describe, expect, it } from 'vitest';
import {
  PIECE_TTL_SECONDS,
  checkPiecePath,
  pieceKey,
  piecePath,
  snapshotOf,
  type PieceSnapshot,
} from '@/lib/social/piece-url';

/**
 * La dirección de la pieza es pública: lo único que impide dibujar una
 * "oferta" inventada con la marca del sitio es la firma.
 */

const ENV = { CRON_SECRET: 'un-secreto-de-prueba-de-mas-de-32-caracteres' } as unknown as NodeJS.ProcessEnv;
const KEY = pieceKey(ENV)!;
const NOW = 1_800_000_000;

const SNAPSHOT: PieceSnapshot = {
  productId: '3f2b6c1e-9a4d-4e7b-8c21-5d6e7f8a9b0c',
  format: 'feed',
  price: 199990,
  listPrice: 299990,
  checkedAt: NOW - 600,
  freeShipping: true,
  full: false,
  expiresAt: NOW + 3600,
};

function split(path: string): { id: string; file: string } {
  const [, , , id, file] = path.split('/');
  return { id, file };
}

describe('pieceKey', () => {
  it('sin CRON_SECRET, o con uno corto, no hay clave', () => {
    expect(pieceKey({} as NodeJS.ProcessEnv)).toBeNull();
    expect(pieceKey({ CRON_SECRET: 'corto' } as unknown as NodeJS.ProcessEnv)).toBeNull();
    // Alcanza para los crons (16), no para firmar direcciones públicas.
    expect(pieceKey({ CRON_SECRET: 'x'.repeat(31) } as unknown as NodeJS.ProcessEnv)).toBeNull();
    expect(pieceKey({ CRON_SECRET: 'x'.repeat(32) } as unknown as NodeJS.ProcessEnv)).not.toBeNull();
  });

  it('la clave no es el secreto de los crons', () => {
    expect(KEY.toString('utf8')).not.toContain(ENV.CRON_SECRET!);
    expect(KEY.toString('hex')).not.toBe(Buffer.from(ENV.CRON_SECRET!).toString('hex'));
  });
});

describe('piecePath / checkPiecePath', () => {
  it('una dirección recién firmada se lee igual que se escribió', () => {
    const path = piecePath(SNAPSHOT, KEY)!;
    expect(path).toMatch(/^\/social\/pieza\/3f2b6c1e-9a4d-4e7b-8c21-5d6e7f8a9b0c\/feed-199990-299990-\d+-1-\d+-[0-9a-f]{32}\.jpg$/);
    const { id, file } = split(path);
    expect(checkPiecePath(id, file, KEY, NOW)).toEqual({ ok: true, snapshot: SNAPSHOT });
  });

  it('cambiar cualquier dato invalida la firma', () => {
    const { id, file } = split(piecePath(SNAPSHOT, KEY)!);
    const parts = file.replace('.jpg', '').split('-');
    const tampered = [
      ['story', ...parts.slice(1)], // otro formato
      [parts[0], '99990', ...parts.slice(2)], // otro precio
      [...parts.slice(0, 2), '999990', ...parts.slice(3)], // otro precio de lista
      [...parts.slice(0, 3), String(NOW), ...parts.slice(4)], // otra hora
      [...parts.slice(0, 4), '3', ...parts.slice(5)], // otros avisos
      [...parts.slice(0, 5), String(NOW + 999_999), parts[6]], // otro vencimiento
    ];
    for (const t of tampered) {
      expect(checkPiecePath(id, `${t.join('-')}.jpg`, KEY, NOW)).toEqual({ ok: false, reason: 'firma' });
    }
    // La firma de un producto no sirve para otro.
    const other = '00000000-0000-4000-8000-000000000000';
    expect(checkPiecePath(other, file, KEY, NOW)).toEqual({ ok: false, reason: 'firma' });
  });

  it('una firma hecha con otra clave no pasa', () => {
    const otherKey = pieceKey({ CRON_SECRET: 'otro-secreto-de-prueba-de-mas-de-32-caracteres' } as unknown as NodeJS.ProcessEnv)!;
    const { id, file } = split(piecePath(SNAPSHOT, otherKey)!);
    expect(checkPiecePath(id, file, KEY, NOW)).toEqual({ ok: false, reason: 'firma' });
  });

  it('vence: pasada la fecha, la misma dirección deja de servir', () => {
    const { id, file } = split(piecePath(SNAPSHOT, KEY)!);
    expect(checkPiecePath(id, file, KEY, SNAPSHOT.expiresAt)).toMatchObject({ ok: true });
    expect(checkPiecePath(id, file, KEY, SNAPSHOT.expiresAt + 1)).toEqual({ ok: false, reason: 'vencida' });
  });

  it('rechaza lo que no tiene la forma de una dirección', () => {
    const { id, file } = split(piecePath(SNAPSHOT, KEY)!);
    const bad = [
      file.replace('.jpg', '.png'),
      file.replace('.jpg', ''),
      file.replace('feed-', 'pin-'),
      file.replace('feed-199990', 'feed-0199990'), // ceros a la izquierda: otra forma de escribir lo mismo
      file.replace('feed-199990', 'feed--199990'),
      `${file}/..`,
      '',
    ];
    for (const f of bad) expect(checkPiecePath(id, f, KEY, NOW)).toEqual({ ok: false, reason: 'formato' });
    expect(checkPiecePath('no-es-un-id', file, KEY, NOW)).toEqual({ ok: false, reason: 'formato' });
  });

  it('cada pieza tiene una sola dirección: el id en mayúsculas no pasa', () => {
    const { id, file } = split(piecePath({ ...SNAPSHOT, productId: SNAPSHOT.productId.toUpperCase() }, KEY)!);
    expect(id).toBe(SNAPSHOT.productId);
    expect(checkPiecePath(id, file, KEY, NOW)).toMatchObject({ ok: true });
    expect(checkPiecePath(id.toUpperCase(), file, KEY, NOW)).toEqual({ ok: false, reason: 'formato' });
  });

  it('no firma datos imposibles', () => {
    expect(piecePath({ ...SNAPSHOT, price: 0 }, KEY)).toBeNull();
    expect(piecePath({ ...SNAPSHOT, price: 1.5 }, KEY)).toBeNull();
    expect(piecePath({ ...SNAPSHOT, price: -1 }, KEY)).toBeNull();
    expect(piecePath({ ...SNAPSHOT, productId: 'x' }, KEY)).toBeNull();
  });
});

describe('snapshotOf', () => {
  const now = new Date(NOW * 1000);
  const product = {
    id: SNAPSHOT.productId,
    price: 199990,
    original_price: 299990,
    price_checked_at: new Date((NOW - 600) * 1000).toISOString(),
    offer_info: { free_shipping: true, is_full: null },
  };

  it('congela el precio, la hora y los avisos del producto', () => {
    const snapshot = snapshotOf(product, 'feed', now);
    expect({ ...snapshot, expiresAt: SNAPSHOT.expiresAt }).toEqual(SNAPSHOT);
  });

  it('vence al fin del día más dos semanas: pedida dos veces en el día, es la misma dirección', () => {
    const morning = new Date('2026-10-10T03:00:00Z');
    const night = new Date('2026-10-10T23:59:00Z');
    const a = snapshotOf(product, 'feed', morning);
    const b = snapshotOf(product, 'feed', night);
    expect(a.expiresAt).toBe(b.expiresAt);
    expect(a.expiresAt).toBe(Date.parse('2026-10-11T00:00:00Z') / 1000 + PIECE_TTL_SECONDS);
    expect(piecePath(a, KEY)).toBe(piecePath(b, KEY));
    expect(snapshotOf(product, 'feed', new Date('2026-10-11T00:00:01Z')).expiresAt).toBeGreaterThan(a.expiresAt);
  });

  it('un precio de lista igual o menor no cuenta como rebaja', () => {
    expect(snapshotOf({ ...product, original_price: 199990 }, 'feed', now).listPrice).toBe(0);
    expect(snapshotOf({ ...product, original_price: 150000 }, 'feed', now).listPrice).toBe(0);
    expect(snapshotOf({ ...product, original_price: null }, 'feed', now).listPrice).toBe(0);
  });

  it('sin hora de revisión no inventa una', () => {
    expect(snapshotOf({ ...product, price_checked_at: null }, 'story', now).checkedAt).toBe(0);
    expect(snapshotOf({ ...product, price_checked_at: 'no es fecha' }, 'story', now).checkedAt).toBe(0);
  });
});
