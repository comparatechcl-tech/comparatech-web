import { describe, expect, it } from 'vitest';
import { nameNeedsHelp, socialProductName } from './social-name';

/** Nombres, marcas, tipos y especificaciones del catálogo real (18-10-2026). */
describe('socialProductName', () => {
  it('un nombre que parte con un código dice tipo, marca y modelo', () => {
    const asus = {
      name: 'FA607NUQ-RL060W AMD Ryzen 7 170C 16GB 512GB 16" 4050 RTX 6GB',
      brand: 'Asus',
      ml_domain_id: 'MLC-NOTEBOOKS',
      specs: { Modelo: 'Gaming A16', 'Línea del procesador': 'Ryzen 7' },
    };
    expect(socialProductName(asus)).toBe('Notebook Asus Gaming A16 AMD Ryzen 7 170C 16GB 512GB');
    // En la historia la marca ya va arriba del nombre.
    expect(socialProductName(asus, { withBrand: false })).toBe('Notebook Gaming A16 AMD Ryzen 7 170C 16GB 512GB 16"');
  });

  it('un televisor que parte con las pulgadas empieza por "Smart TV" y la marca, sin repetirlas después', () => {
    expect(
      socialProductName({
        name: '43\'\' UHD U8000H Vision AI Smart TV (2026)',
        brand: 'Samsung',
        ml_domain_id: 'MLC-TELEVISIONS',
        specs: { Modelo: 'UN43U8000HGXPE' },
      }),
    ).toBe('Smart TV Samsung 43\'\' UHD U8000H Vision AI (2026)');
    expect(
      socialProductName({
        name: '55" Crystal UHD U8500H 4K Samsung Vision AI Smart TV (2026) + Control por Voz',
        brand: 'Samsung',
        ml_domain_id: 'MLC-TELEVISIONS',
      }),
    ).toBe('Smart TV Samsung 55" Crystal UHD U8500H 4K Vision AI');
  });

  it('el tipo que ya está más atrás en el nombre no se repite', () => {
    expect(
      socialProductName({
        name: '1d/2d/qr Omnidireccional Lector De Código De Barras Con Usb Negro',
        brand: 'Elixir',
        ml_domain_id: 'MLC-BAR_CODE_SCANNERS',
        specs: { Modelo: 'General' },
      }),
    ).toBe('Lector de código de barras Elixir 1d/2d/qr');
  });

  it('deja como están los nombres que ya se entienden', () => {
    const cases = [
      { name: 'Parlante JBL Go 4 Color Negro', brand: 'JBL', ml_domain_id: 'MLC-SPEAKERS', want: 'Parlante JBL Go 4' },
      { name: 'Tp-link Router Wifi Doble Banda Ac750 Archer C24', brand: 'TP-Link', ml_domain_id: 'MLC-ROUTERS_AND_WIRELESS_SYSTEMS', want: 'Tp-link Router Wifi Doble Banda Ac750 Archer C24' },
      { name: '2 Pack Radios Walkie Talkie BF-888S', brand: 'Baofeng', ml_domain_id: 'MLC-WALKIE_TALKIES', want: '2 Pack Radios Walkie Talkie BF-888S' },
      { name: 'E-reader Amazon Kindle 6 2024 16gb', brand: 'Kindle', ml_domain_id: 'MLC-E_READERS', want: 'E-reader Amazon Kindle 6 2024 16gb' },
      // "Ampolletas" también reúne tubos LED: mejor el nombre tal cual que un tipo equivocado.
      { name: 'X5 Tubos Led 120cm Canaleta', brand: 'EOLAND', ml_domain_id: 'MLC-LIGHT_BULBS', want: 'X5 Tubos Led 120cm Canaleta' },
    ];
    for (const { want, ...p } of cases) expect(socialProductName(p)).toBe(want);
  });

  it('saca la basura del comienzo', () => {
    expect(socialProductName({ name: '!!! Parlante Genius Mini Soundbar 100 Usb', brand: 'Genius', ml_domain_id: 'MLC-SPEAKERS' })).toBe(
      'Parlante Genius Mini Soundbar 100 Usb',
    );
    expect(socialProductName({ name: 'Y Alexa Echo Dot De Quinta Generación', brand: 'Amazon', ml_domain_id: 'MLC-SMART_SPEAKERS' })).toBe(
      'Alexa Echo Dot De Quinta Generación',
    );
  });

  it('una marca en mayúsculas se escribe normal, salvo las siglas cortas', () => {
    expect(socialProductName({ name: 'Ps4 Slim 1 TB', brand: 'SONY', ml_domain_id: 'MLC-GAME_CONSOLES' })).toBe('Consola Sony Ps4 Slim 1 TB');
    expect(socialProductName({ name: '32 Smart TV HD', brand: 'LG', ml_domain_id: 'MLC-TELEVISIONS' })).toBe('Smart TV LG 32 HD');
  });

  it('sin marca útil ni tipo conocido, el nombre corto de siempre', () => {
    expect(socialProductName({ name: '55" Pantalla Genérica', brand: 'Genérica', ml_domain_id: 'MLC-TELEVISIONS' })).toBe(
      'Smart TV 55" Pantalla Genérica',
    );
    expect(socialProductName({ name: 'ABC12345 Algo Raro', brand: null, ml_domain_id: null })).toBe('ABC12345 Algo Raro');
  });

  it('respeta el largo pedido', () => {
    const name = socialProductName(
      { name: 'FA607NUQ-RL060W AMD Ryzen 7 170C 16GB 512GB 16" 4050 RTX 6GB', brand: 'Asus', ml_domain_id: 'MLC-NOTEBOOKS', specs: { Modelo: 'Gaming A16' } },
      { max: 30 },
    );
    expect(name.length).toBeLessThanOrEqual(30);
    expect(name.startsWith('Notebook Asus Gaming A16')).toBe(true);
  });
});

describe('nameNeedsHelp', () => {
  it('avisa solo si el código queda adelante', () => {
    expect(nameNeedsHelp({ name: 'FA607NUQ-RL060W AMD Ryzen 7', brand: 'Asus', ml_domain_id: 'MLC-NOTEBOOKS' })).toBe(false);
    expect(nameNeedsHelp({ name: 'FA607NUQ-RL060W AMD Ryzen 7', brand: 'Asus', ml_domain_id: null })).toBe(true);
    expect(nameNeedsHelp({ name: 'Parlante JBL Go 4', brand: 'JBL', ml_domain_id: 'MLC-SPEAKERS' })).toBe(false);
  });
});
