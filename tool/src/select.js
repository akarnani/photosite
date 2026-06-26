// Resolve a trip slug from an optional argument, falling back to a select list.
import * as ui from './ui.js';
import { listTripSlugs, readTrip, tripExists } from './trips.js';

export async function resolveSlug(P, slugArg) {
  const slugs = listTripSlugs(P);
  if (!slugs.length) ui.fail('No trips exist yet. Run `photosite add-trip` first.');

  if (slugArg) {
    if (!tripExists(P, slugArg)) {
      ui.fail(`No trip "${slugArg}". Known trips: ${slugs.join(', ')}`);
    }
    return slugArg;
  }

  const { slug } = await ui.ask({
    type: 'select',
    name: 'slug',
    message: 'Select a trip',
    choices: slugs.map((s) => {
      const { trip, photos } = readTrip(P, s);
      return { title: `${trip.title || s}  (${photos.length} photos)`, value: s };
    }),
  });
  return slug;
}
