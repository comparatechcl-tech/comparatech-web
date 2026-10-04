/**
 * Comisión estimada del Programa de Afiliados de Mercado Libre.
 *
 * La comisión depende de la categoría RAÍZ del producto, no de la hoja: un
 * parlante y un televisor pagan lo mismo porque ambos cuelgan de
 * Electrónica. Por eso se guarda ml_root_category (ver lib/pricing).
 *
 * La tabla sale de la ayuda 27913 de ML ("Comisiones del Programa de
 * Afiliados"). Tecnología paga la mitad que el resto, lo que cambia qué
 * conviene destacar: un producto de hogar a $50.000 deja lo mismo que uno de
 * tecnología a $100.000.
 *
 * "direct" es la venta del mismo producto del link; "indirect", otra compra
 * que el visitante hace dentro de la ventana de atribución.
 */

export interface CommissionRate {
  direct: number;
  indirect: number;
  /** 'tabla' si la raíz está en la tabla; 'asumido' si se usó el valor por defecto. */
  source: 'tabla' | 'asumido';
}

const TECNOLOGIA = { direct: 0.04, indirect: 0.02 };
const GENERAL = { direct: 0.08, indirect: 0.04 };

/**
 * Los ids se comprobaron contra /categories/{id} de la API de ML (octubre
 * 2026): todos existen y tienen el nombre indicado. Lo que la API no dice es
 * la tasa: esa sale de la ayuda 27913 y hay que revisarla a mano si ML la
 * cambia. Los marcados "tasa sin verificar" no aparecen con id en la ayuda,
 * solo por nombre.
 */
const RATES: Record<string, { direct: number; indirect: number }> = {
  // Tecnología
  MLC1051: TECNOLOGIA, // Celulares y Telefonía
  MLC1648: TECNOLOGIA, // Computación
  MLC1000: TECNOLOGIA, // Electrónica, Audio y Video
  MLC1144: TECNOLOGIA, // Consolas y Videojuegos
  MLC1039: TECNOLOGIA, // Cámaras y Accesorios
  MLC5726: TECNOLOGIA, // Electrodomésticos — tasa sin verificar
  // General
  MLC1574: GENERAL, // Hogar y Muebles
  MLC1276: GENERAL, // Deportes y Fitness — tasa sin verificar
  MLC3937: GENERAL, // Relojes y Joyas — tasa sin verificar
  MLC1182: GENERAL, // Instrumentos Musicales — tasa sin verificar
  MLC1246: GENERAL, // Belleza y Cuidado Personal — tasa sin verificar
};

/**
 * Lo que se asume cuando no se conoce la raíz: la tasa más baja, para no
 * sobreestimar lo que deja un producto. Casi todo el catálogo es tecnología.
 */
const DEFAULT_RATE = TECNOLOGIA;

export function commissionRate(rootId: string | null): CommissionRate {
  const known = rootId ? RATES[rootId] : undefined;
  if (known) return { ...known, source: 'tabla' };
  return { ...DEFAULT_RATE, source: 'asumido' };
}

/** Comisión de una venta directa, en pesos. */
export function estimateCommission(price: number, rootId: string | null): number {
  if (!Number.isFinite(price) || price <= 0) return 0;
  return Math.round(price * commissionRate(rootId).direct);
}
