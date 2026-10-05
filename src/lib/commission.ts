/**
 * Comisión estimada del Programa de Afiliados de Mercado Libre.
 *
 * La comisión depende de la categoría RAÍZ del producto, no de la hoja: un
 * parlante y un televisor pagan lo mismo porque ambos cuelgan de
 * Electrónica. Por eso se guarda ml_root_category (ver lib/pricing).
 *
 * Las tasas directas son las que Mercado Libre mostró a esta cuenta en
 * octubre de 2026, sin ninguna campaña de incentivos activa: 11% en una
 * venta real de Hogar y Muebles ("Venta directa: 11%" en Métricas) y 7% en
 * la ficha de un producto de audio. La ayuda 27913 de ML decía 8% y 4%: se
 * dejó de usar porque subestimaba lo que de verdad se paga. Tecnología
 * sigue pagando menos que el resto, lo que cambia qué conviene destacar.
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

const TECNOLOGIA = { direct: 0.07, indirect: 0.02 };
const GENERAL = { direct: 0.11, indirect: 0.04 };

/**
 * Los ids se comprobaron contra /categories/{id} de la API de ML (octubre
 * 2026): todos existen y tienen el nombre indicado. Lo que la API no dice es
 * la tasa: se comprobó solo en MLC1574 (venta real) y MLC1000 (ficha); el
 * resto de cada grupo se asume igual y va marcado "tasa sin verificar". La
 * tasa indirecta sigue siendo la de la ayuda 27913: no se ha visto ninguna
 * venta indirecta para comprobarla.
 */
const RATES: Record<string, { direct: number; indirect: number }> = {
  // Tecnología
  MLC1051: TECNOLOGIA, // Celulares y Telefonía — tasa sin verificar
  MLC1648: TECNOLOGIA, // Computación — tasa sin verificar
  MLC1000: TECNOLOGIA, // Electrónica, Audio y Video — 7% visto en la ficha
  MLC1144: TECNOLOGIA, // Consolas y Videojuegos — tasa sin verificar
  MLC1039: TECNOLOGIA, // Cámaras y Accesorios — tasa sin verificar
  MLC5726: TECNOLOGIA, // Electrodomésticos — tasa sin verificar
  // General
  MLC1574: GENERAL, // Hogar y Muebles — 11% en una venta real
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
