// Ingest a folder of photos as a new trip.
import fs from 'node:fs';
import path from 'node:path';
import * as ui from '../ui.js';
import { requireRepoRoot, paths } from '../paths.js';
import { loadConfig } from '../config.js';
import * as rclone from '../rclone.js';
import * as exif from '../exif.js';
import { slugify, tripExists } from '../trips.js';
import { validateFolder, listImages, tripDateLabel } from '../ingest.js';
import { createTrip } from '../create-trip.js';
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

  // Resolve the source folder first, then read EXIF so we can pre-fill the
  // trip dates from the photos themselves.
  let from = opts.from;
  if (!from) {
    from = (await ui.ask({ type: 'text', name: 'from', message: 'Source photo folder', validate: folderValidate })).from;
  }
  validateFolder(from);

  const files = listImages(from);
  if (!files.length) ui.fail(`No images found in ${from}`);
  ui.step(`reading metadata for ${files.length} image(s)`);
  const meta = await exif.readMetadata(files);
  const dateGuess = tripDateLabel(meta);

  const q = [];
  if (!opts.name) q.push({ type: 'text', name: 'name', message: 'Trip name', validate: (v) => (v.trim() ? true : 'Required') });
  if (!opts.location) q.push({ type: 'text', name: 'location', message: 'Location (e.g. "Raja Ampat, Indonesia")' });
  if (!opts.dates) q.push({ type: 'text', name: 'dates', message: 'Dates', initial: dateGuess });
  q.push({ type: 'text', name: 'summary', message: 'Short intro paragraph' });
  const ans = await ui.ask(q);

  const name = (opts.name || ans.name || '').trim();
  const location = opts.location || ans.location || '';
  const dates = opts.dates || ans.dates || dateGuess;
  const summary = ans.summary || '';

  const slug = slugify(name);
  if (!slug) ui.fail('Could not derive a slug from the trip name.');
  if (tripExists(P, slug)) ui.fail(`Trip "${slug}" already exists. Use \`photosite update-trip ${slug}\`.`);

  ui.heading(`Adding trip "${name}" (${slug})`);
  const { count } = await createTrip({
    cfg,
    paths: P,
    slug,
    title: name,
    folder: from,
    locationName: location,
    dates,
    summary,
    upload,
    meta,
  });
  ui.ok(`wrote ${path.relative(root, P.tripDir(slug))}/ (${count} photos)`);
  ui.info(`annotations: ${path.relative(root, path.join(P.tripDir(slug), 'annotations.yaml'))}`);

  // Ask BEFORE launching the TUI (a readline prompt can't run after it). If we
  // annotate, the TUI itself offers to publish; otherwise prompt here.
  if (await ui.confirm('Annotate species & captions now?', true)) {
    await annotate(slug, { offerPublish: upload, publishMessage: `Add trip: ${name}` });
    if (!upload) ui.info('Images not uploaded (--no-upload); run `photosite upload` then `photosite push`.');
  } else {
    await maybePublish({ root, upload, message: `Add trip: ${name}` });
  }
}

function isDir(p) {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}
