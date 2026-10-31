// Photo genres (underwater, wildlife, air shows, …). The list lives in the site
// (site/src/lib/genres.js — dependency-free, shared like favoritesEngine.js) so
// the CLI and the pages can never disagree about what a genre is.
import { GENRES, DEFAULT_GENRE, genreIds } from '../../site/src/lib/genres.js';

export { GENRES, DEFAULT_GENRE, genreIds };

// A prompts `select` question for a trip's genre.
export function genreQuestion(initial = DEFAULT_GENRE) {
  const ids = genreIds();
  return {
    type: 'select',
    name: 'genre',
    message: 'Genre',
    choices: ids.map((id) => ({ title: GENRES[id].label, value: id })),
    initial: Math.max(0, ids.indexOf(initial)),
  };
}

// Validate a --genre flag; returns an error string or null.
export function genreError(id) {
  return GENRES[id] ? null : `Unknown genre "${id}" (one of: ${genreIds().join(', ')})`;
}
