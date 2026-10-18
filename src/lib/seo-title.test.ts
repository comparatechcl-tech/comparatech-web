import { describe, expect, it } from 'vitest';
import { isModelToken, SEO_TITLE_MAX, seoProductTitle, splitColor } from './seo-title';

/**
 * El <title> de la ficha para Google. Los nombres y marcas son del catálogo
 * real (17 de octubre de 2026), tal como los carga Mercado Libre, con sus
 * mayúsculas y sus marcas mal cargadas.
 */
const title = (name: string, brand: string | null, is_active = true) => seoProductTitle({ name, brand, is_active });

describe('seoProductTitle', () => {
  it('deja el nombre entero si cabe, y la marca del sitio si también cabe', () => {
    expect(title('Samsung Galaxy A27 5G 128GB', 'Samsung')).toBe('Samsung Galaxy A27 5G 128GB: precio en Chile | ComparaTech');
    expect(title('Apple iPhone 17 (256 GB) - Negro - Distribuidor Autorizado', 'Apple')).toBe(
      'Apple iPhone 17 (256 GB) Negro: precio en Chile',
    );
  });

  it('fuera de venta lo dice en vez de prometer un precio', () => {
    expect(title('Samsung Galaxy A27 5G 128GB', 'Samsung', false)).toBe('Samsung Galaxy A27 5G 128GB: sin stock hoy | ComparaTech');
  });

  it('nunca pasa de lo que muestra Google', () => {
    const long = [
      'Parlante Bluetooth Soundcore Select 4 Go 5W, Inalámbrico Bluetooth 5.3, Diseño portátil y ligero, IP67 Waterproof, Hasta 20 Horas de Reproducción, Interior y Exterior Azul',
      'Soporte Para Pantalla Tv Television Pantallas Soporte Tv Pared 40 50 55 65 75 Pulgadas Emetres Soporte Tv 55 Pulgadas Soporte Tv Giratorio 180 Grados Para Televisores Soportes Base Tv Color Negro',
      'Supercalifragilisticoespialidosoextraordinariamentelargo Inalámbrico Recargable',
    ];
    for (const name of long) {
      expect(title(name, 'Anker').length).toBeLessThanOrEqual(SEO_TITLE_MAX);
      expect(title(name, null, false).length).toBeLessThanOrEqual(SEO_TITLE_MAX);
    }
  });

  it('no pierde el modelo ni la capacidad que el corte desde "color" se llevaba', () => {
    // El título viejo era "Memoria RAM ValueRAM: precio y ofertas en Chile".
    expect(title('Memoria RAM ValueRAM color verde 8GB 1x8GB Kingston KVR16LS11/8', 'Kingston')).toBe(
      'Memoria RAM 8GB Kingston KVR16LS11/8 verde: precio en Chile',
    );
  });

  it('rescata la marca y el código cuando el corte los deja afuera: dos modelos, dos títulos', () => {
    const a = title('Home Theaters Soundbar Subwoofer Bluetooth Aiwa Aw-sbh16 Color Negro', 'Aiwa');
    const b = title('Home Theaters Soundbar Subwoofer Bluetooth Aiwa Aw-sbh21 Color Negro', 'Aiwa');
    // El color vuelve al final porque cabe.
    expect(a).toBe('Home Theaters Soundbar Aiwa Aw-sbh16 Negro: precio en Chile');
    expect(b).toBe('Home Theaters Soundbar Aiwa Aw-sbh21 Negro: precio en Chile');
    // Un número de modelo sin letras también es el modelo.
    expect(title('Teléfono Celular Senior Adulto Mayor Mlab 9204 4G LTE con Tapita y Botón SOS, Pantalla 2.8"', 'Mlab')).toContain(
      'Mlab 9204',
    );
    // La capacidad de una batería, aunque venga separada de su unidad.
    expect(title('Batería Externa Cargador Base Portátil Pocket 5000 Mah Tipo USB C Negro Master-g', 'MasterG')).toBe(
      'Batería Externa Cargador 5000 Mah Master-g: precio en Chile',
    );
  });

  it('saca un adjetivo de antes de la marca para que quepa el modelo entero', () => {
    // "Band 9 Active" y "Band 9" son productos distintos.
    expect(title('Pulsera Inteligente Xiaomi Mi Smart Band 9 Active Verde Verde Lima', 'Xiaomi')).toContain('Band 9 Active');
    expect(title('Audífonos Inalámbricos Xiaomi Redmi Buds 6 Play Bt 5.4 Color Sky Blue', 'Xiaomi')).toContain('Buds 6 Play');
  });

  it('saca el código de fábrica si sin él cabe el nombre del modelo', () => {
    expect(title('Samsung Asm-r390nidalta Smartwatch Galaxy Fit 3 Color Rosa 1,6in', 'Samsung')).toBe(
      'Samsung Smartwatch Galaxy Fit 3 1,6in Rosa: precio en Chile',
    );
  });

  it('no separa una cifra de lo que cuenta ni deja un conector colgando', () => {
    // No "… A Gas 5" (de "5 quemadores"); el tamaño se rescata porque no hay capacidad.
    expect(title('Cocina Encimera A Gas 5 quemadores 86cm Negro', 'Ideehouse')).toBe(
      'Ideehouse Cocina Encimera A Gas 86cm: precio en Chile',
    );
    // No "… 1080p Con 2" (de "Con 2 Micrófono").
    expect(title('Emeet C960 FullHD Webcam 1080p Con 2 Micrófono USB Camera Para Video Conferencia Pc Streaming Negro', 'Emeet')).toBe(
      'Emeet C960 FullHD Webcam 1080p: precio en Chile',
    );
    // "8 En 1" y "32 A 55" van juntos.
    expect(title('Hub Adaptador Usb Tipo C 8 En 1 Para Mac Macbook Windows', 'Genérica')).toBe(
      'Hub Adaptador Usb Tipo C 8 En 1 Para Mac: precio en Chile',
    );
    expect(title('Base Trípode Pedestal Tv 32 A 55 Pulgadas Giratorio 360° Color Negro', 'Genérica')).toBe(
      'Base Trípode Pedestal Tv 32 A 55 Pulgadas: precio en Chile',
    );
  });

  it('no deja un paréntesis abierto', () => {
    expect(title('Cámara web negra Lenovo Hd 1080p (300 Fhd) con gran ángulo de', 'Lenovo')).toBe(
      'Cámara web negra Lenovo Hd 1080p (300 Fhd): precio en Chile',
    );
  });

  it('pone la marca adelante si el nombre no la trae', () => {
    expect(title('Galaxy Tab S10 Lite 128gb Gris + Bookcover', 'Samsung')).toBe('Samsung Galaxy Tab S10 Lite 128gb Gris: precio en Chile');
    // Escrita de otra forma, la marca ya está: "Tplink" es "TP-Link".
    expect(title('Adaptador Usb Inalambrico Wifi Tplink Archer T3u Nano Ac1300', 'TP-Link')).not.toMatch(/^TP-Link/);
  });

  it('no pone adelante marcas que no lo son', () => {
    // "Genérica", un pedazo del nombre cargado como marca y el modelo cargado como marca.
    expect(title('Hub Adaptador Usb Tipo C 8 En 1 Para Mac Macbook Windows', 'Genérica')).not.toContain('Genérica');
    expect(title('Calentador de Agua Instantáneo Eléctrico de 3 kW para Ducha', 'Calentador De Agua Instantáneo Sin')).toBe(
      'Calentador de Agua Instantáneo Eléctrico: precio en Chile',
    );
    expect(title('Switch 5 Puertos Rj45 10/100/1000 Mbps Gigabit', 'Switch 5 Puertos Rj45 10/100 Mbps')).toBe(
      'Switch 5 Puertos Rj45 10/100/1000 Mbps: precio en Chile',
    );
    expect(title('Audífonos Inalámbricos Redragon Zeus Pro Gamer 7.1 Sonido Envolvente', 'ZEUS X WIRELESS')).toBe(
      'Audífonos Inalámbricos Redragon Zeus Pro: precio en Chile',
    );
  });
});

describe('splitColor', () => {
  it('saca la palabra "color" con su color', () => {
    expect(splitColor('Parlante Xiaomi Sound Outdoor Inalámbrico 30W Color Negro')).toEqual({
      core: ['Parlante', 'Xiaomi', 'Sound', 'Outdoor', 'Inalámbrico', '30W'],
      color: 'Negro',
    });
    expect(splitColor('Audífonos Inalámbricos Xiaomi Redmi Buds 6 Play Bt 5.4 Color Sky Blue').color).toBe('Sky Blue');
  });

  it('deja "color" cuando no viene un color de verdad', () => {
    const name = 'Impresora Multifuncional HP Smart Tank 720 Tinta Continua Color Wi-Fi Smart App Dúplex';
    expect(splitColor(name)).toEqual({ core: name.split(' '), color: null });
  });
});

describe('isModelToken', () => {
  it('reconoce códigos y números de modelo', () => {
    for (const word of ['A27', 'Aw-sbh16', 'KVR16LS11/8', 'C960', 'Vg279q5a,', 'POS-9200L']) expect(isModelToken(word)).toBe(true);
    expect(isModelToken('9204', '4G', 'LTE')).toBe(true);
  });

  it('no confunde medidas, normas, años ni cantidades con un modelo', () => {
    for (const word of ['1300W', '4G', '128GB', '2.4GHZ', '1080p', 'IP67', 'IPX7', 'RJ45', '120LUM', '43"', '360°']) {
      expect(isModelToken(word)).toBe(false);
    }
    expect(isModelToken('2024')).toBe(false);
    expect(isModelToken('300', 'Mbps')).toBe(false);
  });
});
