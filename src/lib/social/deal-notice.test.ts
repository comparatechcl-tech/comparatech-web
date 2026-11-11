import { describe, expect, it } from 'vitest';
import { NAME_MATCH_MIN, NOTICE_MAX_DEALS, nameMatch, nameTokens, noticeNote, parseDealNotice } from './deal-notice';

// Avisos reales del canal de afiliados (10-11 y 11-11-2026), tal como se copian de WhatsApp.
const AVISO_10_11 = `¡Sube estas recomendaciones a tus historias antes de que se agoten! Hay productos con descuentos impresionantes ideales para diferentes perfiles: 🚀

💻 *Notebook Gamer OMEN HyperX HP 15-ga0017la Intel Core i7 16GB RAM RTX 5070 1TB SSD 15.3" 2K Windows 11 Home*

Precio: *$2.699.990 a $2.479.990 (8% OFF)*

https://tinyurl.com/4pbjkf7s

📱 *Tab A1 Plus 128 GB / 6 GB Octa Core 12.2" 2.4K 120 Hz + Lápiz + Teclado (Negro)*

Precio: *$499.990 a $248.990 (50% OFF)*

https://tinyurl.com/2xajku2b

🔋 *Batería Externa Power Bank 30000 mAh 22.5W PD Master-G (Azul)*

Precio: *$54.990 a $28.490 (48% OFF)*

https://tinyurl.com/2xa5vt97

🚗 *Gooloo A3 Arrancador de Baterías Portátil Compresor Inflador*

Precio: *$219 a $84.875 (61% OFF)*

https://tinyurl.com/4exhxd4t`;

const AVISO_11_11 = `[11/11, 11:58] null: *🔥 DOREL 11/11: descuentos de hasta 67% OFF 🛒*
Silla De Auto Convertible Poplar Stone Onyx Britax
Con el cupón *🎟️ PICK11* queda en $279.990
🔗https://www.mercadolibre.cl/up/MLCU379728559
[11/11, 11:58] null: ¡Lo más vendido en electro! ⚡
Ventilador Tower Fan Mouvair Freeze Silencioso 6 Velocidades Con Ionizador De Aire y Wifi
Con el cupón 🎟️ LOCURASDD queda en $84.990
🔗https://www.mercadolibre.cl/p/MLC63071662
[11/11, 12:34] null: *¡HABEMUS CUPÓN DE FECHA DOBLE!*
🎟️FECHADOBLE: $5.000 off en compras sobre $34.990
[11/11, 14:09] null: 📺 *Tecnología y Hogar*

🖥️ *Smart TV Samsung 55" Mini LED M70H 4K Vision AI (2026)*
🔥 *48% OFF*
💰 De ~$629.990~ a *$369.474*
👉 https://tinyurl.com/5947na3n

🍟 *Freidora de aire Kitchen-it Max Edition 12 L (Negro)*
🔥 *50% OFF*
💰 De ~$159.990~ a *$79.990*
👉 https://tinyurl.com/ytjadv5k

🧹 *Aspiradora vertical Rowenta X-Force 8.8 Animal Digital (Rojo)*
🔥 *47% OFF*
💰 De ~$229.990~ a *$129.990*
👉 https://tinyurl.com/2z3hsub2

💡 Tip para afiliados: Destaquen el impresionante 78% de descuento en la Berberina Qin Supplements y el 60% de descuento en la Bicicleta de Spinning SB Pink. Promocionar los descuentos más altos del 11.11 es la táctica perfecta para capturar la atención inmediata de los usuarios y disparar las conversiones.`;

describe('parseDealNotice', () => {
  it('lee los productos de un aviso con "Precio: $A a $B" y links tinyurl', () => {
    const parsed = parseDealNotice(AVISO_10_11);
    expect(parsed.deals).toEqual([
      {
        name: 'Notebook Gamer OMEN HyperX HP 15-ga0017la Intel Core i7 16GB RAM RTX 5070 1TB SSD 15.3" 2K Windows 11 Home',
        price: 2_479_990,
        coupon: null,
        mlId: null,
      },
      {
        name: 'Tab A1 Plus 128 GB / 6 GB Octa Core 12.2" 2.4K 120 Hz + Lápiz + Teclado (Negro)',
        price: 248_990,
        coupon: null,
        mlId: null,
      },
      { name: 'Batería Externa Power Bank 30000 mAh 22.5W PD Master-G (Azul)', price: 28_490, coupon: null, mlId: null },
      { name: 'Gooloo A3 Arrancador de Baterías Portátil Compresor Inflador', price: 84_875, coupon: null, mlId: null },
    ]);
    expect(parsed.coupons).toEqual([]);
    expect(parsed.omitted).toBe(0);
  });

  it('lee varios mensajes juntos: cupones por producto, cupones sueltos y links limpios', () => {
    const parsed = parseDealNotice(AVISO_11_11);
    expect(parsed.deals).toEqual([
      { name: 'Silla De Auto Convertible Poplar Stone Onyx Britax', price: 279_990, coupon: 'PICK11', mlId: null },
      {
        name: 'Ventilador Tower Fan Mouvair Freeze Silencioso 6 Velocidades Con Ionizador De Aire y Wifi',
        price: 84_990,
        coupon: 'LOCURASDD',
        mlId: 'MLC63071662',
      },
      { name: 'Smart TV Samsung 55" Mini LED M70H 4K Vision AI (2026)', price: 369_474, coupon: null, mlId: null },
      { name: 'Freidora de aire Kitchen-it Max Edition 12 L (Negro)', price: 79_990, coupon: null, mlId: null },
      { name: 'Aspiradora vertical Rowenta X-Force 8.8 Animal Digital (Rojo)', price: 129_990, coupon: null, mlId: null },
    ]);
    // El de fecha doble viene solo, sin producto; el consejo final no trae nada.
    expect(parsed.coupons).toEqual(['FECHADOBLE']);
  });

  it('sin links no hay productos, y lo vacío no falla', () => {
    expect(parseDealNotice('Hola, mañana hay ofertas de tecnología').deals).toEqual([]);
    expect(parseDealNotice('')).toEqual({ deals: [], omitted: 0, coupons: [] });
    expect(parseDealNotice(undefined as unknown as string).deals).toEqual([]);
  });

  it('no repite un producto y corta en el tope', () => {
    const one = (n: number) => `*Audífonos Bluetooth Modelo Número ${n}*\nPrecio: $10.990\nhttps://tinyurl.com/x${n}\n`;
    const text = Array.from({ length: NOTICE_MAX_DEALS + 3 }, (_, i) => one(i)).join('\n') + one(0);
    const parsed = parseDealNotice(text);
    expect(parsed.deals).toHaveLength(NOTICE_MAX_DEALS);
    expect(parsed.omitted).toBe(3);
  });

  it('una línea "CUPÓN PARA TODOS" no es un código', () => {
    expect(parseDealNotice('CUPÓN PARA TODOS los compradores').coupons).toEqual([]);
  });
});

describe('nameMatch', () => {
  it('reconoce la misma ficha aunque cambien el orden, las tildes y "128 GB" / "128GB"', () => {
    expect(
      nameMatch(
        'Tab A1 Plus 128 GB / 6 GB Octa Core 12.2" 2.4K 120 Hz + Lápiz + Teclado (Negro)',
        'TAB A1 Plus 128GB / 6GB Octa Core 12.2" 2.4k 120Hz + Lapiz + Teclado'
      )
    ).toBeGreaterThanOrEqual(NAME_MATCH_MIN);
    expect(
      nameMatch('Smart TV Samsung 55" Mini LED M70H 4K Vision AI (2026)', '55" Mini LED M70H 4K Samsung Vision AI Smart TV (2026)')
    ).toBe(1);
  });

  it('prefiere el color que pide el aviso', () => {
    const notice = 'Freidora de aire Kitchen-it Max Edition 12 L (Negro)';
    const black = nameMatch(notice, 'Freidora de aire Kitchen-it Electrodomésticos Max Edition de 12L color negro');
    const grey = nameMatch(notice, 'Freidora De Aire Max Edition 12l Kitchen-it Gris');
    expect(black).toBe(1);
    expect(grey).toBeLessThan(black);
    expect(grey).toBeGreaterThanOrEqual(NAME_MATCH_MIN);
  });

  it('no confunde productos distintos', () => {
    expect(nameMatch('Freidora de aire Kitchen-it Max Edition 12 L (Negro)', 'Molde Silicon Freidora Aire Almohadilla Rojo')).toBeLessThan(
      NAME_MATCH_MIN
    );
    expect(nameMatch('', 'algo')).toBe(0);
  });

  it('nameTokens junta número y unidad y quita palabras vacías', () => {
    expect(nameTokens('Batería de 30000 mAh con 22.5 W')).toEqual(['bateria', '30000mah', '22.5w']);
  });
});

describe('noticeNote', () => {
  it('dice si el precio cambió desde el aviso', () => {
    expect(noticeNote({ price: 248_990, coupon: null }, 289_994, null)).toBe('El aviso dice $248.990; hoy está a $289.994');
    expect(noticeNote({ price: 28_490, coupon: null }, 28_490, null)).toBe('Mismo precio que el aviso');
    expect(noticeNote({ price: null, coupon: null }, 28_490, null)).toBe('');
  });

  it('con cupón, el precio del aviso es con el cupón: no se compara', () => {
    expect(noticeNote({ price: 84_990, coupon: 'LOCURASDD' }, 89_990, null)).toBe(
      'El aviso trae el cupón LOCURASDD: con él queda en $84.990. Si quieres, escríbelo en la historia'
    );
  });

  it('avisa si ya se subió como historia', () => {
    expect(noticeNote({ price: 289_994, coupon: null }, 289_994, { price: 271_990, at: '2026-10-30T11:46:05Z' })).toBe(
      'Mismo precio que el aviso. Ya la subiste como historia el 30/10 a $271.990'
    );
  });
});
