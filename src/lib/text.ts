const DIACRITICS_RE = new RegExp('[̀-ͯ]', 'g'); // U+0300–U+036F, marcas diacríticas combinadas

// Quita tildes/diéresis para comparar texto sin importar cómo lo haya
// escrito el usuario ("audifonos" vs "audífonos") — muy común que la gente
// no tipee tildes al buscar.
export function stripDiacritics(text: string): string {
  return text.normalize('NFD').replace(DIACRITICS_RE, '');
}
