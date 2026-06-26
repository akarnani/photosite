// List trips with title, photo count, location, dates, and slug.
import pc from 'picocolors';
import * as ui from '../ui.js';
import { requireRepoRoot, paths } from '../paths.js';
import { listTripSlugs, readTrip } from '../trips.js';

export async function list() {
  const root = requireRepoRoot();
  const P = paths(root);
  const slugs = listTripSlugs(P);

  if (!slugs.length) {
    ui.info('No trips yet. Run `photosite add-trip` to create one.');
    return;
  }

  for (const slug of slugs) {
    const { trip, photos } = readTrip(P, slug);
    console.log(`${pc.bold(trip.title || slug)}  ${pc.dim(`· ${photos.length} photos`)}`);
    console.log(`  ${trip.location?.name || '—'} · ${trip.dates || '—'} · ${pc.cyan(slug)}`);
  }
}
