// Read/write trip content files and small helpers over the trip collection.
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';

export function slugify(name) {
  return String(name)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function listTripSlugs(paths) {
  if (!fs.existsSync(paths.contentDir)) return [];
  return fs
    .readdirSync(paths.contentDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .filter((slug) => fs.existsSync(path.join(paths.contentDir, slug, 'trip.yaml')))
    .sort();
}

export function tripExists(paths, slug) {
  return fs.existsSync(path.join(paths.tripDir(slug), 'trip.yaml'));
}

export function readTrip(paths, slug) {
  const dir = paths.tripDir(slug);
  const readYaml = (f) => {
    const p = path.join(dir, f);
    return fs.existsSync(p) ? yaml.load(fs.readFileSync(p, 'utf8')) || {} : {};
  };
  const photosPath = path.join(dir, 'photos.json');
  return {
    slug,
    dir,
    trip: readYaml('trip.yaml'),
    photos: fs.existsSync(photosPath) ? JSON.parse(fs.readFileSync(photosPath, 'utf8')) : [],
    annotations: readYaml('annotations.yaml'),
  };
}

// Write whichever of { trip, photos, annotations } are provided.
export function writeTrip(paths, slug, { trip, photos, annotations }) {
  const dir = paths.tripDir(slug);
  fs.mkdirSync(dir, { recursive: true });
  if (trip) {
    fs.writeFileSync(path.join(dir, 'trip.yaml'), yaml.dump(trip, { lineWidth: 100 }));
  }
  if (photos) {
    fs.writeFileSync(path.join(dir, 'photos.json'), JSON.stringify(photos, null, 2) + '\n');
  }
  if (annotations) {
    fs.writeFileSync(
      path.join(dir, 'annotations.yaml'),
      yaml.dump(annotations, { lineWidth: 100, sortKeys: false }),
    );
  }
}

// Build an annotations map in photo order, preserving existing entries and
// adding blank stubs for new files. Entries for removed files are dropped.
export function stubAnnotations(photos, existing = {}) {
  const out = {};
  for (const p of photos) {
    out[p.file] = existing[p.file] ?? { title: null, species: [], caption: null };
  }
  return out;
}

// Every species name used anywhere (photos.json + annotations), for autocomplete.
export function collectSpecies(paths) {
  const set = new Set();
  for (const slug of listTripSlugs(paths)) {
    const { photos, annotations } = readTrip(paths, slug);
    for (const p of photos) for (const s of p.species || []) set.add(s);
    for (const a of Object.values(annotations)) for (const s of a?.species || []) set.add(s);
  }
  return [...set].sort((a, b) => a.localeCompare(b));
}
