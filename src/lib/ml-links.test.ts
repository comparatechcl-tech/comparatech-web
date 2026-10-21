import { describe, expect, it } from 'vitest';
import { parseMlInput, shareAffiliateUrl } from '@/lib/ml-links';

/*
 * Lo que el dueño pega en "Agregar desde Mercado Libre": links copiados del
 * navegador o de la app, solos o dentro de un texto, y códigos sueltos.
 */

describe('parseMlInput', () => {
  it('reconoce la ficha de catálogo, con o sin parámetros ni título', () => {
    expect(
      parseMlInput(
        'https://www.mercadolibre.cl/parlante-jbl-charge-5/p/MLC45203390?pdp_filters=item_id:MLC1618906261#reco_item_pos=1'
      )
    ).toEqual([
      {
        kind: 'ficha',
        id: 'MLC45203390',
        raw: 'https://www.mercadolibre.cl/parlante-jbl-charge-5/p/MLC45203390?pdp_filters=item_id:MLC1618906261#reco_item_pos=1',
      },
    ]);
    expect(parseMlInput('https://mercadolibre.cl/p/mlc45203390')).toMatchObject([{ kind: 'ficha', id: 'MLC45203390' }]);
  });

  it('una publicación de un vendedor trae su título, para buscar la ficha parecida', () => {
    expect(
      parseMlInput('https://articulo.mercadolibre.cl/MLC-1618906261-parlante-jbl-charge-5-negro-_JM#position=3')
    ).toEqual([
      {
        kind: 'publicacion',
        id: 'MLC1618906261',
        words: 'parlante jbl charge 5 negro',
        raw: 'https://articulo.mercadolibre.cl/MLC-1618906261-parlante-jbl-charge-5-negro-_JM#position=3',
      },
    ]);
    expect(parseMlInput('https://www.mercadolibre.cl/audifonos-sony-wh-1000xm5/up/MLCU123456789')).toMatchObject([
      { kind: 'publicacion', id: 'MLCU123456789', words: 'audifonos sony wh 1000xm5' },
    ]);
    // Tildes y eñes codificadas en la dirección.
    expect(parseMlInput('https://articulo.mercadolibre.cl/MLC-111111-c%C3%A1mara-ni%C3%B1os-_JM')).toMatchObject([
      { words: 'cámara niños' },
    ]);
  });

  it('los links cortos se reconocen pero no se abren (cuentan como clic de afiliado)', () => {
    expect(parseMlInput('https://meli.la/2abcXYZ')).toEqual([{ kind: 'corto', raw: 'https://meli.la/2abcXYZ' }]);
    expect(parseMlInput('https://mercadolibre.com/sec/1a2B3c')).toMatchObject([{ kind: 'corto' }]);
  });

  it('lee los links metidos en un texto compartido y los códigos sueltos', () => {
    const text =
      '¡Mira este producto! Parlante JBL https://www.mercadolibre.cl/p/MLC45203390. ' +
      'Y este código: MLC12345678, y esta publicación MLC-1618906261';
    expect(parseMlInput(text)).toEqual([
      { kind: 'ficha', id: 'MLC45203390', raw: 'https://www.mercadolibre.cl/p/MLC45203390' },
      { kind: 'codigo', id: 'MLC12345678', raw: 'MLC12345678' },
      { kind: 'publicacion', id: 'MLC1618906261', words: '', raw: 'MLC-1618906261' },
    ]);
  });

  it('no repite un producto pegado dos veces', () => {
    expect(
      parseMlInput('https://www.mercadolibre.cl/p/MLC45203390 https://www.mercadolibre.cl/x/p/MLC45203390 MLC45203390')
    ).toHaveLength(1);
  });

  it('el link de "Compartir" de la app (/up/MLCU…, sin título) es una publicación', () => {
    expect(parseMlInput('https://www.mercadolibre.cl/up/MLCU3539944844?matt_tool=94515950&pdp_filters=item_id:MLC3302018534&ua=naCzlPxu2spR9k36kNTvMhlkNEvoZB-JbeXPwqRUtApsqts#origin=share&sid=share&wid=MLC3302018534&action=copy')).toEqual([
      { kind: 'publicacion', id: 'MLCU3539944844', words: '', raw: 'https://www.mercadolibre.cl/up/MLCU3539944844?matt_tool=94515950&pdp_filters=item_id:MLC3302018534&ua=naCzlPxu2spR9k36kNTvMhlkNEvoZB-JbeXPwqRUtApsqts#origin=share&sid=share&wid=MLC3302018534&action=copy' },
    ]);
  });

  it('lo que no es de Mercado Libre Chile queda como "otro"', () => {
    expect(parseMlInput('https://www.mercadolibre.com.ar/p/MLA123456')).toMatchObject([{ kind: 'otro' }]);
    expect(parseMlInput('https://www.mercadolibre.cl/ofertas')).toMatchObject([{ kind: 'otro' }]);
    expect(parseMlInput('https://mercadolibre.cl.estafa.com/p/MLC45203390')).toMatchObject([{ kind: 'otro' }]);
    expect(parseMlInput('hola, nada que ver')).toEqual([]);
  });
});

describe('shareAffiliateUrl', () => {
  const affiliate = { word: 'comparatech', tool: '15629069' };

  it('el link de una publicación con matt_word y matt_tool, sin el seguimiento de quien compartió', () => {
    expect(shareAffiliateUrl('https://www.mercadolibre.cl/up/MLCU3539944844?matt_tool=94515950&pdp_filters=item_id:MLC3302018534&ua=naCzlPxu2spR9k36kNTvMhlkNEvoZB-JbeXPwqRUtApsqts#origin=share&sid=share&wid=MLC3302018534&action=copy', affiliate)).toBe('https://www.mercadolibre.cl/up/MLCU3539944844?pdp_filters=item_id%3AMLC3302018534&matt_word=comparatech&matt_tool=15629069');
    // El matt_tool de otro se reemplaza: nunca quedan dos.
    const url = new URL(shareAffiliateUrl('https://www.mercadolibre.cl/up/MLCU3539944844?matt_tool=94515950&pdp_filters=item_id:MLC3302018534&ua=naCzlPxu2spR9k36kNTvMhlkNEvoZB-JbeXPwqRUtApsqts#origin=share&sid=share&wid=MLC3302018534&action=copy', affiliate)!);
    expect(url.searchParams.getAll('matt_tool')).toEqual(['15629069']);
    expect(url.hash).toBe('');
    expect(url.searchParams.has('ua')).toBe(false);
  });

  it('sirve igual para una publicación vieja y para una ficha', () => {
    expect(shareAffiliateUrl('https://articulo.mercadolibre.cl/MLC-1618906261-parlante-jbl-_JM?searchVariation=1#reco', affiliate)).toBe(
      'https://articulo.mercadolibre.cl/MLC-1618906261-parlante-jbl-_JM?matt_word=comparatech&matt_tool=15629069'
    );
    expect(shareAffiliateUrl('https://www.mercadolibre.cl/parlante/p/MLC45203390.', affiliate)).toBe(
      'https://www.mercadolibre.cl/parlante/p/MLC45203390?matt_word=comparatech&matt_tool=15629069'
    );
  });

  it('nada para links cortos, de otros países, que no son de un producto, o sin datos de afiliado', () => {
    expect(shareAffiliateUrl('https://meli.la/2abcXYZ', affiliate)).toBeNull();
    expect(shareAffiliateUrl('https://www.mercadolibre.com.ar/up/MLAU123456', affiliate)).toBeNull();
    expect(shareAffiliateUrl('https://mercadolibre.cl.estafa.com/up/MLCU3539944844', affiliate)).toBeNull();
    expect(shareAffiliateUrl('https://www.mercadolibre.cl/ofertas', affiliate)).toBeNull();
    expect(shareAffiliateUrl('MLC-1618906261', affiliate)).toBeNull();
    expect(shareAffiliateUrl('javascript:alert(1)//www.mercadolibre.cl/up/MLCU1', affiliate)).toBeNull();
    expect(shareAffiliateUrl('https://www.mercadolibre.cl/up/MLCU3539944844?matt_tool=94515950&pdp_filters=item_id:MLC3302018534&ua=naCzlPxu2spR9k36kNTvMhlkNEvoZB-JbeXPwqRUtApsqts#origin=share&sid=share&wid=MLC3302018534&action=copy', { word: null, tool: '15629069' })).toBeNull();
  });
});
