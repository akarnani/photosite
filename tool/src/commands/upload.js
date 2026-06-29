// Upload a trip's already-processed derivatives from the local cache to R2,
// without reprocessing. The pipeline writes the cache even under --no-upload, so
// this is just an rclone copy of files that already match photos.json.
import fs from 'node:fs';
import * as ui from '../ui.js';
import { requireRepoRoot, paths } from '../paths.js';
import { loadConfig } from '../config.js';
import * as rclone from '../rclone.js';
import { listTripSlugs } from '../trips.js';
import { resolveSlug } from '../select.js';

export async function upload(slugArg, opts = {}) {
  const root = requireRepoRoot();
  const cfg = loadConfig(root);
  const P = paths(root);

  if (!(await rclone.available())) ui.fail('rclone is required. Install: https://rclone.org/install/');

  const slugs = opts.all ? listTripSlugs(P) : [await resolveSlug(P, slugArg)];
  if (!slugs.length) ui.fail('No trips to upload.');

  let uploaded = 0;
  let skipped = 0;
  for (const slug of slugs) {
    const dir = P.cacheTripDir(slug);
    if (!fs.existsSync(dir) || !fs.readdirSync(dir).length) {
      ui.warn(`${slug}: no local cache — run \`photosite update-trip ${slug} --from <folder>\` to reprocess`);
      skipped += 1;
      continue;
    }
    ui.step(`uploading ${slug} → ${cfg.r2.remote}:${cfg.r2.bucket}/${slug}/`);
    await rclone.copyDir({ remote: cfg.r2.remote, bucket: cfg.r2.bucket, prefix: `${slug}/`, localDir: dir });
    ui.ok(`uploaded ${slug}`);
    uploaded += 1;
  }

  ui.info(`Done — uploaded ${uploaded}, skipped ${skipped}.`);
  if (uploaded) ui.info('Run `photosite push` to publish if the trip content is not committed yet.');
}
