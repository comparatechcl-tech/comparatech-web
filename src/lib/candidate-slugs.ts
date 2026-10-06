import { stripDiacritics } from '@/lib/text';

/**
 * Slugs de los productos que nacen de un candidato.
 *
 * Antes cada aprobación le preguntaba a la base si su slug estaba libre, y
 * por eso una tanda se publicaba de a uno: en paralelo, dos candidatos con el
 * mismo nombre tomaban el mismo slug antes de que cualquiera se guardara.
 * Repartiendo los slugs antes de guardar alcanza con una consulta por tanda y
 * los candidatos se pueden publicar varios a la vez.
 *
 * Puro y sin imports del servidor: se prueba sin red.
 */

export function slugify(text: string): string {
  return stripDiacritics(text.toLowerCase())
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** El slug que se intenta primero. Un nombre sin letras ni números no puede quedar vacío. */
export function baseSlug(name: string): string {
  return slugify(name) || 'producto';
}

/** El que se usa cuando el primero ya está tomado: desempata con el id del candidato. */
export function suffixedSlug(name: string, candidateId: string): string {
  return `${baseSlug(name)}-${candidateId.slice(0, 5)}`;
}

/**
 * Un slug distinto para cada candidato, en el orden en que vienen. `taken`
 * son los que ya existen en `products`; dos candidatos con el mismo nombre
 * dentro de la tanda tampoco chocan entre sí.
 */
export function assignSlugs(
  candidates: { id: string; name: string }[],
  taken: Iterable<string>
): Map<string, string> {
  const used = new Set(taken);
  const slugs = new Map<string, string>();
  for (const c of candidates) {
    const base = baseSlug(c.name);
    const slug = used.has(base) ? suffixedSlug(c.name, c.id) : base;
    used.add(slug);
    slugs.set(c.id, slug);
  }
  return slugs;
}
