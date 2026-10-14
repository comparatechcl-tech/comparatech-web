import { describe, expect, it } from 'vitest';
import { isFactoryCode, reelProductName, shortProductName } from './text';

/**
 * El nombre corto de siempre (ficha, <title>, redes, Telegram, historias,
 * portada) y el del reel, que además quita los códigos de fábrica. Los
 * nombres son del catálogo real (instantánea del 13 de octubre de 2026),
 * salvo los marcados "a mano".
 */

describe('shortProductName no quita códigos de fábrica', () => {
  // Lo que daba antes de que existiera reelProductName (commit 6a3571a),
  // escrito a mano: en el <title> y la meta de la ficha el código es lo que
  // se busca, y en un televisor o una memoria es el modelo.
  const cases: [string, number | undefined, string][] = [
    ['Samsung Un55u8000h Smart Tv 100-240 V 55in Procesador Crystal 4k uhd', undefined, 'Samsung Un55u8000h Smart Tv 100-240 V 55in Procesador'],
    ['Smart TV LG NANO 50" 4K UHD AI 50NU800BPSB 2026', undefined, 'Smart TV LG NANO 50" 4K UHD AI 50NU800BPSB 2026'],
    ['Smart Tv LG Nano 43" 4k Uhd Ai 43nu800bpsb 2026', undefined, 'Smart Tv LG Nano 43" 4k Uhd Ai 43nu800bpsb 2026'],
    ['Monitor Gaming Ultragear G4 24 Pulgadas 24g411a-b.awh LG Negro', undefined, 'Monitor Gaming Ultragear G4 24 Pulgadas 24g411a-b.awh'],
    // A mano.
    ['Smart TV Samsung 55" QN55Q60DAGXZS QLED 4K', undefined, 'Smart TV Samsung 55" QN55Q60DAGXZS QLED 4K'],
    ['FA607NUQ-RL060W AMD Ryzen 7 170C 16GB 512GB 16" 4050 RTX 6GB', undefined, 'FA607NUQ-RL060W AMD Ryzen 7 170C 16GB 512GB 16" 4050'],
    ['Kingston ValueRAM KVR32S22S8/8 Memoria RAM color verde 8GB 3200MHz', undefined, 'Kingston ValueRAM KVR32S22S8/8 Memoria RAM'],
    ['Kingston ValueRAM KVR32S22S8/8 Memoria RAM color verde 8GB 3200MHz', 200, 'Kingston ValueRAM KVR32S22S8/8 Memoria RAM'],
    // A mano.
    ['Cargador Para Notebook Lenovo Adlx65ndc3a 20v 3.25a', undefined, 'Cargador Para Notebook Lenovo Adlx65ndc3a 20v 3.25a'],
    ['Lavadora Carga Superior 10kg WT3K1023UT Gris', undefined, 'Lavadora Carga Superior 10kg WT3K1023UT Gris'],
    ['Lavadora Carga Superior 10kg Wt3k1031ut Gris Oscuro', undefined, 'Lavadora Carga Superior 10kg Wt3k1031ut Gris Oscuro'],
    ['Samsung Asm-r390nidalta Smartwatch Galaxy Fit 3', undefined, 'Samsung Asm-r390nidalta Smartwatch Galaxy Fit 3'],
    ['Notebook Hp Pavilion X360 14-ek0009la Intel Core i5 8GB 512GB SSD 14" Windows 11 Home', undefined, 'Notebook Hp Pavilion X360 14-ek0009la Intel Core i5 8GB'],
    ['Notebook Hp Pavilion X360 14-ek0009la Intel Core i5 8GB 512GB SSD 14" Windows 11 Home', 45, 'Notebook Hp Pavilion X360 14-ek0009la Intel'],
    ['Notebook Hp Pavilion X360 14-ek0009la Intel Core i5 8GB 512GB SSD 14" Windows 11 Home', 64, 'Notebook Hp Pavilion X360 14-ek0009la Intel Core i5 8GB 512GB'],
    ['Epson L3350 C11CL62306 - Negro', undefined, 'Epson L3350 C11CL62306 - Negro'],
    ['Horno Xl Rotisserie Oster, 60 L, Manual, Gris, Tssttv60mns', 200, 'Horno Xl Rotisserie Oster, 60 L, Manual, Gris, Tssttv60mns'],
    ['Microondas Oster Boobgm2502gm Eléctrica - 25l digital Gris Oscuro', undefined, 'Microondas Oster Boobgm2502gm Eléctrica - 25l digital'],
    // Lo de siempre: sin el color ni la coletilla de la tienda, cortado en una palabra entera.
    ['Audífonos Bluetooth JBL Tune 520BT - Color Negro', undefined, 'Audífonos Bluetooth JBL Tune 520BT'],
    [
      'Apple Watch SE 3 GPS • Caja de aluminio color medianoche de 40 mm • Correa deportiva color medianoche - S/M - Distribuidor Autorizado',
      undefined,
      'Apple Watch SE 3 GPS • Caja de aluminio',
    ],
    ['Cable Apple De Usb - C A Conector Lightning (1 M) Color Blanco - Distribuidor Autorizado', undefined, 'Cable Apple De Usb - C A Conector Lightning (1 M)'],
    ['Apple iPhone 17 Pro Max (256 GB) - Naranja cósmico - Distribuidor Autorizado', undefined, 'Apple iPhone 17 Pro Max (256 GB) - Naranja cósmico'],
    ['Audífonos Inalámbricos Sleve Pulse ANC Over-Ear con Cancelación de Ruido Activa y 45h de Batería', undefined, 'Audífonos Inalámbricos Sleve Pulse ANC Over-Ear'],
    ['Color Negro', undefined, 'Color Negro'],
    ['  Mouse   Logitech  M196 Bluetooth Blanco  ', undefined, 'Mouse Logitech M196 Bluetooth Blanco'],
    [`Palabra${'larguísima'.repeat(8)}`, undefined, 'Palabralarguísimalarguísimalarguísimalarguísimalarguísi'],
  ];

  it('da lo mismo que antes, con el código donde estaba', () => {
    for (const [name, max, short] of cases) expect(max === undefined ? shortProductName(name) : shortProductName(name, max)).toBe(short);
  });
});

describe('reelProductName: el nombre que va escrito en el reel', () => {
  it('quita el código de artículo del reloj del reel de hoy', () => {
    expect(reelProductName('Samsung Asm-r390nidalta Smartwatch Galaxy Fit 3')).toBe('Samsung Smartwatch Galaxy Fit 3');
    expect(reelProductName('Samsung Sm-r390nzaalta Smartwatch Galaxy Fit 3 16mb')).toBe('Samsung Smartwatch Galaxy Fit 3 16mb');
  });

  it('en un televisor o un monitor también: en el reel la marca va aparte y las pulgadas siguen', () => {
    // El modelo se queda en la ficha y en las redes (shortProductName, arriba).
    expect(reelProductName('Samsung Un55u8000h Smart Tv 100-240 V 55in Procesador Crystal 4k uhd')).toBe(
      'Samsung Smart Tv 100-240 V 55in Procesador Crystal 4k'
    );
    expect(reelProductName('Smart TV LG NANO 50" 4K UHD AI 50NU800BPSB 2026')).toBe('Smart TV LG NANO 50" 4K UHD AI 2026');
    expect(reelProductName('Monitor Gaming Ultragear G4 24 Pulgadas 24g411a-b.awh LG Negro')).toBe(
      'Monitor Gaming Ultragear G4 24 Pulgadas LG Negro'
    );
    expect(reelProductName('Smart TV Samsung 55" QN55Q60DAGXZS QLED 4K')).toBe('Smart TV Samsung 55" QLED 4K');
  });

  it('las lavadoras Hisense quedan sin el código: la marca la escribe el reel aparte', () => {
    expect(reelProductName('Lavadora Carga Superior 10kg WT3K1023UT Gris')).toBe('Lavadora Carga Superior 10kg Gris');
    expect(reelProductName('Lavadora Carga Superior 10kg Wt3k1031ut Gris Oscuro')).toBe('Lavadora Carga Superior 10kg Gris Oscuro');
  });

  it('el código ya no le quita espacio al resto del nombre', () => {
    const name = 'Notebook Hp Pavilion X360 14-ek0009la Intel Core i5 8GB 512GB SSD 14" Windows 11 Home';
    expect(reelProductName(name)).toBe('Notebook Hp Pavilion X360 Intel Core i5 8GB 512GB SSD');
    expect(reelProductName(name, 45)).toBe('Notebook Hp Pavilion X360 Intel Core i5 8GB');
    expect(reelProductName(name, 64)).toBe('Notebook Hp Pavilion X360 Intel Core i5 8GB 512GB SSD 14"');
    expect(reelProductName('Teléfono de escritorio Pashaphone KT-T2019CID con identificación de llamadas negro')).toBe(
      'Teléfono de escritorio Pashaphone con identificación'
    );
  });

  it('no deja un guion ni una coma sueltos', () => {
    expect(reelProductName('Epson L3350 C11CL62306 - Negro')).toBe('Epson L3350 - Negro');
    expect(reelProductName('Horno Xl Rotisserie Oster, 60 L, Manual, Gris, Tssttv60mns', 200)).toBe('Horno Xl Rotisserie Oster, 60 L, Manual, Gris');
    expect(reelProductName('Samsung Asm-r390nidalta, Galaxy Fit 3')).toBe('Samsung Galaxy Fit 3');
    expect(reelProductName('Smart TV - QN55Q60DAGXZS - Samsung 55"')).toBe('Smart TV - Samsung 55"');
  });

  it('nunca quita la primera palabra: el notebook que empieza con su código lo conserva', () => {
    expect(reelProductName('FA607NUQ-RL060W AMD Ryzen 7 170C 16GB 512GB 16" 4050 RTX 6GB')).toBe(
      'FA607NUQ-RL060W AMD Ryzen 7 170C 16GB 512GB 16" 4050'
    );
  });

  it('un código después de "con", "para", "compatible" o "modelo" se queda: dice con qué calza', () => {
    // A mano.
    const kept = [
      'Base de carga con Sm-r390nzaalta Rosa',
      'Soporte de pared para Un55u8000h Negro',
      'Control remoto compatible Un55u8000h Samsung',
      'Smart TV Samsung 55 pulgadas modelo Un55u8000h',
      'Smart TV Samsung 55 pulgadas Modelo: Un55u8000h',
    ];
    for (const name of kept) {
      expect(name.split(' ').some(isFactoryCode)).toBe(true);
      expect(reelProductName(name)).toBe(name);
    }
  });

  it('en un repuesto o un consumible no quita ningún código', () => {
    const kept: [string, string][] = [
      // La memoria Kingston y el cargador Lenovo (a mano) del verificador.
      ['Kingston ValueRAM KVR32S22S8/8 Memoria RAM color verde 8GB 3200MHz', 'Kingston ValueRAM KVR32S22S8/8 Memoria RAM'],
      ['Cargador Para Notebook Lenovo Adlx65ndc3a 20v 3.25a', 'Cargador Para Notebook Lenovo Adlx65ndc3a 20v 3.25a'],
      ['Memoria RAM Fury Impact DDR4 gamer color negro 8GB 1 Kingston KF432S20IB/8', 'Memoria RAM Fury Impact DDR4 gamer'],
      ['Tarjeta de memoria SanDisk SDSQUNR-064G-GN3MA Ultra con adaptador SD 64GB', 'Tarjeta de memoria SanDisk SDSQUNR-064G-GN3MA Ultra'],
      // A mano.
      ['Batería Notebook Lenovo L19c3pf1abc 11.25v 45wh', 'Batería Notebook Lenovo L19c3pf1abc 11.25v 45wh'],
      ['Cartucho Tinta Hp 664xl F6v31al1ab0 Negro', 'Cartucho Tinta Hp 664xl F6v31al1ab0 Negro'],
      ['Tóner Brother Tn1060ab12 Negro Original', 'Tóner Brother Tn1060ab12 Negro Original'],
      ['Filtro Hepa Aspiradora Samsung Dj97-02474a12', 'Filtro Hepa Aspiradora Samsung Dj97-02474a12'],
      ['Funda Samsung Galaxy Ef-ps721cbegww Negra', 'Funda Samsung Galaxy Ef-ps721cbegww Negra'],
      ['Repuesto Cepillo Oral-B Eb20ab-4ffs Original', 'Repuesto Cepillo Oral-B Eb20ab-4ffs Original'],
    ];
    for (const [name, reel] of kept) {
      // Que de verdad traiga un código que, sin el resguardo, se iría.
      expect(name.split(' ').some(isFactoryCode)).toBe(true);
      expect(reelProductName(name)).toBe(reel);
      expect(reelProductName(name)).toBe(shortProductName(name));
    }
  });

  it('una batería portátil o un cargador portátil (un power bank) no es un repuesto', () => {
    expect(reelProductName('Samsung Eb-p4520xuegww Bateria Portatil 20000 Mah 45 W')).toBe('Samsung Bateria Portatil 20000 Mah 45 W');
    // A mano.
    expect(reelProductName('Xiaomi Bhr5884glabc12 Batería Externa 10000 mAh')).toBe('Xiaomi Batería Externa 10000 mAh');
    // Pero si además trae un cable, el código se queda.
    expect(reelProductName('Xiaomi Bhr5884glabc12 Batería Externa con Cable')).toBe('Xiaomi Bhr5884glabc12 Batería Externa con Cable');
  });

  it('un cargador o una batería portátil para notebook sí es un repuesto: conserva su número de parte', () => {
    // A mano: el código dice con qué equipo calza.
    for (const name of [
      'Cargador Portatil Para Notebook Lenovo Adlx65ndc3a 20v 3.25a',
      'Batería Externa Para Notebook Dell Wdx0rabc12 11.4v',
      'Cargador Portátil Notebook Hp Tpn-ca14abc1 65w Original',
      'Batería Portátil Laptop Asus B31n1abc12x 4400 mAh',
    ]) {
      expect(reelProductName(name)).toBe(shortProductName(name));
    }
  });

  it('si sin el código quedan menos de 3 palabras, o ninguna de solo letras, deja el nombre como estaba', () => {
    // A mano.
    expect(reelProductName('Asm-r390nidalta')).toBe('Asm-r390nidalta');
    expect(reelProductName('Asm-r390nidalta Color Negro')).toBe('Asm-r390nidalta');
    expect(reelProductName('Samsung Asm-r390nidalta')).toBe('Samsung Asm-r390nidalta');
    expect(reelProductName('Samsung Asm-r390nidalta Smartwatch')).toBe('Samsung Asm-r390nidalta Smartwatch');
    expect(reelProductName('Samsung Asm-r390nidalta - Fit')).toBe('Samsung Asm-r390nidalta - Fit');
    // Tres palabras, pero ninguna de solo letras y de 3 o más.
    expect(reelProductName('LG 50NU800BPSB 4K 50" 2026')).toBe('LG 50NU800BPSB 4K 50" 2026');
    // Con tres y una palabra de verdad, sí.
    expect(reelProductName('Samsung Asm-r390nidalta Galaxy 3')).toBe('Samsung Galaxy 3');
  });

  it('no deja un paréntesis suelto', () => {
    // A mano.
    expect(reelProductName('Smart TV Samsung (UN55U8000H 2026) Crystal 4K')).toBe('Smart TV Samsung (UN55U8000H 2026) Crystal 4K');
    expect(reelProductName('Smart TV Samsung (UN55U8000H) Crystal 4K')).toBe('Smart TV Samsung Crystal 4K');
  });

  it('sin código da lo mismo que shortProductName', () => {
    const names = [
      'Audífonos Bluetooth JBL Tune 520BT - Color Negro',
      'Apple iPhone 17 Pro Max (256 GB) - Naranja cósmico - Distribuidor Autorizado',
      'Smart TV TCL 43" S45AR Full HD',
      'Notebook Lenovo Ideapad 14IRH10 i5-13420H 8Gb 512Gb',
      'Audífonos Sony WH-1000XM5 Negro',
      'Smart TV LG OLED55C3PSA 55 4K',
      'Color Negro',
      `Palabra${'larguísima'.repeat(8)}`,
    ];
    for (const name of names) {
      for (const max of [30, 45, 55, 64, 200]) expect(reelProductName(name, max)).toBe(shortProductName(name, max));
    }
  });
});

describe('isFactoryCode', () => {
  it('reconoce los códigos de artículo y deja los modelos que la gente recuerda', () => {
    for (const code of ['Asm-r390nidalta', 'RS3P558NECF-', 'KF432S20IB/8', 'Mf200d115wb/t', 'Un55u8000h', 'HDTB520XK3AA', '(Wa90cg4240byzs),']) {
      expect(isFactoryCode(code)).toBe(true);
    }
    const models = [
      'S45AR',
      'WH-1000XM5',
      'i5-13420H',
      'VG249Q5A',
      'TL-WR840N',
      'Srs-xb100',
      'Wh-ch720n',
      'C32V1HR',
      'OLED55C3PSA',
      'Core-i7-13700H',
      '14IRH10',
      'AX210NGW',
      '128GB',
      '8GB',
      '4K',
      'Wi-Fi',
      'Recargables(4aa',
      '1440×900',
      'Galaxy',
      '20000mAh,',
      '',
    ];
    for (const word of models) expect(isFactoryCode(word)).toBe(false);
  });

  it('no confunde medidas, listas de modelos ni nombres pegados a un número', () => {
    const words = [
      '100x60x74cm',
      '80x40x30cm',
      '1860x2480p',
      '520/450mbps',
      '12GB+256GB',
      'Gt2/gt2e/gt2pro/gt3pro/gt4/gt5',
      'Centrophorus2',
      'M601-RGB',
      'Powerbass30',
      'Buenas3D-Silk,',
      'Eap225-outdoor',
      'Ut-classy720',
      '5g+kb+fol+pen',
      'Ds-ups2000-r',
    ];
    for (const word of words) expect(isFactoryCode(word)).toBe(false);
  });
});
