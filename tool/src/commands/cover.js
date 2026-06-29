// Pick the trip cover photo. Interactive: the same TUI browser in "cover" mode
// (Enter sets the cover). Non-TTY: falls back to a simple select prompt.
import path from 'node:path';
import * as ui from '../ui.js';
import { requireRepoRoot, paths } from '../paths.js';
import { readTrip, writeTrip, collectSpecies } from '../trips.js';
import { fileStem } from '../pipeline.js';
import { resolveSlug } from '../select.js';
import { runTui } from '../tui/render.js';
import { openImage } from '../viewer.js';

export async function cover(slugArg) {
  const root = requireRepoRoot();
  const P = paths(root);
  const slug = await resolveSlug(P, slugArg);

  const { trip, photos } = readTrip(P, slug);
  if (!photos.length) ui.fail('Trip has no photos.');

  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    const { file } = await ui.ask({
      type: 'select',
      name: 'file',
      message: 'Cover photo',
      initial: Math.max(0, photos.findIndex((p) => p.file === trip.cover)),
      choices: photos.map((p) => ({ title: p.file, value: p.file })),
    });
    writeTrip(P, slug, { trip: { ...trip, cover: file } });
    ui.ok(`cover set to ${file}`);
    return;
  }

  const cacheDir = P.cacheTripDir(slug);
  let chosen = trip.cover;
  await runTui({
    mode: 'cover',
    title: trip.title || slug,
    photos,
    initialAnn: {},
    initialCover: trip.cover,
    pool: collectSpecies(P),
    cacheDir,
    stemOf: fileStem,
    persist: (_ann, cover) => {
      chosen = cover;
      writeTrip(P, slug, { trip: { ...trip, cover } });
    },
    openViewer: (f) => openImage(path.join(cacheDir, `${fileStem(f)}.jpg`)),
    offerPublish: false,
  });
  ui.ok(`cover set to ${chosen}`);
}
