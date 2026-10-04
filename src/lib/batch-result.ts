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
  | 'error'
  /**
   * El link pegado para este producto es de otra cuenta de afiliado: no se
   * guardó, porque la comisión se la pagaría ML a otro.
   */
  | 'otra_cuenta'
  /**
   * Otro color del mismo modelo (mismo ml_family_id) venía en la tanda y se
   * publicó solo el más barato: el sitio muestra una tarjeta por modelo.
   */
  | 'omitido_variante';

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

/**
 * Aprobar un candidato de a uno. `outcome` dice si quedó a la vista o en
 * pausa —y por qué— según la revisión de precio que se hace al aprobar.
 * `reason`: el motivo de la pausa (lib/inactive-reasons) o 'pendiente' si
 * Mercado Libre no respondió y se revisa en la próxima pasada del cron.
 */
export type ApproveResult =
  | { ok: true; outcome: 'publicado' | 'en_pausa'; reason?: string; slug: string }
  | { ok: false; error: string };
