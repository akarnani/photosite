// Re-runnable configuration wizard. Records non-secret config to TOML and writes
// the R2 credential into the rclone remote (never into the repo).
import path from 'node:path';
import * as ui from '../ui.js';
import { findRepoRoot } from '../paths.js';
import { loadConfig, mergeDefaults, saveConfig, stripTrailingSlash } from '../config.js';
import * as rclone from '../rclone.js';
import * as exif from '../exif.js';

export async function setup() {
  ui.heading('photosite setup');

  // 1. Tool checks — warn, don't hard-fail (user may configure before installing).
  const haveRclone = await rclone.available();
  haveRclone ? ui.ok('rclone found') : ui.warn('rclone not found — install: https://rclone.org/install/');
  const haveExif = await exif.available();
  haveExif ? ui.ok('exiftool found') : ui.warn('exiftool not found — install: https://exiftool.org');

  // 2. Load existing config (tolerate absence); pre-fill from it.
  const root = findRepoRoot() || process.cwd();
  const cur = loadConfig(root) || mergeDefaults();

  // Pre-fill account id by reading the existing rclone remote, if any.
  let accountId = '';
  if (haveRclone) {
    const remotes = await rclone.listRemotes();
    if (remotes.includes(cur.r2.remote)) {
      accountId = rclone.accountIdFromRemote(await rclone.showRemote(cur.r2.remote));
    }
  }

  // 3. Core prompts.
  const a = await ui.ask([
    { type: 'text', name: 'title', message: 'Site title', initial: cur.site.title },
    {
      type: 'text',
      name: 'publicBaseUrl',
      message: 'Public image base URL (R2 custom domain)',
      initial: cur.site.publicBaseUrl,
      validate: (v) => (/^https?:\/\//.test(v.trim()) ? true : 'Must start with http:// or https://'),
    },
    { type: 'text', name: 'remote', message: 'rclone remote name', initial: cur.r2.remote },
    { type: 'text', name: 'bucket', message: 'R2 bucket', initial: cur.r2.bucket },
    { type: 'text', name: 'accountId', message: 'Cloudflare account id', initial: accountId },
    { type: 'password', name: 'accessKeyId', message: 'R2 access key id (blank = keep existing)' },
    { type: 'password', name: 'secret', message: 'R2 secret access key (blank = keep existing)' },
  ]);

  // 4. Optional image tuning.
  let images = cur.images;
  if (await ui.confirm('Tune image widths / quality?', false)) {
    const i = await ui.ask([
      { type: 'text', name: 'widths', message: 'Widths (comma-separated)', initial: cur.images.widths.join(', ') },
      { type: 'number', name: 'quality', message: 'WebP/JPEG quality', initial: cur.images.quality },
      { type: 'number', name: 'fallbackWidth', message: 'JPEG fallback width', initial: cur.images.fallbackWidth },
    ]);
    images = {
      widths: i.widths.split(',').map((s) => parseInt(s.trim(), 10)).filter(Boolean).sort((x, y) => x - y),
      quality: i.quality,
      fallbackWidth: i.fallbackWidth,
    };
  }

  // 5. Species source.
  const { speciesFromKeywords } = await ui.ask({
    type: 'confirm',
    name: 'speciesFromKeywords',
    message: 'Read species from Capture One hierarchical keywords? (else use annotations.yaml)',
    initial: cur.keywords.speciesFromKeywords,
  });
  let speciesRoot = cur.keywords.speciesRoot;
  if (speciesFromKeywords) {
    speciesRoot = (
      await ui.ask({ type: 'text', name: 'speciesRoot', message: 'Species root keyword', initial: speciesRoot })
    ).speciesRoot;
  }

  // 6. Write the rclone remote (skip gracefully if rclone or account id missing).
  if (haveRclone && a.accountId) {
    ui.step(`writing rclone remote "${a.remote}"`);
    const { action } = await rclone.upsertRemote({
      name: a.remote,
      accountId: a.accountId.trim(),
      accessKeyId: a.accessKeyId,
      secret: a.secret,
    });
    ui.ok(`rclone remote ${action}d (credentials stored in rclone, not the repo)`);
  } else if (!haveRclone) {
    ui.warn('rclone not installed — re-run setup after installing to store the remote.');
  } else {
    ui.warn('No account id given — skipped writing the rclone remote.');
  }

  // 7. Save non-secret config.
  saveConfig(root, {
    site: { title: a.title, publicBaseUrl: stripTrailingSlash(a.publicBaseUrl) },
    r2: { remote: a.remote, bucket: a.bucket },
    images,
    keywords: { speciesFromKeywords, speciesRoot },
  });
  ui.ok(`saved ${path.join(root, 'photosite.config.toml')}`);
  ui.info('No secrets were written to the repo.');
}
