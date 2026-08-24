const DIACRITICS_RE = new RegExp('[̀-ͯ]', 'g'); // U+0300–U+036F, marcas diacríticas combinadas

// Quita tildes/diéresis para comparar texto sin importar cómo lo haya
// escrito el usuario ("audifonos" vs "audífonos") — muy común que la gente
// no tipee tildes al buscar.
export function stripDiacritics(text: string): string {
  return text.normalize('NFD').replace(DIACRITICS_RE, '');
}

// Google corta las meta descriptions alrededor de los 155-160 caracteres.
// Cortamos nosotros en el espacio anterior para no dejar una palabra partida
// al medio ni un "..." dentro de una cifra.
export function truncateAtWord(text: string, maxLength = 155): string {
  const clean = text.trim().replace(/\s+/g, ' ');
  if (clean.length <= maxLength) return clean;

  const cut = clean.slice(0, maxLength - 1);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > 0 ? cut.slice(0, lastSpace) : cut).replace(/[.,;:]$/, '')}…`;
}
