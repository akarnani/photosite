// Photo genres: the kinds of shoot a trip can be (underwater, wildlife, air
// shows, …). A trip names its genre in trip.yaml (`genre: wildlife`); a trip
// without one is `underwater`, so every existing trip keeps working unchanged.
//
// Each genre carries its own copy (eyebrow, tagline, what to call the
// `species` field) and an accent colour. The site chrome is neutral; the accent
// is the only per-genre colour, applied through `data-genre` (global.css).
//
// Shared by the site AND the CLI (the tool imports it by relative path, like
// favoritesEngine.js) — keep it dependency-free.

export const GENRES = {
  underwater: {
    label: 'Underwater',
    eyebrow: 'Underwater photography',
    tagline: 'Dives, by trip — where each frame was taken, and what swam past the lens.',
    subject: 'Species', // what the annotations' `species` list holds
    subjectItalic: true, // scientific / common names read as names
    accent: '#58d2c6',
    accentDeep: '#2b8e87',
  },
  wildlife: {
    label: 'Wildlife',
    eyebrow: 'Wildlife photography',
    tagline: 'Animals where they live — who turned up, and where.',
    subject: 'Species',
    subjectItalic: true,
    accent: '#d9a85b',
    accentDeep: '#93702f',
  },
  'air-shows': {
    label: 'Air shows',
    eyebrow: 'Aviation photography',
    tagline: 'Air shows and fly-ins — what flew, who flew it, and where.',
    subject: 'Aircraft',
    subjectItalic: false,
    accent: '#7fb2ff',
    accentDeep: '#3f6db3',
  },
};

export const DEFAULT_GENRE = 'underwater';

export const genreIds = () => Object.keys(GENRES);

export function genreId(trip) {
  const g = trip?.genre;
  return g && GENRES[g] ? g : DEFAULT_GENRE;
}

export function genreOf(trip) {
  return { id: genreId(trip), ...GENRES[genreId(trip)] };
}
