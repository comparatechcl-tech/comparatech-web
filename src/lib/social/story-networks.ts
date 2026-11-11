/**
 * Las redes donde se sube una historia a mano desde /admin/historias, como
 * en /admin/videos: una marca por red (social_posts, con STORY_MARK en
 * `caption` y la red en `channel`).
 *
 * - Instagram: la única con link que se toca (el sticker "Enlace"). La
 *   cuenta comparte sola sus historias en Facebook (el dueño lo dejó así), así
 *   que Facebook no lleva marca aparte: subirla dos veces la repetiría.
 * - TikTok: también tiene historias, sin link que se toque.
 * YouTube ya no tiene historias (las cerró en 2023).
 *
 * Puro y sin Node: lo usan la página, la lista y las acciones.
 */

export type StoryNetwork = 'instagram' | 'tiktok';

/** En el orden en que se muestran: primero la del link. */
export const STORY_NETWORKS: readonly StoryNetwork[] = ['instagram', 'tiktok'];

export const STORY_NETWORK_LABELS: Record<StoryNetwork, string> = {
  instagram: 'Instagram y Facebook',
  tiktok: 'TikTok',
};

/** Las marcas de una historia: el id de la fila por red marcada. */
export type StoryMarks = Partial<Record<StoryNetwork, number>>;

export function isStoryNetwork(value: unknown): value is StoryNetwork {
  return value === 'instagram' || value === 'tiktok';
}

function list(networks: StoryNetwork[]): string {
  const names = networks.map((n) => STORY_NETWORK_LABELS[n]);
  return names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} y ${names[names.length - 1]}`;
}

/** "Ya está en Instagram y Facebook. Falta: TikTok.", o null si no hay ninguna marcada o están todas. Puro. */
export function storyMissingLine(marks: StoryMarks): string | null {
  const done = STORY_NETWORKS.filter((n) => Boolean(marks[n]));
  const missing = STORY_NETWORKS.filter((n) => !marks[n]);
  if (done.length === 0 || missing.length === 0) return null;
  return `Ya está en ${list(done)}. Falta: ${list(missing)}.`;
}

/** ¿Tiene alguna red marcada? Puro. */
export function anyMarked(marks: StoryMarks | undefined): boolean {
  return STORY_NETWORKS.some((n) => Boolean(marks?.[n]));
}
