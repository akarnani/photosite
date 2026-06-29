// Shared, prompt-free "create one trip from a folder": process images and write
// trip.yaml / photos.json / annotations.yaml. Used by both add-trip and add-trips.
import { ingestFolder, centroid } from './ingest.js';
import { writeTrip, stubAnnotations } from './trips.js';

export async function createTrip({ cfg, paths, slug, title, folder, locationName, dates, summary, upload, meta }) {
  const records = await ingestFolder({ folder, cfg, slug, paths, upload, meta });
  const center = centroid(records);
  const name = locationName || '';
  const trip = {
    title,
    slug,
    location: center ? { name, lat: center.lat, lon: center.lon } : { name },
    dates: dates || '',
    summary: summary || '',
    cover: records[0]?.file ?? null,
  };
  writeTrip(paths, slug, { trip, photos: records, annotations: stubAnnotations(records) });
  return { slug, count: records.length };
}
