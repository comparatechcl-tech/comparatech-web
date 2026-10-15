import { describe, expect, it, vi } from 'vitest';

/**
 * Lo que la página de videos da por sabido de lib/social/videos, que es solo
 * de servidor: la lista (de cliente) no puede importarlo y repite dos cosas a
 * mano. Acá se comparan con el módulo de verdad, para que un cambio allá no
 * pase callado acá.
 */

// lib/social/videos arrastra dos módulos que usan cache() de React, que solo
// existe dentro de Next: se reemplazan, acá no se llaman.
vi.mock('@/lib/settings', () => ({ readAffiliateSettings: vi.fn() }));
vi.mock('@/lib/queries/price-history', () => ({ getPriceStatsMany: vi.fn(), getPriceStatsManyChecked: vi.fn() }));
// La lista importa las acciones, que escriben en la base: acá no se usan.
vi.mock('@/app/admin/videos/actions', () => ({ markVideoPosted: vi.fn(), undoVideoPosted: vi.fn() }));

import { isEverywhere, splitReason, type Mark } from '@/app/admin/videos/VideoList';
import { VIDEO_NETWORKS, VIDEO_WARNING_MARK } from '@/lib/social/videos';

describe('la página de videos y lib/social/videos', () => {
  it('parten el motivo por la misma marca: el aviso "Ojo" no se lee como una frase más del motivo', () => {
    const reason = `Parlante JBL, 50% de descuento${VIDEO_WARNING_MARK}otro vendedor lo ofrece a menos`;
    expect(splitReason(reason)).toEqual({
      why: 'Parlante JBL, 50% de descuento',
      warning: 'otro vendedor lo ofrece a menos',
    });
  });

  it('"ya está en las cuatro redes" son exactamente las redes del contrato', () => {
    const mark: Mark = { postId: 1, at: '2026-10-13T12:00:00.000Z' };
    const all: Partial<Record<(typeof VIDEO_NETWORKS)[number], Mark>> = {};
    for (const network of VIDEO_NETWORKS) {
      expect(isEverywhere(all)).toBe(false);
      all[network] = mark;
    }
    expect(isEverywhere(all)).toBe(true);
    expect(VIDEO_NETWORKS).toHaveLength(4);
  });
});
