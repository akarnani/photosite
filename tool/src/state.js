// Local, gitignored tracking of which trips have been processed but not yet
// uploaded to R2 (lives under the cache dir, which is already gitignored). This
// is a single-machine convenience: "uploaded" really means "uploaded from here".
import fs from 'node:fs';
import path from 'node:path';

const fileFor = (paths) => path.join(paths.cacheDir, '.upload-state.json');

function read(paths) {
  try {
    return JSON.parse(fs.readFileSync(fileFor(paths), 'utf8'));
  } catch {
    return { pending: [] };
  }
}

function write(paths, state) {
  fs.mkdirSync(paths.cacheDir, { recursive: true });
  fs.writeFileSync(fileFor(paths), JSON.stringify(state, null, 2) + '\n');
}

export function pendingSlugs(paths) {
  const p = read(paths).pending;
  return Array.isArray(p) ? p : [];
}

export function markPending(paths, slug) {
  const pending = pendingSlugs(paths);
  if (!pending.includes(slug)) write(paths, { pending: [...pending, slug] });
}

export function markUploaded(paths, slug) {
  const pending = pendingSlugs(paths);
  if (pending.includes(slug)) write(paths, { pending: pending.filter((s) => s !== slug) });
}
