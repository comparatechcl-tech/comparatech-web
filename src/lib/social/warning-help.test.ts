import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

/**
 * Los avisos "Ojo" explicados (lib/social/warning-help) y la lista plegada
 * "¿Qué significa cada aviso?" (app/admin/WarningGuide). Cada aviso se arma
 * acá con interestScore, el mismo que los escribe en las tarjetas: si
 * interest.ts cambia una frase o suma un aviso, este archivo lo nota.
 */

import { WarningGuide } from '@/app/admin/WarningGuide';
import { HISTORY_UNREAD_WARNING, interestScore, type InterestEvidence, type InterestProduct } from '@/lib/social/interest';
import { HISTORY_UNREAD_EXAMPLE, WARNING_GLOSSARY, explainWarning, type WarningHelp } from '@/lib/social/warning-help';

let seq = 0;
/** Los mismos audífonos de interest.test.ts: JBL de tienda oficial a $70.000 con 30% de lista, sin avisos. */
function product(over: Partial<InterestProduct> = {}): InterestProduct {
  seq++;
  return {
    id: `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`,
    name: 'Audífonos Bluetooth JBL Tune 520BT Negro',
    brand: 'JBL',
    category: 'audio',
    price: 70_000,
    original_price: 100_000,
    seller_sales_count: 50_000,
    ml_root_category: 'MLC1000',
    ml_category_id: 'MLC3697',
    ml_family_id: null,
    offer_info: { free_shipping: true, is_full: false, official_store: true, sold_by_ml: false, is_lowest: true, warranty: null },
    ...over,
  };
}

const evidence = (over: Partial<InterestEvidence> = {}): InterestEvidence => ({ drop: null, min30: null, daysTracked: 6, ...over });
const INFO = product().offer_info;

/** Cada aviso que interestScore sabe armar, con un producto que lo trae solo a él. */
const CASES: [string, InterestProduct, InterestEvidence][] = [
  ['ya estuvo más barato', product({ price: 104_000, original_price: null }), evidence({ min30: 100_000, drop: { pct: 30, amount: 100_000 } })],
  ['otro vendedor más barato', product({ offer_info: { ...INFO, is_lowest: false } }), evidence()],
  [
    'vendedor con pocas ventas',
    product({ seller_sales_count: 42, offer_info: { free_shipping: true, is_lowest: true, official_store: false, sold_by_ml: false } }),
    evidence({ drop: { pct: 30, amount: 100_000 } }),
  ],
  ['historial sin leer', product(), { drop: null, min30: null, daysTracked: 0, historyUnread: true }],
  ['cambió desde un precio no anotado', product(), evidence({ changedFromUnknown: true })],
  ['precio que se mueve', product(), evidence({ recentChanges: 5 })],
  ['precio que va y vuelve', product(), evidence({ recentChanges: 1, seesaw: true })],
  ['muchos vendedores', product({ offer_info: { ...INFO, offers_count: 11 } }), evidence()],
  ['no es nuevo', product({ name: 'Audífonos Sony WH-1000XM4 Refurbished', brand: 'Sony', price: 300_000, original_price: 430_000 }), evidence()],
  ['sin oferta', product({ original_price: null }), evidence()],
  [
    'descuento sin respaldo',
    product({ price: 60_000, original_price: 100_000, brand: 'Sleve', offer_info: { free_shipping: true, is_lowest: true } }),
    evidence(),
  ],
  [
    'oferta chica',
    product({
      name: 'Auriculares Xiaomi Redmi Buds 8 Active Bluetooth Color Negro',
      brand: 'Xiaomi',
      price: 18_990,
      original_price: 21_490,
      offer_info: { free_shipping: true, is_full: true, official_store: true, sold_by_ml: true, is_lowest: true },
    }),
    evidence({ drop: { pct: 5, amount: 1_000 }, min30: 18_490 }),
  ],
  ['nombre con código', product({ name: 'FA607NUQ-RL060W AMD Ryzen 7 170C 16GB 512GB 16" 4050 RTX', brand: 'Asus' }), evidence()],
];

/** Lo que se responde a un aviso que no se conoce. */
const UNKNOWN_TO_DO = 'Toca "Ver en Mercado Libre" y revisa la oferta antes de subirla.';

/** ¿La explicación es de verdad una explicación, o el aviso tal cual porque no se reconoció? */
function recognized(help: WarningHelp, text: string): boolean {
  return help.meaning !== text && help.whatToDo !== UNKNOWN_TO_DO;
}

/** El aviso como aparece en la lista completa: con N o $X donde va la cifra. */
const templated = (warning: string) => warning.replace(/\$[\d.]+/g, '$X').replace(/\d+/g, 'N');

describe('explainWarning reconoce cada aviso que arma interest.ts', () => {
  const built = CASES.map(([name, p, ev]) => ({ name, warning: interestScore(p, ev).warning }));

  it('cada caso arma un aviso solo, y cada uno se explica (ninguno queda como desconocido)', () => {
    for (const { name, warning } of built) {
      expect(warning, name).toEqual(expect.any(String));
      expect(warning, name).not.toContain(';');
      const help = explainWarning(warning as string);
      expect(help, name).toHaveLength(1);
      expect(recognized(help[0], warning as string), `${name}: "${warning}"`).toBe(true);
      expect(help[0].meaning.length, name).toBeGreaterThan(20);
    }
  });

  it('son exactamente los de la lista completa: ninguno de más, ninguno de menos', () => {
    const examples = WARNING_GLOSSARY.map((entry) => entry.example);
    expect(built.map(({ warning }) => templated(warning as string)).sort()).toEqual([...examples].sort());
    expect(new Set(examples).size).toBe(examples.length);
  });

  it('el aviso del historial es el mismo texto en los dos archivos', () => {
    expect(HISTORY_UNREAD_EXAMPLE).toBe(HISTORY_UNREAD_WARNING);
  });

  it('cada aviso cae en su grupo', () => {
    const kinds = Object.fromEntries(built.map(({ name, warning }) => [name, explainWarning(warning as string)[0].kind]));
    expect(kinds).toEqual({
      'ya estuvo más barato': 'precio',
      'otro vendedor más barato': 'precio',
      'vendedor con pocas ventas': 'vendedor',
      'historial sin leer': 'precio',
      'cambió desde un precio no anotado': 'precio',
      'precio que se mueve': 'precio',
      'precio que va y vuelve': 'precio',
      'muchos vendedores': 'precio',
      'no es nuevo': 'otro',
      'sin oferta': 'oferta',
      'descuento sin respaldo': 'oferta',
      'oferta chica': 'oferta',
      'nombre con código': 'otro',
    });
  });

  it('la cifra del aviso llega a la explicación', () => {
    expect(explainWarning('hace poco estuvo a $285.000')[0].meaning).toBe('En los últimos 30 días el sitio lo vio a $285.000, más bajo que hoy.');
    expect(explainWarning('vendedor con pocas ventas (42)')[0].meaning).toContain('lleva 42 ventas');
    expect(explainWarning('vendedor con pocas ventas (1)')[0].meaning).toContain('lleva 1 venta y');
    expect(explainWarning('el precio cambió 5 veces en dos días')[0].meaning).toContain('se movió 5 veces');
    expect(explainWarning('11 vendedores en la ficha: el precio puede cambiar')[0].meaning).toContain('Hay 11 vendedores');
  });
});

describe('explainWarning con los avisos unidos', () => {
  it('separa los unidos con "; ", acepta "Ojo:" adelante y el punto final', () => {
    const help = explainWarning('Ojo: hace poco estuvo a $44.990; otro vendedor lo ofrece a menos; vendedor con pocas ventas (4).');
    expect(help.map((h) => h.kind)).toEqual(['precio', 'precio', 'vendedor']);
    for (const h of help) expect(h.whatToDo).not.toBe(UNKNOWN_TO_DO);
    expect(explainWarning('hace poco estuvo a $44.990; otro vendedor lo ofrece a menos')).toEqual(help.slice(0, 2));
  });

  it('"(y N más)" dice cuántos no cupieron, en singular y en plural', () => {
    const two = explainWarning('hace poco estuvo a $285.000; otro vendedor lo ofrece a menos (y 2 más)');
    expect(two).toHaveLength(3);
    expect(two[1].kind).toBe('precio');
    expect(two[1].whatToDo).not.toBe(UNKNOWN_TO_DO);
    expect(two[2]).toEqual({
      kind: 'otro',
      meaning: 'Hay 2 avisos más que no caben en la tarjeta.',
      whatToDo: 'Toca "Ver en Mercado Libre" y revisa la oferta con calma antes de subirla.',
    });
    const one = explainWarning('no es nuevo (y 1 más)');
    expect(one.map((h) => h.meaning)).toEqual([explainWarning('no es nuevo')[0].meaning, 'Hay 1 aviso más que no cabe en la tarjeta.']);
  });

  it('el aviso más largo que arma interest.ts se explica entero, con los que no cupieron', () => {
    const worst = interestScore(
      product({
        name: 'XR5000PRO-2024 Consola Reacondicionada Para Juegos',
        brand: 'Genérica',
        price: 1_234_567,
        original_price: 1_300_000,
        seller_sales_count: 11,
        offer_info: { is_lowest: false, official_store: false, sold_by_ml: false },
      }),
      evidence({ min30: 1_150_000 })
    ).warning as string;
    const more = /\(y (\d+) más\)$/.exec(worst);
    expect(more).not.toBeNull();
    const help = explainWarning(worst);
    const named = worst.replace(/\s*\(y \d+ más\)$/, '').split('; ');
    expect(help).toHaveLength(named.length + 1);
    named.forEach((part, i) => expect(recognized(help[i], part), part).toBe(true));
    expect(help[help.length - 1].meaning).toBe(`Hay ${more?.[1]} avisos más que no caben en la tarjeta.`);
  });

  it('reconoce el texto aunque llegue con otras mayúsculas o sin tildes', () => {
    for (const text of ['CAMBIO DE PRECIO Y NO SABEMOS CUANTO COSTABA ANTES', 'El Nombre Parte Con Un Codigo', 'la oferta es chica.']) {
      const [help] = explainWarning(text);
      expect(recognized(help, text), text).toBe(true);
    }
  });

  it('un aviso que no conoce sale tal cual, como "otro", con qué hacer', () => {
    expect(explainWarning('algo que interest.ts todavía no dice')).toEqual([
      { kind: 'otro', meaning: 'algo que interest.ts todavía no dice', whatToDo: UNKNOWN_TO_DO },
    ]);
    // Entre conocidos, solo ese queda tal cual.
    const mixed = explainWarning('otro vendedor lo ofrece a menos; aviso nuevo');
    expect(mixed[0].whatToDo).not.toBe(UNKNOWN_TO_DO);
    expect(mixed[1]).toEqual({ kind: 'otro', meaning: 'aviso nuevo', whatToDo: UNKNOWN_TO_DO });
  });

  it('sin aviso no hay nada que explicar', () => {
    for (const text of ['', '   ', 'Ojo:', 'Ojo: .', ' ; ; ']) expect(explainWarning(text), JSON.stringify(text)).toEqual([]);
    expect(explainWarning(null as unknown as string)).toEqual([]);
    expect(explainWarning(undefined as unknown as string)).toEqual([]);
  });
});

describe('la lista completa (WARNING_GLOSSARY)', () => {
  it('en el orden de interest.ts, con un ejemplo y una explicación cada uno', () => {
    expect(WARNING_GLOSSARY.map((entry) => entry.example)).toEqual([
      'hace poco estuvo a $X',
      'otro vendedor lo ofrece a menos',
      'vendedor con pocas ventas (N)',
      'hoy no se pudo leer su historial de precios',
      'cambió de precio y no sabemos cuánto costaba antes',
      'el precio cambió N veces en dos días',
      'el precio va y vuelve entre los mismos valores',
      'N vendedores en la ficha: el precio puede cambiar',
      'no es nuevo',
      'sin oferta que mostrar',
      'descuento del vendedor con poco respaldo',
      'la oferta es chica',
      'el nombre parte con un código',
    ]);
    for (const entry of WARNING_GLOSSARY) {
      expect(entry.meaning.length, entry.example).toBeGreaterThan(20);
      expect(entry.whatToDo.length, entry.example).toBeGreaterThan(10);
      // Sin cifras inventadas: en la lista completa no hay un aviso de verdad.
      expect(entry.meaning, entry.example).not.toMatch(/\$\d/);
    }
  });

  it('dice lo que la marca puede decir: nada de "recomendado", "verificado" ni "precio de lista"', () => {
    const all = WARNING_GLOSSARY.map((entry) => `${entry.meaning} ${entry.whatToDo}`).join(' ');
    expect(all).not.toMatch(/recomendad|verificad|precio de lista|mejor precio|imperdible|rebajad|precio normal/i);
  });
});

describe('WarningGuide: "¿Qué significa cada aviso?"', () => {
  const draw = (props: { omit?: readonly string[]; className?: string } = {}) => renderToStaticMarkup(createElement(WarningGuide, props));
  /** El texto que se lee, con las comillas de vuelta. */
  const read = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&quot;/g, '"').replace(/\s+/g, ' ');

  it('va plegada, con el resumen del alto de un dedo', () => {
    const html = draw();
    expect(html).toMatch(/^<details class="mt-2 [^"]*"><summary class="[^"]*\bmin-h-11\b[^"]*">¿Qué significa cada aviso\?<\/summary>/);
    expect(html).not.toMatch(/<details[^>]* open/);
    expect(draw({ className: 'mt-6' })).toMatch(/^<details class="mt-6 /);
  });

  it('trae todos los avisos, por grupo y en orden, cada uno con qué significa y qué hacer', () => {
    const html = draw();
    const text = read(html);
    const groups = ['Del precio', 'Del vendedor', 'De la oferta', 'Otros'];
    const at = groups.map((title) => html.indexOf(`>${title}</h3>`));
    expect(at.every((i) => i > 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    for (const entry of WARNING_GLOSSARY) {
      expect(text).toContain(`"${entry.example}"`);
      expect(text).toContain(entry.meaning);
      expect(text).toContain(entry.whatToDo);
    }
    // Sin "Ojo:" adelante: no se confunde con el aviso de una tarjeta.
    expect(text).not.toContain('Ojo:');
  });

  it('omit saca los avisos que esa pestaña nunca muestra', () => {
    const text = read(draw({ omit: [HISTORY_UNREAD_EXAMPLE] }));
    const unread = WARNING_GLOSSARY.find((entry) => entry.example === HISTORY_UNREAD_EXAMPLE);
    expect(unread).toBeDefined();
    expect(text).not.toContain(`"${HISTORY_UNREAD_EXAMPLE}"`);
    expect(text).not.toContain(unread?.meaning ?? '?');
    for (const entry of WARNING_GLOSSARY) if (entry !== unread) expect(text).toContain(`"${entry.example}"`);
  });

  it('un grupo que queda vacío no se dibuja', () => {
    const html = draw({ omit: ['vendedor con pocas ventas (N)'] });
    expect(html).not.toContain('>Del vendedor</h3>');
    expect(html).toContain('>Del precio</h3>');
  });
});
