/**
 * Resultado de una carga de links en bloque (republicar productos o aprobar
 * candidatos), tal como lo muestra el admin.
 *
 * Sin imports a propósito: lo usan componentes de cliente.
 */

/** Tope por tanda: cada link se abre una vez y la acción tiene 60 segundos. */
export const MAX_BATCH = 30;

export type BatchOutcome =
  | 'activo'
  | 'sin_ganador'
  | 'ganador_no_verde'
  | 'link_otro_producto'
  | 'error_transitorio'
  /** Guardado, pero ML no respondió: se publica en la próxima revisión. */
  | 'pendiente'
  /** Ninguno de los links pegados era de este producto. */
  | 'sin_link'
  /** No se pudo guardar (el detalle va en `detail`). */
  | 'error';

export interface BatchItemResult {
  id: string;
  name: string;
  outcome: BatchOutcome;
  /** true si se comprobó que el link lleva a esta ficha; false si se asignó por orden. */
  verified: boolean;
  detail?: string;
}

export type BatchResult =
  | {
      ok: true;
      items: BatchItemResult[];
      /** Links que llevan a una ficha que no estaba en la tanda. */
      wrongLinks: { url: string; featuredProductId: string }[];
      /** Links que no se pudieron asignar a ningún producto. */
      unmatchedLinks: string[];
      linksFound: number;
    }
  | { ok: false; error: string };
