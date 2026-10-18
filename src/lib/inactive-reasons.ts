/**
 * Por qué un producto está fuera del sitio, en palabras para el admin y el
 * correo diario.
 *
 * Sin imports a propósito: lo usan componentes de cliente. Si este archivo
 * importara algo del servidor, el bundle del navegador arrastraría código —y
 * variables de entorno— que no le corresponden.
 */

export type InactiveReason = 'sin_ganador' | 'ganador_no_verde' | 'link_otro_producto';

export interface ReasonInfo {
  title: string;
  detail: string;
  /** true si se resuelve solo; false si necesita que alguien haga algo. */
  auto: boolean;
}

export const REASON_LABELS: Record<InactiveReason, ReasonInfo> = {
  sin_ganador: {
    title: 'Sin vendedor disponible',
    detail:
      'Mercado Libre no tiene ninguna oferta ganadora para esta ficha en este momento. Suele ser temporal: vuelve a publicarse solo apenas aparezca un vendedor.',
    auto: true,
  },
  ganador_no_verde: {
    title: 'Vendedor sin reputación verde',
    detail:
      'La oferta que Mercado Libre muestra en la ficha es de un vendedor sin reputación verde, y solo se promocionan vendedores verdes. Vuelve a publicarse solo cuando cambie el vendedor.',
    auto: true,
  },
  link_otro_producto: {
    title: 'El link lleva a otro producto',
    detail:
      'El link de afiliado abre una ficha distinta a la publicada, así que el comprador terminaría viendo otro producto. Hay que generarlo de nuevo desde la ficha correcta.',
    auto: false,
  },
};

/** Productos inactivos de antes de que se guardara el motivo. */
export const UNKNOWN_REASON: ReasonInfo = {
  title: 'Pendiente de revisión',
  detail:
    'Quedó fuera del sitio antes de que se registraran los motivos. "Revisar ahora" consulta Mercado Libre y lo vuelve a publicar si corresponde.',
  auto: true,
};

/**
 * Cuánto tiempo sigue publicada la ficha de un producto sin vendedores.
 * Casi siempre vuelve solo en días (el cron lo reactiva apenas aparece un
 * vendedor); pasado este plazo es un producto descontinuado y la ficha deja
 * de tener sentido, así que pasa a 404 y Google la saca del índice. La
 * página de su modelo deja de mostrarlo al mismo tiempo.
 */
export const INACTIVE_GRACE_DAYS = 60;

/** ¿Lleva tanto tiempo fuera de venta que ya no vale la pena mostrarlo? */
export function isPastInactiveGrace(
  product: { is_active: boolean; inactive_since?: string | null },
  now: number = Date.now()
): boolean {
  if (product.is_active || !product.inactive_since) return false;
  const since = new Date(product.inactive_since).getTime();
  if (Number.isNaN(since)) return false;
  return now - since > INACTIVE_GRACE_DAYS * 86_400_000;
}

export function reasonInfo(reason: string | null | undefined): ReasonInfo {
  return reason && reason in REASON_LABELS
    ? REASON_LABELS[reason as InactiveReason]
    : UNKNOWN_REASON;
}
