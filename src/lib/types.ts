export type SellerReputation = 'verde' | 'amarillo' | 'naranja' | 'rojo';

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
  created_at: string;
}

export interface ProductCandidate {
  id: string;
  ml_product_id: string;
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
  status: 'pending_review' | 'approved' | 'rejected';
  source: string;
  prospected_at: string;
}

export interface CategoryInfo {
  slug: string;
  name: string;
}

export const CATEGORIES: CategoryInfo[] = [
  { slug: 'celulares', name: 'Celulares' },
  { slug: 'computacion', name: 'Computación' },
  { slug: 'electronica', name: 'Electrónica' },
  { slug: 'hogar', name: 'Hogar' },
  { slug: 'electrodomesticos', name: 'Electrodomésticos' },
];
