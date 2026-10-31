// Pick the trip cover photo. Interactive: the same TUI browser in "cover" mode
// (Enter sets the cover). Non-TTY: falls back to a simple select prompt.
// Enter (or p) then opens the position view: arrow keys slide the photo inside
// the hero / link-preview frames and save trip.yaml `coverPosition`.
// `--position <pos>` sets it directly ("50% 20%", "top", "none" clears);
// a bare `--position` opens the drag-to-position page in the browser.
import path from 'node:path';
import * as ui from '../ui.js';
import { requireRepoRoot, paths } from '../paths.js';
import { readTrip, writeTrip, withCover, withCoverPosition, collectSpecies } from '../trips.js';
import { pickInBrowser } from '../position/pick.js';
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

  if (opts.position === true) return browserPosition(P, slug, trip, photos, opts);
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
  let chosenPos = parseCoverPosition(trip.coverPosition);
  await runTui({
    mode: 'cover',
    title: trip.title || slug,
    photos,
    initialAnn: {},
    initialCover: trip.cover,
    initialPosition: chosenPos,
    pool: collectSpecies(P),
    cacheDir,
    stemOf: fileStem,
    persist: (_ann, cover, position) => {
      chosen = cover;
      chosenPos = position;
      writeTrip(P, slug, { trip: withCoverPosition(trip, cover, position) });
    },
    openViewer: (f) => openImage(path.join(cacheDir, `${fileStem(f)}.jpg`)),
    openBrowserPicker: (photo, initial, onUrl, onSave) =>
      pickInBrowser({ photo, cacheDir, title: trip.title || slug, initial, onUrl, onSave }),
    offerPublish: false,
  });
  ui.ok(`cover set to ${chosen}${chosenPos ? ` (position ${chosenPos.x}% ${chosenPos.y}%)` : ''}`);
}

async function browserPosition(P, slug, trip, photos, opts) {
  const photo = photos.find((p) => p.file === trip.cover) || photos[0];
  const cover = photo.file;
  const pos = await pickInBrowser({
    photo,
    cacheDir: P.cacheTripDir(slug),
    title: trip.title || slug,
    initial: parseCoverPosition(trip.coverPosition),
    open: opts.open !== false,
    onUrl: (url) => ui.ok(`Open ${ui.value(url)} — drag the photo, Save, then Done (Ctrl-C to quit)`),
    onSave: (p) => {
      writeTrip(P, slug, { trip: withCoverPosition(trip, cover, p) });
      ui.ok(p ? `cover position set to ${p.x}% ${p.y}%` : 'cover position cleared (centred)');
    },
  });
  if (pos === undefined) ui.info('No changes saved.');
  process.exit(0);
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
