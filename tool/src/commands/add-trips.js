// Bulk-ingest trips: scan a parent folder, multiselect which image folders are
// trips, describe each (front-loaded), then process them all and publish once.
import fs from 'node:fs';
import path from 'node:path';
import * as ui from '../ui.js';
import { requireRepoRoot, paths } from '../paths.js';
import { loadConfig } from '../config.js';
import * as rclone from '../rclone.js';
import * as exif from '../exif.js';
import { slugify, listTripSlugs } from '../trips.js';
import { discoverImageFolders, defaultTitleFromRel } from '../discover.js';
import { listImages, tripDateLabel, validateFolder } from '../ingest.js';
import { createTrip } from '../create-trip.js';
import { maybePublish } from '../publish.js';

const isDir = (p) => {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
};

export async function addTrips(parentArg, opts = {}) {
  const root = requireRepoRoot();
  const cfg = loadConfig(root);
  const P = paths(root);
  const upload = opts.upload !== false;
  const min = Math.max(1, parseInt(opts.min, 10) || 1);

  if (!(await exif.available())) ui.fail('exiftool is required. Install: https://exiftool.org');
  if (upload && !(await rclone.available())) {
    ui.fail('rclone is required to upload. Install: https://rclone.org/install/ (or pass --no-upload)');
  }
  if (!process.stdin.isTTY || !process.stdout.isTTY) ui.fail('`add-trips` needs an interactive terminal.');

  // 1. Parent folder.
  let parent = opts.from || parentArg;
  if (!parent) {
    parent = (
      await ui.ask({
        type: 'text',
        name: 'p',
        message: 'Parent folder to scan',
        validate: (v) => (v && isDir(v) ? true : 'Folder not found'),
      })
    ).p;
  }
  validateFolder(parent);

  // 2. Discover image folders (any depth).
  ui.step(`scanning ${parent} for image folders…`);
  const found = discoverImageFolders(parent, { min });
  if (!found.length) ui.fail(`No image folders with ≥${min} photo(s) found under ${parent}.`);

  // 3. Multiselect which become trips.
  const { picks } = await ui.ask({
    type: 'multiselect',
    name: 'picks',
    message: 'Add which trips?',
    instructions: false,
    hint: 'space toggles · a = all · enter confirms',
    choices: found.map((f) => ({ title: `${f.relPath}  (${f.count} photos)`, value: f, selected: true })),
  });
  if (!picks || !picks.length) {
    ui.info('Nothing selected — no changes made.');
    return;
  }

  // 4. Describe each (front-loaded; cancelling here writes nothing).
  const taken = new Set(listTripSlugs(P));
  const specs = [];
  for (const folder of picks) {
    ui.heading(`Describe: ${folder.relPath}  (${folder.count} photos)`);
    ui.step('reading photo dates…');
    const meta = await exif.readMetadata(listImages(folder.absPath));
    const dateGuess = tripDateLabel(meta);
    const defTitle = defaultTitleFromRel(folder.relPath);

    let spec = null;
    for (;;) {
      const a = await ui.ask([
        { type: 'text', name: 'title', message: 'Title', initial: defTitle, validate: (v) => (v.trim() ? true : 'Required') },
        { type: 'text', name: 'location', message: 'Location (e.g. "Komodo, Indonesia")' },
        { type: 'text', name: 'dates', message: 'Dates', initial: dateGuess },
        { type: 'text', name: 'summary', message: 'Short intro' },
      ]);
      const title = a.title.trim();
      const slug = slugify(title);
      if (!slug) {
        ui.warn('Could not derive a slug from that title — try another.');
        continue;
      }
      if (taken.has(slug)) {
        const { action } = await ui.ask({
          type: 'select',
          name: 'action',
          message: `A trip "${slug}" already exists`,
          choices: [
            { title: 'Rename (pick a different title)', value: 'rename' },
            { title: 'Skip this folder', value: 'skip' },
          ],
        });
        if (action === 'rename') continue;
        break; // skip
      }
      taken.add(slug);
      spec = { folder: folder.absPath, relPath: folder.relPath, title, slug, location: a.location || '', dates: a.dates || dateGuess, summary: a.summary || '', meta };
      break;
    }
    if (spec) specs.push(spec);
    else ui.info(`skipped ${folder.relPath}`);
  }

  if (!specs.length) {
    ui.info('No trips to add.');
    return;
  }

  // 5. Process all (unattended).
  ui.heading(`Processing ${specs.length} trip(s)`);
  const added = [];
  const failed = [];
  let i = 0;
  for (const s of specs) {
    i += 1;
    ui.heading(`[${i}/${specs.length}] ${s.title} (${s.slug})`);
    try {
      const { count } = await createTrip({
        cfg,
        paths: P,
        slug: s.slug,
        title: s.title,
        folder: s.folder,
        locationName: s.location,
        dates: s.dates,
        summary: s.summary,
        upload,
        meta: s.meta,
      });
      added.push({ slug: s.slug, count });
      ui.ok(`added ${s.slug} (${count} photos)`);
    } catch (e) {
      failed.push({ slug: s.slug, reason: e.message });
      ui.error(`failed ${s.slug}: ${e.message}`);
    }
  }

  // 6. Summary + single publish.
  ui.heading('Summary');
  if (added.length) ui.ok(`Added ${added.length} trip(s): ${added.map((a) => a.slug).join(', ')}`);
  if (failed.length) ui.warn(`Failed ${failed.length}: ${failed.map((f) => `${f.slug} (${f.reason})`).join('; ')}`);
  ui.info('Annotate any trip later with `photosite annotate <slug>`.');

  if (added.length) {
    await maybePublish({ root, upload, message: `Add ${added.length} trips: ${added.map((a) => a.slug).join(', ')}` });
  }
}
