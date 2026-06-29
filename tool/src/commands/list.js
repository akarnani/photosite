// List trips with title, photo count, location, dates, and slug.
import pc from 'picocolors';
import * as ui from '../ui.js';
import { requireRepoRoot, paths } from '../paths.js';
import { listTripSlugs, readTrip } from '../trips.js';
import { pendingSlugs } from '../state.js';

export async function list() {
  const root = requireRepoRoot();
  const P = paths(root);
  const slugs = listTripSlugs(P);

  if (!slugs.length) {
    ui.info('No trips yet. Run `photosite add-trip` to create one.');
    return;
  }

  const pending = new Set(pendingSlugs(P));
  for (const slug of slugs) {
    const { trip, photos } = readTrip(P, slug);
    const flag = pending.has(slug) ? `  ${pc.yellow('⬆ pending upload')}` : '';
    console.log(`${pc.bold(trip.title || slug)}  ${pc.dim(`· ${photos.length} photos`)}${flag}`);
    console.log(`  ${trip.location?.name || '—'} · ${trip.dates || '—'} · ${pc.cyan(slug)}`);
  }
}
