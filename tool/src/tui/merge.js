// Effective-value + annotation-store helpers shared by the TUI (and testable).
export const arraysEqual = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

// The value shown/edited for a photo: annotation if set, else EXIF.
export function effective(photo, ann) {
  const a = ann || {};
  return {
    species: a.species && a.species.length ? a.species : photo.species || [],
    caption: (a.caption ?? photo.caption ?? '') || '',
    title: (a.title ?? '') || '',
  };
}

// What we persist for a photo: keep fields empty where they just match EXIF, so
// the site's EXIF fallback still applies and annotations.yaml stays lean.
export function toAnnotation(photo, { species, caption, title }) {
  const cap = (caption || '').trim();
  return {
    title: (title || '').trim() || null,
    species: arraysEqual(species, photo.species || []) ? [] : species,
    caption: cap && cap !== (photo.caption || '') ? cap : null,
  };
}
