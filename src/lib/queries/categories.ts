import { CATEGORIES, CategoryInfo } from '@/lib/types';

export function getAllCategories(): CategoryInfo[] {
  return CATEGORIES;
}

export function getCategoryInfo(slug: string): CategoryInfo | undefined {
  return CATEGORIES.find((c) => c.slug === slug);
}
