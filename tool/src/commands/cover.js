// Pick the trip cover photo from a select list.
import * as ui from '../ui.js';
import { requireRepoRoot, paths } from '../paths.js';
import { readTrip, writeTrip } from '../trips.js';
import { resolveSlug } from '../select.js';

export async function cover(slugArg) {
  const root = requireRepoRoot();
  const P = paths(root);
  const slug = await resolveSlug(P, slugArg);

  const { trip, photos } = readTrip(P, slug);
  if (!photos.length) ui.fail('Trip has no photos.');

  const { file } = await ui.ask({
    type: 'select',
    name: 'file',
    message: 'Cover photo',
    initial: Math.max(0, photos.findIndex((p) => p.file === trip.cover)),
    choices: photos.map((p) => ({
      title: p.caption ? `${p.file}  — ${p.caption}` : p.file,
      value: p.file,
    })),
  });

  writeTrip(P, slug, { trip: { ...trip, cover: file } });
  ui.ok(`cover set to ${file}`);
}
