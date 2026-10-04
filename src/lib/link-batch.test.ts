import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AffiliateLinkInfo, InspectResult } from '@/lib/affiliate-link';

// Nunca se abren links reales: cada test dice qué "devuelve" cada meli.la.
const inspectMock = vi.fn<(url: string) => Promise<InspectResult>>();
vi.mock('@/lib/affiliate-link', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/affiliate-link')>();
  return { ...actual, inspectAffiliateLink: (url: string) => inspectMock(url) };
});

const { extractAffiliateLinks, matchLinksToTargets, FOREIGN_LINK_REASON } = await import('@/lib/link-batch');

const OWN = { mattWord: 'comparatech', mattTool: '12345678' };
const EXPECTED = { word: 'comparatech', tool: '12345678' };

function info(featuredProductId: string | null, params: Partial<AffiliateLinkInfo> = OWN): AffiliateLinkInfo {
  return { itemId: null, featuredProductId, mattWord: null, mattTool: null, ...params };
}

function setLinks(map: Record<string, AffiliateLinkInfo | null>) {
  inspectMock.mockImplementation(async (url) => {
    const value = map[url];
    return value ? { ok: true, info: value } : { ok: false, error: 'No se pudo abrir el link' };
  });
}

const TARGETS = [
  { id: 'a', mlProductId: 'MLC1' },
  { id: 'b', mlProductId: 'MLC2' },
];

beforeEach(() => {
  inspectMock.mockReset();
});

describe('extractAffiliateLinks', () => {
  it('saca los links en orden, sin repetir, y pasa http a https', () => {
    const text = `
      https://meli.la/AAA
      http://meli.la/BBB texto https://meli.la/AAA
      https://mercadolibre.com/sec/CCC
    `;
    expect(extractAffiliateLinks(text)).toEqual([
      'https://meli.la/AAA',
      'https://meli.la/BBB',
      'https://mercadolibre.com/sec/CCC',
    ]);
  });

  it('un http y un https del mismo link cuentan como uno', () => {
    expect(extractAffiliateLinks('http://meli.la/AAA https://meli.la/AAA')).toEqual(['https://meli.la/AAA']);
  });
});

describe('matchLinksToTargets', () => {
  it('asigna por ficha sin importar el orden en que se pegaron', async () => {
    setLinks({ 'https://meli.la/X2': info('MLC2'), 'https://meli.la/X1': info('MLC1') });
    const match = await matchLinksToTargets('https://meli.la/X2\nhttps://meli.la/X1', TARGETS, EXPECTED);
    expect(match.assigned.map((a) => [a.targetId, a.url, a.verified])).toEqual([
      ['b', 'https://meli.la/X2', true],
      ['a', 'https://meli.la/X1', true],
    ]);
    expect(match.unmatched).toEqual([]);
    expect(match.rejected).toEqual([]);
  });

  it('deja sin asignar un link de otra cuenta de afiliado, con el motivo', async () => {
    setLinks({
      'https://meli.la/OWN': info('MLC1'),
      'https://meli.la/AJENO': info('MLC2', { mattWord: 'otracuenta', mattTool: '999' }),
    });
    const match = await matchLinksToTargets('https://meli.la/OWN https://meli.la/AJENO', TARGETS, EXPECTED);
    expect(match.assigned.map((a) => a.targetId)).toEqual(['a']);
    expect(match.rejected).toEqual([{ url: 'https://meli.la/AJENO', reason: FOREIGN_LINK_REASON }]);
    expect(match.unmatched).toEqual(['https://meli.la/AJENO']);
    expect(FOREIGN_LINK_REASON).toBe('Link de otra cuenta de afiliado');
  });

  it('un link de otra cuenta tampoco se asigna por posición', async () => {
    setLinks({
      'https://meli.la/P1': info(null),
      'https://meli.la/P2': info(null, { mattWord: 'otracuenta', mattTool: '999' }),
    });
    const match = await matchLinksToTargets('https://meli.la/P1 https://meli.la/P2', TARGETS, EXPECTED);
    expect(match.assigned.map((a) => [a.targetId, a.verified])).toEqual([['a', false]]);
    expect(match.unmatched).toEqual(['https://meli.la/P2']);
  });

  it('un matt_word distinto con el matt_tool de la cuenta se asigna igual', async () => {
    // Así resuelven hoy los meli.la propios (matt_word=seplvedaroxana).
    setLinks({ 'https://meli.la/OWN2': info('MLC2', { mattWord: 'seplvedaroxana', mattTool: '12345678' }) });
    const match = await matchLinksToTargets('https://meli.la/OWN2', TARGETS, { word: null, tool: '12345678' });
    expect(match.assigned.map((a) => a.targetId)).toEqual(['b']);
    expect(match.rejected).toEqual([]);
  });

  it('sin `expected` se comporta como antes y asigna el link ajeno', async () => {
    setLinks({ 'https://meli.la/AJENO': info('MLC2', { mattWord: 'otracuenta', mattTool: '999' }) });
    const match = await matchLinksToTargets('https://meli.la/AJENO', TARGETS);
    expect(match.assigned.map((a) => a.targetId)).toEqual(['b']);
    expect(match.rejected).toEqual([]);
  });

  it('dos links a la misma ficha: el segundo queda sin asignar', async () => {
    setLinks({ 'https://meli.la/D1': info('MLC1'), 'https://meli.la/D2': info('MLC1') });
    const match = await matchLinksToTargets('https://meli.la/D1 https://meli.la/D2', TARGETS, EXPECTED);
    expect(match.assigned.map((a) => [a.targetId, a.url])).toEqual([['a', 'https://meli.la/D1']]);
    expect(match.unmatched).toEqual(['https://meli.la/D2']);
  });

  it('el mismo link pegado dos veces se abre una sola vez', async () => {
    setLinks({ 'https://meli.la/R1': info('MLC1') });
    const match = await matchLinksToTargets('https://meli.la/R1\nhttps://meli.la/R1', TARGETS, EXPECTED);
    expect(match.linksFound).toBe(1);
    expect(inspectMock).toHaveBeenCalledTimes(1);
    expect(match.assigned.map((a) => a.targetId)).toEqual(['a']);
  });

  it('los ilegibles se asignan por posición solo si la cantidad calza', async () => {
    setLinks({});
    const exact = await matchLinksToTargets('https://meli.la/U1 https://meli.la/U2', TARGETS, EXPECTED);
    expect(exact.assigned.map((a) => [a.targetId, a.url, a.verified])).toEqual([
      ['a', 'https://meli.la/U1', false],
      ['b', 'https://meli.la/U2', false],
    ]);

    const short = await matchLinksToTargets('https://meli.la/U1', TARGETS, EXPECTED);
    expect(short.assigned).toEqual([]);
    expect(short.unmatched).toEqual(['https://meli.la/U1']);
  });

  it('un link que lleva a una ficha fuera de la tanda va a `wrong`', async () => {
    setLinks({ 'https://meli.la/W': info('MLC999') });
    const match = await matchLinksToTargets('https://meli.la/W', TARGETS, EXPECTED);
    expect(match.wrong).toEqual([{ url: 'https://meli.la/W', featuredProductId: 'MLC999' }]);
  });
});
