// Guided per-photo annotation as a full-screen TUI: a photo list with a live
// thumbnail panel, and an edit panel for species/caption/title. See src/tui/.
import path from 'node:path';
import * as ui from '../ui.js';
import { requireRepoRoot, paths } from '../paths.js';
import { readTrip, writeTrip, collectSpecies, withCoverPosition } from '../trips.js';
import { parseCoverPosition } from '../../../site/src/lib/coverPosition.js';
import { pickInBrowser } from '../position/pick.js';
import { fileStem } from '../pipeline.js';
import { resolveSlug } from '../select.js';
import { commitAndPush } from '../publish.js';
import { runTui } from '../tui/render.js';
import { openImage } from '../viewer.js';

export async function annotate(slugArg, opts = {}) {
  const offerPublish = opts.offerPublish !== false;
  const root = requireRepoRoot();
  const P = paths(root);
  const slug = await resolveSlug(P, slugArg);

  const { trip, photos, annotations } = readTrip(P, slug);
  if (!photos.length) ui.fail('Trip has no photos to annotate.');
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    ui.fail('`annotate` needs an interactive terminal.');
  }

  const cacheDir = P.cacheTripDir(slug);
  const persist = (ann, cover, position) => {
    const merged = {};
    for (const p of photos) merged[p.file] = ann[p.file] ?? { title: null, species: [], caption: null };
    writeTrip(P, slug, { trip: withCoverPosition(trip, cover, position), annotations: merged });
  };

  const result = { publish: false };
  await runTui({
    mode: 'annotate',
    title: trip.title || slug,
    photos,
    initialAnn: { ...annotations },
    initialCover: trip.cover,
    initialPosition: parseCoverPosition(trip.coverPosition),
    pool: collectSpecies(P),
    cacheDir,
    stemOf: fileStem,
    persist,
    openViewer: (f) => openImage(path.join(cacheDir, `${fileStem(f)}.jpg`)),
    openBrowserPicker: (photo, initial, onUrl, onSave) =>
      pickInBrowser({ photo, cacheDir, title: trip.title || slug, initial, onUrl, onSave }),
    offerPublish,
    result,
  });

  ui.ok('Annotations saved.');
  if (result.publish) {
    await commitAndPush({ root, message: opts.publishMessage || `Annotate trip: ${trip.title || slug}` });
  } else if (offerPublish) {
    ui.info('Run `photosite preview` to review, then `photosite push` to publish.');
  }
}
