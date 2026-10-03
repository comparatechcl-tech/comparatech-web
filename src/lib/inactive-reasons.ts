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

export function reasonInfo(reason: string | null | undefined): ReasonInfo {
  return reason && reason in REASON_LABELS
    ? REASON_LABELS[reason as InactiveReason]
    : UNKNOWN_REASON;
}
