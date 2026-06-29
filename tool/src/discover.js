// Recursive discovery of image-bearing folders, for bulk `add-trips`. Capture
// One (and similar) store exports several levels deep, so a one-level scan isn't
// enough; we walk the tree, skipping known-noise directories.
import fs from 'node:fs';
import path from 'node:path';
import { isImage } from './pipeline.js';

// Directory names to never descend into (case-insensitive).
const IGNORE_EXACT = new Set(['cache', 'proxies', 'thumbnails', 'trash', 'adjustments', 'node_modules']);
function isIgnoredDir(name) {
  const lower = name.toLowerCase();
  if (name.startsWith('.')) return true; // hidden + .cosessiondb/.cocatalogdb packages
  if (IGNORE_EXACT.has(lower)) return true;
  if (lower.startsWith('settings')) return true; // Settings75, Settings120
  if (lower.startsWith('capture one')) return true; // catalog/session packages
  return false;
}

// Generic export-folder segment names that aren't the trip's identity.
const GENERIC_SEGMENTS = new Set([
  'output', 'web', 'jpg', 'jpeg', 'export', 'exports', 'exported', 'selects',
  'full', 'proofs', 'hires', 'lowres', 'lores', 'sized', 'processed', 'final', 'capture',
]);

function countDirectImages(entries) {
  let n = 0;
  for (const e of entries) if (e.isFile() && !e.name.startsWith('.') && isImage(e.name)) n++;
  return n;
}

// Walk `root`, returning [{ absPath, relPath, count }] for every directory whose
// direct image count is ≥ min. Sorted by relPath.
export function discoverImageFolders(root, { min = 1, maxDepth = 8 } = {}) {
  const out = [];
  const walk = (dir, depth) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return; // permission errors etc.
    }
    const count = countDirectImages(entries);
    if (count >= min) out.push({ absPath: dir, relPath: path.relative(root, dir) || path.basename(dir), count });
    if (depth >= maxDepth) return;
    for (const e of entries) {
      if (e.isDirectory() && !isIgnoredDir(e.name)) walk(path.join(dir, e.name), depth + 1);
    }
  };
  walk(path.resolve(root), 0);
  out.sort((a, b) => a.relPath.localeCompare(b.relPath));
  return out;
}

export function titleize(name) {
  return name
    .replace(/[._-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ');
}

// Best-guess trip title from a relative path: drop trailing generic export
// segments ("…/Raja Ampat/Output" → "Raja Ampat"), then titleize the last real
// segment. Falls back to the last segment if everything looks generic.
export function defaultTitleFromRel(relPath) {
  const segments = relPath.split(path.sep).filter((s) => s && s !== '.');
  if (!segments.length) return '';
  let i = segments.length - 1;
  while (i > 0 && GENERIC_SEGMENTS.has(segments[i].toLowerCase())) i--;
  return titleize(segments[i]);
}
