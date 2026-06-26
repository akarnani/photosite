// Re-sync a trip from a folder: reprocess, re-upload, optionally prune orphans.
import fs from 'node:fs';
import * as ui from '../ui.js';
import { requireRepoRoot, paths } from '../paths.js';
import { loadConfig } from '../config.js';
import * as rclone from '../rclone.js';
import * as exif from '../exif.js';
import { keyToStem, fileStem } from '../pipeline.js';
import { readTrip, writeTrip, stubAnnotations } from '../trips.js';
import { resolveSlug } from '../select.js';
import { ingestFolder, validateFolder } from '../ingest.js';
import { maybePublish } from '../publish.js';

export async function updateTrip(slugArg, opts = {}) {
  const root = requireRepoRoot();
  const cfg = loadConfig(root);
  const P = paths(root);
  const upload = opts.upload !== false;

  if (!(await exif.available())) ui.fail('exiftool is required. Install: https://exiftool.org');
  if (upload && !(await rclone.available())) {
    ui.fail('rclone is required to upload. Install: https://rclone.org/install/ (or pass --no-upload)');
  }

  const slug = await resolveSlug(P, slugArg);

  let from = opts.from;
  if (!from) {
    from = (
      await ui.ask({
        type: 'text',
        name: 'from',
        message: 'Source photo folder',
        validate: (v) => {
          try {
            return fs.statSync(v).isDirectory() ? true : 'Folder not found';
          } catch {
            return 'Folder not found';
          }
        },
      })
    ).from;
  }
  validateFolder(from);

  ui.heading(`Updating trip "${slug}"`);
  const records = await ingestFolder({ folder: from, cfg, slug, paths: P, upload });

  // Orphan detection: remote keys whose stem has no matching local file.
  if (upload) {
    const localStems = new Set(records.map((r) => fileStem(r.file)));
    const keys = await rclone.listKeys({ remote: cfg.r2.remote, bucket: cfg.r2.bucket, prefix: `${slug}/` });
    const orphans = keys.filter((k) => !localStems.has(keyToStem(k)));

    if (orphans.length) {
      ui.warn(`${orphans.length} orphaned object(s) in R2 no longer match local files`);
      const prune = opts.prune || (await ui.confirm(`Delete ${orphans.length} orphaned object(s) from R2?`, false));
      if (prune) {
        for (const key of orphans) {
          await rclone.deleteKey({ remote: cfg.r2.remote, bucket: cfg.r2.bucket, prefix: `${slug}/`, key });
          ui.step(`deleted ${key}`);
        }
        ui.ok('pruned orphaned objects');
      } else {
        ui.info('left orphaned objects in place (re-run with --prune to remove)');
      }
    }
  }

  // Rewrite content; refresh cover if it vanished; re-stub annotations.
  const { trip, annotations } = readTrip(P, slug);
  if (!records.some((r) => r.file === trip.cover)) trip.cover = records[0]?.file ?? null;
  writeTrip(P, slug, { trip, photos: records, annotations: stubAnnotations(records, annotations) });
  ui.ok(`updated ${slug} (${records.length} photos)`);

  await maybePublish({ root, upload, message: `Update trip: ${trip.title || slug}` });
}
