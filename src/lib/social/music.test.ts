import { describe, expect, it } from 'vitest';
import {
  MUSIC_LOG_KEY,
  MUSIC_LOG_MAX,
  chooseTrack,
  isChristmasTrack,
  listMusic,
  pickTrack,
  readMusicLog,
  signMusic,
  tracksForTemplate,
  writeMusicLog,
  type TrackUse,
} from './music';

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

describe('tracksForTemplate', () => {
  const tracks = ['musica-1.mp3', 'musica-2.mp3', 'navidad-1.mp3', 'navidad-2.mp3'];

  it('las navideñas van solo con la plantilla navideña', () => {
    expect(isChristmasTrack('navidad-1.mp3')).toBe(true);
    expect(isChristmasTrack('musica-1.mp3')).toBe(false);
    expect(tracksForTemplate(tracks, 'navidad')).toEqual(['navidad-1.mp3', 'navidad-2.mp3']);
    expect(tracksForTemplate(tracks, 'impacto')).toEqual(['musica-1.mp3', 'musica-2.mp3']);
  });

  it('sin navideñas, el reel navideño usa las normales; sin normales, los demás van en silencio', () => {
    expect(tracksForTemplate(['musica-1.mp3'], 'navidad')).toEqual(['musica-1.mp3']);
    expect(tracksForTemplate(['navidad-1.mp3'], 'impacto')).toEqual([]);
  });
});

describe('chooseTrack', () => {
  const pool = Array.from({ length: 8 }, (_, i) => `navidad-${i + 1}.mp3`);

  it('sin canciones, ninguna', () => {
    expect(chooseTrack([], [], '2026-11-10', 'p1')).toBeNull();
  });

  it('el mismo video conserva su canción si se pide de nuevo el mismo día', () => {
    const log: TrackUse[] = [{ date: '2026-11-10', productId: 'p1', track: 'navidad-5.mp3' }];
    expect(chooseTrack(pool, log, '2026-11-10', 'p1')).toBe('navidad-5.mp3');
    // Otro día es otro video: no hereda la canción.
    expect(chooseTrack(pool, log, '2026-11-11', 'p1')).not.toBe('navidad-5.mp3');
  });

  it('toca primero la que nunca sonó, después la que lleva más tiempo sin sonar', () => {
    const log: TrackUse[] = pool.slice(0, 7).map((track, i) => ({ date: '2026-11-09', productId: `p${i}`, track }));
    expect(chooseTrack(pool, log, '2026-11-10', 'nuevo')).toBe('navidad-8.mp3');
    log.push({ date: '2026-11-10', productId: 'nuevo', track: 'navidad-8.mp3' });
    expect(chooseTrack(pool, log, '2026-11-10', 'otro')).toBe('navidad-1.mp3');
  });

  it('un mes de videos: lo que sonó un día no vuelve al día siguiente, y suenan todas', () => {
    // Como hoy: unos 7 videos al día, mitad navideños, mitad normales.
    const regular = Array.from({ length: 16 }, (_, i) => `musica-${i + 1}.mp3`);
    const all = [...regular, ...pool];
    const log: TrackUse[] = [];
    const byDay: Set<string>[] = [];
    for (let d = 1; d <= 30; d++) {
      const date = `2026-11-${String(d).padStart(2, '0')}`;
      const used = new Set<string>();
      for (let v = 0; v < 7; v++) {
        const template = v % 2 === 0 ? 'navidad' : 'impacto';
        const productId = `d${d}v${v}`;
        const track = chooseTrack(tracksForTemplate(all, template), log, date, productId);
        expect(track).not.toBeNull();
        log.push({ date, productId, track: track! });
        used.add(track!);
      }
      expect(used.size).toBe(7);
      byDay.push(used);
    }
    for (let d = 1; d < byDay.length; d++) {
      for (const track of byDay[d]) expect(byDay[d - 1].has(track)).toBe(false);
    }
    expect(new Set(log.map((u) => u.track)).size).toBe(all.length);
  });
});

describe('readMusicLog y writeMusicLog', () => {
  const store = (row: unknown, error: unknown = null) => {
    const saved: unknown[] = [];
    const admin = {
      from: (table: string) => {
        expect(table).toBe('admin_private_settings');
        return {
          select: () => ({ eq: (_k: string, key: string) => ({ maybeSingle: async () => (key === MUSIC_LOG_KEY ? { data: row, error } : { data: null, error: null }) }) }),
          upsert: async (value: unknown) => {
            saved.push(value);
            return { error };
          },
        };
      },
    } as never;
    return { admin, saved };
  };

  it('lee solo lo que tiene la forma correcta', async () => {
    const good = { date: '2026-11-10', productId: 'p1', track: 'musica-1.mp3' };
    const { admin } = store({ value: { uses: [good, { date: 1 }, null, 'x'] } });
    expect(await readMusicLog(admin)).toEqual([good]);
  });

  it('sin fila o con error, lista vacía', async () => {
    expect(await readMusicLog(store(null).admin)).toEqual([]);
    expect(await readMusicLog(store(null, { message: 'caída' }).admin)).toEqual([]);
  });

  it('guarda solo lo último', async () => {
    const { admin, saved } = store(null);
    const log = Array.from({ length: MUSIC_LOG_MAX + 30 }, (_, i) => ({ date: '2026-11-10', productId: `p${i}`, track: 'musica-1.mp3' }));
    expect(await writeMusicLog(admin, log)).toBe(true);
    const row = saved[0] as { key: string; value: { uses: TrackUse[] } };
    expect(row.key).toBe(MUSIC_LOG_KEY);
    expect(row.value.uses).toHaveLength(MUSIC_LOG_MAX);
    expect(row.value.uses[0].productId).toBe('p30');
  });

  it('si no se puede guardar, lo dice sin lanzar', async () => {
    expect(await writeMusicLog(store(null, { message: 'caída' }).admin, [])).toBe(false);
  });
});
