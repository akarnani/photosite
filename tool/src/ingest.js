// Shared folder-ingest used by add-trip and update-trip: process images, read
// EXIF, and assemble sorted photo records.
import fs from 'node:fs';
import path from 'node:path';
import * as pipeline from './pipeline.js';
import * as exif from './exif.js';
import * as ui from './ui.js';

export function validateFolder(folder) {
  if (!folder || !fs.existsSync(folder) || !fs.statSync(folder).isDirectory()) {
    ui.fail(`Source folder not found: ${folder}`);
  }
}

export function listImages(folder) {
  return fs
    .readdirSync(folder)
    .filter((f) => !f.startsWith('.') && pipeline.isImage(f))
    .map((f) => path.join(folder, f))
    .sort();
}

// Centroid of all geotagged photos (for the trip-level map marker), or null.
export function centroid(records) {
  const pts = records.filter((r) => r.gps).map((r) => r.gps);
  if (!pts.length) return null;
  const lat = pts.reduce((s, p) => s + p.lat, 0) / pts.length;
  const lon = pts.reduce((s, p) => s + p.lon, 0) / pts.length;
  return { lat: Number(lat.toFixed(5)), lon: Number(lon.toFixed(5)) };
}

// Process a folder into photo records (newest-first by date).
export async function ingestFolder({ folder, cfg, slug, paths, upload }) {
  const files = listImages(folder);
  if (!files.length) ui.fail(`No images found in ${folder}`);

  ui.step(`reading metadata for ${files.length} image(s)`);
  const meta = await exif.readMetadata(files);
  const bySource = new Map(meta.map((m) => [path.resolve(m.SourceFile), m]));

  const images = await pipeline.run({ files, cfg, slug, paths, upload });

  const records = files.map((f) => {
    const raw = bySource.get(path.resolve(f)) || {};
    const norm = exif.normalize(raw, cfg);
    const urls = pipeline.imageUrls(images[f], cfg.site.publicBaseUrl, slug);
    return {
      file: path.basename(f),
      ...urls,
      date: norm.date,
      gps: norm.gps,
      camera: norm.camera,
      lens: norm.lens,
      exposure: norm.exposure,
      caption: norm.caption,
      species: norm.species,
      keywords: norm.keywords,
    };
  });

  records.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
  return records;
}
