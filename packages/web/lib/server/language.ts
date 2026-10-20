/**
 * Small stop-word detector for the languages Beamling is used in most. It only needs to be right
 * when it answers; anything ambiguous falls back to "the language of the question".
 */
const STOP_WORDS: Record<string, string[]> = {
  English: ["the", "is", "are", "what", "how", "why", "which", "who", "of", "and", "in", "to", "does", "for", "with", "between", "about"],
  Italian: ["il", "lo", "la", "gli", "le", "che", "cosa", "come", "perché", "quale", "quali", "di", "del", "della", "è", "sono", "per", "tra", "nel", "con"],
  Spanish: ["el", "los", "las", "que", "qué", "cómo", "por", "cuál", "cuáles", "es", "son", "del", "para", "con", "entre", "una", "en", "y"],
  French: ["le", "les", "des", "est", "sont", "que", "quoi", "comment", "pourquoi", "quel", "quelle", "du", "pour", "avec", "entre", "une", "et", "dans"],
  German: ["der", "die", "das", "ist", "sind", "was", "wie", "warum", "welche", "und", "mit", "für", "zwischen", "ein", "eine", "im", "von", "nicht"],
  Portuguese: ["o", "os", "as", "que", "como", "porque", "qual", "quais", "é", "são", "do", "da", "dos", "para", "com", "entre", "uma", "em"],
};

const MIN_HITS = 2;

export function detectLanguage(text: string): string | undefined {
  const words = text.toLowerCase().match(/\p{L}+/gu) ?? [];
  if (!words.length) return undefined;
  const scores = Object.entries(STOP_WORDS)
    .map(([language, list]) => ({ language, hits: words.filter((word) => list.includes(word)).length }))
    .sort((a, b) => b.hits - a.hits);
  const [best, second] = scores;
  if (best.hits < MIN_HITS || best.hits === second.hits) return undefined;
  return best.language;
}
