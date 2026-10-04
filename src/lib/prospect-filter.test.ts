import { describe, expect, it } from 'vitest';
import { canRetryCandidate } from '@/lib/prospect-filter';

const NOW = Date.parse('2026-10-04T12:00:00Z');
const daysAgo = (d: number) => new Date(NOW - d * 86_400_000).toISOString();

describe('canRetryCandidate', () => {
  it('un rechazo pasajero vuelve tras 45 días, no antes', () => {
    const row = { status: 'rejected', reject_reason: 'precio_alto_hoy' };
    expect(canRetryCandidate({ ...row, reviewed_at: daysAgo(46) }, NOW)).toBe(true);
    expect(canRetryCandidate({ ...row, reviewed_at: daysAgo(10) }, NOW)).toBe(false);
  });

  it('un rechazo definitivo o sin motivo no vuelve nunca', () => {
    expect(canRetryCandidate({ status: 'rejected', reject_reason: 'no_es_tecnologia', reviewed_at: daysAgo(400) }, NOW)).toBe(false);
    expect(canRetryCandidate({ status: 'rejected', reject_reason: null, reviewed_at: daysAgo(400) }, NOW)).toBe(false);
  });

  it('un vencido vuelve tras 45 días desde que venció', () => {
    expect(canRetryCandidate({ status: 'expired', reviewed_at: daysAgo(46) }, NOW)).toBe(true);
    expect(canRetryCandidate({ status: 'expired', reviewed_at: daysAgo(5) }, NOW)).toBe(false);
    // Sin fecha no se sabe cuándo venció: se deja bloqueado.
    expect(canRetryCandidate({ status: 'expired', reviewed_at: null }, NOW)).toBe(false);
  });

  it('pendientes y aprobados nunca se reprospectan', () => {
    expect(canRetryCandidate({ status: 'pending_review', reviewed_at: daysAgo(100) }, NOW)).toBe(false);
    expect(canRetryCandidate({ status: 'approved', reviewed_at: daysAgo(100) }, NOW)).toBe(false);
  });
});
