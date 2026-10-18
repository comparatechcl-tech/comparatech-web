import type { ThermometerSummary } from '@/lib/black-friday-thermometer';

/**
 * El balance del Black Friday 2026, congelado.
 *
 * Mientras esto sea null, /datos/black-friday-2026 calcula el balance con el
 * catálogo de ese momento. El historial no cambia, pero el catálogo sí: un
 * producto que se borra después (por ejemplo con "Limpiar el catálogo")
 * deja de contar, y el porcentaje publicado se movería un poco. Para que no
 * cambie lo que ya citó alguien, después del 1 de diciembre de 2026 se pega
 * acá el resumen tal como lo calculó el sitio (ver
 * _local/herramientas/termometro/ en la carpeta del proyecto) y la página
 * usa este para siempre.
 */
export const FROZEN_BALANCE: ThermometerSummary | null = null;
