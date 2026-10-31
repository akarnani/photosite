// Pick the trip cover photo. Interactive: the same TUI browser in "cover" mode
// (Enter sets the cover). Non-TTY: falls back to a simple select prompt.
// `--position <pos>` instead sets where the current cover is cropped (trip.yaml
// coverPosition — hero banner + link-preview cards); "none" clears it.
import path from 'node:path';
import * as ui from '../ui.js';
import { requireRepoRoot, paths } from '../paths.js';
import { readTrip, writeTrip, withCover, collectSpecies } from '../trips.js';
import { parseCoverPosition } from '../../../site/src/lib/coverPosition.js';
import { fileStem } from '../pipeline.js';
import { resolveSlug } from '../select.js';
import { runTui } from '../tui/render.js';
import { openImage } from '../viewer.js';

export async function cover(slugArg, opts = {}) {
  const root = requireRepoRoot();
  const P = paths(root);
  const slug = await resolveSlug(P, slugArg);

  const { trip, photos } = readTrip(P, slug);
  if (!photos.length) ui.fail('Trip has no photos.');

  if (opts.position != null) return setPosition(P, slug, trip, opts.position);

  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    const { file } = await ui.ask({
      type: 'select',
      name: 'file',
      message: 'Cover photo',
      initial: Math.max(0, photos.findIndex((p) => p.file === trip.cover)),
      choices: photos.map((p) => ({ title: p.file, value: p.file })),
    });
    writeTrip(P, slug, { trip: withCover(trip, file) });
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
      writeTrip(P, slug, { trip: withCover(trip, cover) });
    },
    openViewer: (f) => openImage(path.join(cacheDir, `${fileStem(f)}.jpg`)),
    offerPublish: false,
  });
  ui.ok(`cover set to ${chosen}`);
}

function setPosition(P, slug, trip, value) {
  const v = String(value).trim();
  if (v === '' || v === 'none') {
    const { coverPosition, ...rest } = trip;
    writeTrip(P, slug, { trip: rest });
    ui.ok('cover position cleared (centred)');
    return;
  }
  const pos = parseCoverPosition(v);
  if (!pos) ui.fail(`Can't read position "${v}" — use e.g. "50% 20%" (x y) or "top".`);
  writeTrip(P, slug, { trip: { ...trip, coverPosition: `${pos.x}% ${pos.y}%` } });
  ui.ok(`cover position set to ${pos.x}% ${pos.y}% (${trip.cover})`);
}
