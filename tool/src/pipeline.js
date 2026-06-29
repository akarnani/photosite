// sharp image pipeline: responsive WebP + JPEG fallback + blur placeholder.
// All conversion happens in an OS temp dir (cleaned up in finally). Finished
// variants are copied into the gitignored local cache for offline preview
// (DESIGN.md §6) and, unless --no-upload, pushed to R2.
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { stripTrailingSlash } from './config.js';
import * as rclone from './rclone.js';
import * as state from './state.js';
import * as ui from './ui.js';

const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.tif', '.tiff', '.webp', '.heic', '.heif']);

export function isImage(file) {
  return IMAGE_EXT.has(path.extname(file).toLowerCase());
}

// basename without extension, lowercased, non-[a-z0-9._-] collapsed to "-".
export function fileStem(filename) {
  const base = path.basename(filename).replace(/\.[^.]+$/, '');
  return base.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
}

// Map an R2 object key back to its source stem: strip a "-<width>.webp" variant
// suffix or a ".jpg"/".webp" extension. Used for orphan detection.
export function keyToStem(key) {
  const base = key.replace(/^.*\//, '');
  return base.replace(/-\d+\.webp$/i, '').replace(/\.(jpe?g|webp)$/i, '');
}

const round = (n, p = 4) => Number(n.toFixed(p));

// Process one source image into `outDir`. Returns image-derived fields (keys,
// not URLs — the caller builds URLs from publicBaseUrl + slug).
export async function processImage(srcPath, cfg, outDir) {
  const stem = fileStem(srcPath);
  const meta = await sharp(srcPath, { failOn: 'none' }).metadata();

  // metadata() reports pre-rotation dims; account for EXIF orientation 5–8.
  const swap = (meta.orientation || 1) >= 5;
  const srcW = swap ? meta.height : meta.width;
  const srcH = swap ? meta.width : meta.height;

  const quality = cfg.images.quality;

  // WebP at each configured width that doesn't exceed the source (never upscale).
  let widths = cfg.images.widths.filter((w) => w <= srcW).sort((a, b) => a - b);
  if (!widths.length) widths = [srcW];

  const variants = [];
  for (const w of widths) {
    const key = `${stem}-${w}.webp`;
    await sharp(srcPath, { failOn: 'none' })
      .rotate()
      .resize({ width: w })
      .webp({ quality })
      .toFile(path.join(outDir, key));
    variants.push({ w, key });
  }

  // One JPEG fallback (mozjpeg) at min(fallbackWidth, sourceWidth).
  const fbW = Math.min(cfg.images.fallbackWidth, srcW);
  const fbH = Math.round((fbW * srcH) / srcW);
  const fallbackKey = `${stem}.jpg`;
  await sharp(srcPath, { failOn: 'none' })
    .rotate()
    .resize({ width: fbW })
    .jpeg({ quality, mozjpeg: true })
    .toFile(path.join(outDir, fallbackKey));

  // Tiny inline blur-up placeholder.
  const lqipBuf = await sharp(srcPath, { failOn: 'none' })
    .rotate()
    .resize({ width: 24 })
    .webp({ quality: 50 })
    .toBuffer();

  return {
    stem,
    width: fbW,
    height: fbH,
    ratio: round(srcW / srcH),
    lqip: `data:image/webp;base64,${lqipBuf.toString('base64')}`,
    variants,
    fallbackKey,
  };
}

// Build the URL-bearing image fields from processImage() output.
export function imageUrls(info, baseUrl, slug) {
  const base = stripTrailingSlash(baseUrl);
  const url = (key) => `${base}/${slug}/${key}`;
  return {
    width: info.width,
    height: info.height,
    ratio: info.ratio,
    lqip: info.lqip,
    fallback: url(info.fallbackKey),
    srcset: info.variants.map((v) => ({ url: url(v.key), w: v.w })),
  };
}

// Process every file, refresh the local cache for the slug, and (optionally)
// upload. Returns a map of srcPath → processImage() output.
export async function run({ files, cfg, slug, paths, upload }) {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'photosite-'));
  try {
    const images = {};
    for (const f of files) {
      ui.step(`processing ${path.basename(f)}`);
      images[f] = await processImage(f, cfg, tmp);
    }

    // Refresh the local cache for this slug (overwrite prior contents).
    const cacheTrip = paths.cacheTripDir(slug);
    await fsp.rm(cacheTrip, { recursive: true, force: true });
    await fsp.mkdir(cacheTrip, { recursive: true });
    await fsp.cp(tmp, cacheTrip, { recursive: true });
    ui.ok(`cached ${files.length} image set(s) locally for preview`);

    if (upload) {
      ui.step(`uploading to ${cfg.r2.remote}:${cfg.r2.bucket}/${slug}/`);
      await rclone.copyDir({
        remote: cfg.r2.remote,
        bucket: cfg.r2.bucket,
        prefix: `${slug}/`,
        localDir: tmp,
      });
      ui.ok('upload complete');
      state.markUploaded(paths, slug);
    } else {
      ui.warn('skipped R2 upload (--no-upload); preview uses the local cache');
      state.markPending(paths, slug);
    }

    return images;
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true });
  }
}
