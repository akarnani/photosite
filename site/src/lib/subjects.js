// Subject groups for the favorites game ("pick your favorite turtle, your
// favorite clownfish…"), written by `photosite subjects` (a local CLIP model)
// to src/content/subjects.json. Absent → the game has no "by subject" option.
// Resolved from process.cwd(), like trips.js (Vite SSR breaks import.meta.url).
import fs from 'node:fs';
import path from 'node:path';

const FILE = path.join(process.cwd(), 'src', 'content', 'subjects.json');

// → [{ name, ids }] (ids are "<slug>/<file>"), or null.
export function getSubjects() {
  try {
    const groups = JSON.parse(fs.readFileSync(FILE, 'utf8')).groups;
    return Array.isArray(groups) && groups.length ? groups : null;
  } catch {
    return null;
  }
}
