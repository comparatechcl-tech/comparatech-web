// Re-exporta el registro de categorías para el código que ya lo consumía
// desde acá. La fuente de verdad, incluido el mapeo desde los dominios de
// Mercado Libre, vive en lib/categories.ts.
export {
  getAllCategories,
  getCategoryInfo,
  getPopulatedCategories,
  CATEGORIES,
} from '@/lib/categories';
