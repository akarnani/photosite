// Build-time content loader: reads each src/content/trips/<slug>/ folder,
// overlays annotations onto photos.json, and exposes helpers for the pages.
//
// IMPORTANT: resolve the content dir from process.cwd(), NOT import.meta.url —
// under Vite's SSR build import.meta.url points into a bundled chunk and breaks
// the relative path (DESIGN.md §13.1).
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';

const DEV = import.meta.env.DEV;
const CONTENT_DIR = path.join(process.cwd(), 'src', 'content', 'trips');

function readYaml(p) {
  return fs.existsSync(p) ? yaml.load(fs.readFileSync(p, 'utf8')) || {} : {};
}

// In dev, rewrite an absolute R2 URL to the local-images route (DESIGN.md §6).
function toLocal(url, slug) {
  if (!url) return url;
  const marker = `/${slug}/`;
  const i = url.lastIndexOf(marker);
  return i === -1 ? url : `/local-images/${slug}/${url.slice(i + marker.length)}`;
}

// Merge rule: annotations win for caption/species/title; a non-empty annotation
// species overrides EXIF, empty falls back to EXIF. Everything else from the
// photo record.
// Stable, URL-safe id from the filename (for lightbox permalinks + map anchors).
function photoSlug(file) {
  return file
    .replace(/\.[^.]+$/, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function mergePhoto(photo, ann, slug, index) {
  const a = ann || {};
  const species = a.species && a.species.length ? a.species : photo.species || [];
  const out = {
    ...photo,
    id: photoSlug(photo.file),
    title: a.title ?? null,
    caption: a.caption ?? photo.caption ?? null,
    species,
  };
  if (DEV) {
    out.fallback = toLocal(out.fallback, slug);
    out.srcset = (out.srcset || []).map((s) => ({ ...s, url: toLocal(s.url, slug) }));
  }
  return out;
}

function loadTrip(slug) {
  const dir = path.join(CONTENT_DIR, slug);
  const trip = readYaml(path.join(dir, 'trip.yaml'));
  const photosPath = path.join(dir, 'photos.json');
  const photos = fs.existsSync(photosPath) ? JSON.parse(fs.readFileSync(photosPath, 'utf8')) : [];
  const annotations = readYaml(path.join(dir, 'annotations.yaml'));
  return {
    slug,
    ...trip,
    photos: photos.map((p, i) => mergePhoto(p, annotations[p.file], slug, i)),
  };
}

const firstDate = (trip) => trip.photos[0]?.date || '';

export function getTrips() {
  if (!fs.existsSync(CONTENT_DIR)) return [];
  const slugs = fs
    .readdirSync(CONTENT_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .filter((s) => fs.existsSync(path.join(CONTENT_DIR, s, 'trip.yaml')));
  return slugs.map(loadTrip).sort((a, b) => firstDate(b).localeCompare(firstDate(a)));
}

export function getTrip(slug) {
  return loadTrip(slug);
}

// Group photos that share the exact same coordinates into one map point (GPS is
// often assigned per dive site, so many photos stack on one spot). Each point
// carries the list of photos at that location.
function groupByCoord(items) {
  const groups = new Map();
  for (const it of items) {
    const key = `${it.lat},${it.lon}`;
    if (!groups.has(key)) groups.set(key, { lat: it.lat, lon: it.lon, photos: [], slugs: [] });
    const g = groups.get(key);
    g.photos.push({ title: it.title, thumb: it.thumb, href: it.href });
    if (it.slug && !g.slugs.includes(it.slug)) g.slugs.push(it.slug);
  }
  return [...groups.values()];
}

// Per-trip map points link to the specific photo anchor on the trip page.
export function pointsForTrip(trip) {
  return groupByCoord(
    trip.photos
      .filter((p) => p.gps)
      .map((p) => ({
        lat: p.gps.lat,
        lon: p.gps.lon,
        title: p.title || p.species?.[0] || p.file,
        thumb: p.fallback,
        href: `/trips/${trip.slug}/#${p.id}`,
      })),
  );
}

// Global map points link to the trip page.
export function allPoints() {
  return groupByCoord(
    getTrips().flatMap((trip) =>
      trip.photos
        .filter((p) => p.gps)
        .map((p) => ({
          lat: p.gps.lat,
          lon: p.gps.lon,
          title: trip.title || trip.slug,
          thumb: p.fallback,
          href: `/trips/${trip.slug}/`,
          slug: trip.slug,
        })),
    ),
  );
}

// Cover photo record for a trip (named cover, else newest).
export function coverPhoto(trip) {
  return trip.photos.find((p) => p.file === trip.cover) || trip.photos[0] || null;
}

// Site-wide config (title) read from the repo's photosite.config.toml. Falls
// back gracefully so the site still builds without it.
export function siteConfig() {
  const fallback = { title: 'Below the Surface', author: '' };
  try {
    const toml = fs.readFileSync(path.join(process.cwd(), '..', 'photosite.config.toml'), 'utf8');
    return {
      title: (toml.match(/title\s*=\s*["']([^"']+)["']/) || [])[1] || fallback.title,
      author: (toml.match(/author\s*=\s*["']([^"']+)["']/) || [])[1] || fallback.author,
    };
  } catch {
    return fallback;
  }
}
