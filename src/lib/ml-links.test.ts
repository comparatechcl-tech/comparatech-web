import { describe, expect, it } from 'vitest';
import { parseMlInput } from '@/lib/ml-links';

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

  it('lo que no es de Mercado Libre Chile queda como "otro"', () => {
    expect(parseMlInput('https://www.mercadolibre.com.ar/p/MLA123456')).toMatchObject([{ kind: 'otro' }]);
    expect(parseMlInput('https://www.mercadolibre.cl/ofertas')).toMatchObject([{ kind: 'otro' }]);
    expect(parseMlInput('https://mercadolibre.cl.estafa.com/p/MLC45203390')).toMatchObject([{ kind: 'otro' }]);
    expect(parseMlInput('hola, nada que ver')).toEqual([]);
  });
});
