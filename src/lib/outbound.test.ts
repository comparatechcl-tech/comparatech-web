import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buyUrl, isAllowedAffiliateUrl, isMeliLaUrl, resolveOutboundUrl } from '@/lib/outbound';
import { checkAffiliateOwnership, clearInspectCache, inspectAffiliateLink } from '@/lib/affiliate-link';

const PARAMS = { word: 'comparatech', tool: '12345678', directLinks: false };

describe('isAllowedAffiliateUrl', () => {
  it('acepta meli.la y fichas de Mercado Libre por https', () => {
    expect(isAllowedAffiliateUrl('https://meli.la/2AbCdEf')).toBe(true);
    expect(isAllowedAffiliateUrl('https://www.mercadolibre.cl/p/MLC123?matt_word=x')).toBe(true);
    expect(isAllowedAffiliateUrl('https://articulo.mercadolibre.cl/MLC-123-algo')).toBe(true);
    expect(isAllowedAffiliateUrl('https://mercadolibre.com/sec/1a2b3c')).toBe(true);
  });

  it('rechaza javascript:, http: y hosts parecidos', () => {
    expect(isAllowedAffiliateUrl('javascript:alert(1)')).toBe(false);
    expect(isAllowedAffiliateUrl('http://meli.la/x')).toBe(false);
    expect(isAllowedAffiliateUrl('https://mercadolibre.cl.evil.com/p/MLC1')).toBe(false);
    expect(isAllowedAffiliateUrl('https://evilmercadolibre.cl/p/MLC1')).toBe(false);
    expect(isAllowedAffiliateUrl('https://meli.la@evil.com/x')).toBe(false);
    expect(isAllowedAffiliateUrl('https://meli.la:8443/x')).toBe(false);
    expect(isAllowedAffiliateUrl('#')).toBe(false);
    expect(isAllowedAffiliateUrl('')).toBe(false);
  });
});

describe('isMeliLaUrl', () => {
  it('reconoce los links del generador y no los directos', () => {
    expect(isMeliLaUrl('https://meli.la/2AbCdEf')).toBe(true);
    expect(isMeliLaUrl('https://www.mercadolibre.com/sec/1a2b3c')).toBe(true);
    expect(isMeliLaUrl('https://www.mercadolibre.cl/p/MLC123?matt_word=x')).toBe(false);
    expect(isMeliLaUrl('http://meli.la/2AbCdEf')).toBe(false);
  });
});

describe('resolveOutboundUrl y buyUrl', () => {
  it('usa el meli.la guardado si es válido', () => {
    const product = { affiliate_url: 'https://meli.la/abc', ml_product_id: 'MLC1' };
    expect(resolveOutboundUrl(product, PARAMS)).toBe('https://meli.la/abc');
    expect(buyUrl(product)).toBe('https://meli.la/abc');
  });

  it('con links directos encendidos va a la ficha con los parámetros', () => {
    const product = { affiliate_url: 'https://meli.la/abc', ml_product_id: 'MLC1' };
    expect(resolveOutboundUrl(product, { ...PARAMS, directLinks: true })).toBe(
      'https://www.mercadolibre.cl/p/MLC1?matt_word=comparatech&matt_tool=12345678'
    );
  });

  it('un link guardado no permitido cae al link directo, a la ficha o a la portada', () => {
    const bad = 'javascript:alert(1)';
    expect(resolveOutboundUrl({ affiliate_url: bad, ml_product_id: 'MLC1' }, PARAMS)).toBe(
      'https://www.mercadolibre.cl/p/MLC1?matt_word=comparatech&matt_tool=12345678'
    );
    expect(
      resolveOutboundUrl({ affiliate_url: bad, ml_product_id: 'MLC1' }, { word: null, tool: null, directLinks: false })
    ).toBe('https://www.mercadolibre.cl/p/MLC1');
    expect(resolveOutboundUrl({ affiliate_url: bad, ml_product_id: null }, PARAMS)).toBe(
      'https://www.mercadolibre.cl'
    );
    expect(buyUrl({ affiliate_url: 'http://meli.la/x', ml_product_id: 'MLC9' })).toBe(
      'https://www.mercadolibre.cl/p/MLC9'
    );
    expect(buyUrl({ affiliate_url: bad, outbound_url: '#' })).toBe('https://www.mercadolibre.cl');
  });

  it('buyUrl prefiere el destino precalculado si es válido', () => {
    expect(
      buyUrl({ affiliate_url: 'https://meli.la/abc', outbound_url: 'https://www.mercadolibre.cl/p/MLC1?matt_word=a' })
    ).toBe('https://www.mercadolibre.cl/p/MLC1?matt_word=a');
  });
});

describe('checkAffiliateOwnership', () => {
  const expected = { word: 'comparatech', tool: '12345678' };

  it('acepta los links de la cuenta o sin parámetros', () => {
    expect(checkAffiliateOwnership({ mattWord: 'comparatech', mattTool: '12345678' }, expected)).toBeNull();
    expect(checkAffiliateOwnership({ mattWord: null, mattTool: null }, expected)).toBeNull();
    expect(checkAffiliateOwnership({ mattWord: 'otra', mattTool: '1' }, { word: null, tool: null })).toBeNull();
  });

  it('acepta otro matt_word si el matt_tool es el de la cuenta', () => {
    // Los meli.la propios resuelven a matt_word=seplvedaroxana aunque la
    // configuración diga comparatech: el word no identifica a la cuenta.
    expect(checkAffiliateOwnership({ mattWord: 'seplvedaroxana', mattTool: '12345678' }, expected)).toBeNull();
    expect(checkAffiliateOwnership({ mattWord: 'otra', mattTool: null }, expected)).toBeNull();
  });

  it('rechaza un matt_tool de otra cuenta', () => {
    expect(checkAffiliateOwnership({ mattWord: 'comparatech', mattTool: '999' }, expected)).toBe(
      'Este link es de otra cuenta de afiliado (matt_tool=999). Genéralo con la cuenta ComparaTech.'
    );
    expect(checkAffiliateOwnership({ mattWord: null, mattTool: '999' }, { word: null, tool: '12345678' })).toContain(
      'matt_tool=999'
    );
  });
});

describe('inspectAffiliateLink', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    clearInspectCache();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function redirect(location: string) {
    return new Response(null, { status: 302, headers: { location } });
  }
  const profileHtml =
    '{"metadata":{"id":"MLC555"}} {"id":"show_product","url":"https://www.mercadolibre.cl/p/MLC777"}';

  it('rechaza sin abrir un link que no es de Mercado Libre', async () => {
    expect(await inspectAffiliateLink('javascript:alert(1)')).toEqual({
      ok: false,
      error: 'Ese link no es de Mercado Libre',
    });
    expect(await inspectAffiliateLink('http://meli.la/x')).toEqual({
      ok: false,
      error: 'Ese link no es de Mercado Libre',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('aborta si una redirección sale de Mercado Libre', async () => {
    fetchMock.mockResolvedValueOnce(redirect('https://mercadolibre.cl.evil.com/social/x'));
    const res = await inspectAffiliateLink('https://meli.la/abc');
    expect(res).toEqual({ ok: false, error: 'El link redirige fuera de Mercado Libre' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('lee matt_word y la ficha, y no vuelve a abrir el mismo link antes de 10 minutos', async () => {
    fetchMock
      .mockResolvedValueOnce(
        redirect('https://www.mercadolibre.cl/social/comparatech?matt_word=comparatech&matt_tool=12345678')
      )
      .mockResolvedValueOnce(new Response(profileHtml, { status: 200 }));

    // "Verificar" y luego "Aprobar"/"Guardar" el mismo link.
    const first = await inspectAffiliateLink('https://meli.la/abc');
    const second = await inspectAffiliateLink(' https://meli.la/abc ');

    expect(first).toEqual({
      ok: true,
      info: { itemId: 'MLC555', featuredProductId: 'MLC777', mattWord: 'comparatech', mattTool: '12345678' },
    });
    expect(second).toEqual(first);
    // Una sola apertura del meli.la (más el salto de la redirección).
    expect(fetchMock.mock.calls.filter(([url]) => url === 'https://meli.la/abc')).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('pasados 10 minutos lo vuelve a abrir', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-10-04T12:00:00Z'));
      fetchMock.mockImplementation(async () => new Response(profileHtml, { status: 200 }));
      await inspectAffiliateLink('https://meli.la/xyz');
      vi.setSystemTime(new Date('2026-10-04T12:11:00Z'));
      await inspectAffiliateLink('https://meli.la/xyz');
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('no memoiza los errores de red', async () => {
    fetchMock
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValueOnce(new Response(profileHtml, { status: 200 }));
    expect((await inspectAffiliateLink('https://meli.la/err')).ok).toBe(false);
    expect((await inspectAffiliateLink('https://meli.la/err')).ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
