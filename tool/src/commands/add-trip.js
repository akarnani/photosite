// Ingest a folder of photos as a new trip.
import fs from 'node:fs';
import path from 'node:path';
import * as ui from '../ui.js';
import { requireRepoRoot, paths } from '../paths.js';
import { loadConfig } from '../config.js';
import * as rclone from '../rclone.js';
import * as exif from '../exif.js';
import { slugify, tripExists, writeTrip, stubAnnotations } from '../trips.js';
import { ingestFolder, validateFolder, centroid } from '../ingest.js';
import { maybePublish } from '../publish.js';
import { annotate } from './annotate.js';

async function requireTools(upload) {
  if (!(await exif.available())) ui.fail('exiftool is required. Install: https://exiftool.org');
  if (upload && !(await rclone.available())) {
    ui.fail('rclone is required to upload. Install: https://rclone.org/install/ (or pass --no-upload)');
  }
}

export async function addTrip(opts = {}) {
  const root = requireRepoRoot();
  const cfg = loadConfig(root);
  const P = paths(root);
  const upload = opts.upload !== false;

  await requireTools(upload);

  const folderValidate = (v) => (v && isDir(v) ? true : 'Folder not found');

  const q = [];
  if (!opts.name) q.push({ type: 'text', name: 'name', message: 'Trip name', validate: (v) => (v.trim() ? true : 'Required') });
  if (!opts.location) q.push({ type: 'text', name: 'location', message: 'Location (e.g. "Raja Ampat, Indonesia")' });
  if (!opts.dates) q.push({ type: 'text', name: 'dates', message: 'Dates (e.g. "2025-03-05 to 2025-03-07")' });
  q.push({ type: 'text', name: 'summary', message: 'Short intro paragraph' });
  if (!opts.from) q.push({ type: 'text', name: 'from', message: 'Source photo folder', validate: folderValidate });
  const ans = await ui.ask(q);

  const name = (opts.name || ans.name || '').trim();
  const location = opts.location || ans.location || '';
  const dates = opts.dates || ans.dates || '';
  const summary = ans.summary || '';
  const from = opts.from || ans.from;
  validateFolder(from);

  const slug = slugify(name);
  if (!slug) ui.fail('Could not derive a slug from the trip name.');
  if (tripExists(P, slug)) ui.fail(`Trip "${slug}" already exists. Use \`photosite update-trip ${slug}\`.`);

  ui.heading(`Adding trip "${name}" (${slug})`);
  const records = await ingestFolder({ folder: from, cfg, slug, paths: P, upload });

  const center = centroid(records);
  const trip = {
    title: name,
    slug,
    location: center ? { name: location, lat: center.lat, lon: center.lon } : { name: location },
    dates,
    summary,
    cover: records[0]?.file ?? null,
  };

  writeTrip(P, slug, { trip, photos: records, annotations: stubAnnotations(records) });
  ui.ok(`wrote ${path.relative(root, P.tripDir(slug))}/ (${records.length} photos)`);
  ui.info(`annotations: ${path.relative(root, path.join(P.tripDir(slug), 'annotations.yaml'))}`);

  if (await ui.confirm('Annotate species & captions now?', true)) {
    await annotate(slug, { offerPublish: false });
  }

  await maybePublish({ root, upload, message: `Add trip: ${name}` });
}

function isDir(p) {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}
