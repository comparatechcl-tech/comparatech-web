export type SellerReputation = 'verde' | 'amarillo' | 'naranja' | 'rojo';
export type RrssStatus = 'sin_usar' | 'seleccionado' | 'publicado';

/**
 * Señales de la oferta ganadora tal como las informa Mercado Libre en la
 * última revisión de precio (ver lib/pricing). Se guardan para mostrar en
 * la ficha solo datos ciertos: nada de "llega mañana" ni promesas que ML no
 * confirma.
 */
export interface OfferInfo {
  free_shipping: boolean;
  /** Enviado con Full (logistic_type 'fulfillment'). */
  is_full: boolean;
  /** La vende Mercado Libre directamente (tag 'first_party'). */
  sold_by_ml: boolean;
  official_store: boolean;
  /** "Garantía de fábrica: 2 años". null si no hay o dice "Sin garantía". */
  warranty: string | null;
  /** Cuántos vendedores ofrecen el producto en la ficha. */
  offers_count: number | null;
  /** ¿El ganador es además el precio más bajo? null si no se pudo saber. */
  is_lowest: boolean | null;
}

export interface Product {
  id: string;
  slug: string;
  name: string;
  brand: string;
  category: string;
  price: number;
  original_price: number | null;
  image_url: string;
  affiliate_url: string;
  description: string;
  specs: Record<string, string | number>;
  seller_reputation: SellerReputation;
  seller_sales_count: number;
  is_featured: boolean;
  /** Lo maneja el cron: false cuando el vendedor dejó de ofrecer el producto. */
  is_active: boolean;
  /** Decisión humana desde /admin/productos. El cron no la toca. */
  is_hidden: boolean;
  ml_product_id: string | null;
  /** Tipo de producto según ML ("MLC-HEADPHONES"), base de la categoría. */
  ml_domain_id: string | null;
  // Identificador de familia de ML (parent_id): todos los colores del mismo
  // modelo lo comparten. Permite mostrar una sola tarjeta por producto real.
  ml_family_id: string | null;
  seller_id: number | null;
  rrss_status: RrssStatus;
  created_at: string;
  /** Por qué está fuera del sitio. null si está activo. */
  inactive_reason: 'sin_ganador' | 'ganador_no_verde' | 'link_otro_producto' | null;
  inactive_since: string | null;
  /** Última vez que se comparó el precio contra la ficha de Mercado Libre. */
  price_checked_at: string | null;
  /** Oferta ganadora de la caja de compra en la última revisión. */
  winner_item_id: string | null;
  /** Ficha de catálogo a la que lleva el link de afiliado. */
  link_target_product_id: string | null;
  link_checked_at: string | null;
  /**
   * Destino del botón "Ver en Mercado Libre" según la configuración vigente.
   * No es una columna: se calcula al leer el producto (ver lib/outbound).
   */
  outbound_url?: string;
  // Columnas agregadas por migraciones posteriores. Son opcionales porque
  // el sitio tiene que seguir funcionando mientras la migración no se
  // aplica (ver lib/supabase/errors).
  offer_info?: OfferInfo | null;
  /** Categoría hoja de ML del ganador ("MLC3697"). */
  ml_category_id?: string | null;
  /** Categoría raíz de ML: define si la comisión es 4% u 8% (lib/commission). */
  ml_root_category?: string | null;
  rrss_published_at?: string | null;
  rrss_channel?: string | null;
  deleted_at?: string | null;
  admin_note?: string | null;
}

export interface ProductCandidate {
  id: string;
  ml_product_id: string;
  ml_family_id: string | null;
  ml_domain_id: string | null;
  /** Oferta concreta a la que corresponde `price`. */
  ml_item_id: string | null;
  name: string;
  brand: string | null;
  category: string;
  price: number;
  original_price: number | null;
  image_url: string;
  description: string;
  specs: Record<string, string | number>;
  seller_id: number;
  seller_nickname: string | null;
  seller_reputation: SellerReputation;
  seller_sales_count: number;
  affiliate_url: string | null;
  status: 'pending_review' | 'approved' | 'rejected' | 'expired';
  source: string;
  prospected_at: string;
  reject_reason?: string | null;
  reviewed_by?: string | null;
  /** Posición en los destacados de ML de su categoría (1 = el primero). */
  highlight_position?: number | null;
  highlight_category_id?: string | null;
  ml_root_category?: string | null;
  is_full?: boolean | null;
  official_store?: boolean | null;
  checked_at?: string | null;
}

export interface CategoryInfo {
  slug: string;
  name: string;
}
