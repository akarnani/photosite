// Photo catalog for the /favorites/ picker, prerendered to
// dist/favorites/photos.json and fetched on demand (keeps the page itself light).
// Ids are "<slug>/<file>", the same as the CLI's, so a seed pairs identically
// in both.
import { getTrips } from '../../lib/trips.js';

export function GET() {
  const trips = getTrips();
  const body = {
    trips: trips.map((t) => ({ slug: t.slug, title: t.title || t.slug })),
    photos: trips.flatMap((t, ti) =>
      t.photos.map((p) => ({
        id: `${t.slug}/${p.file}`,
        trip: ti,
        anchor: p.id,
        date: p.date || null,
        title: p.title || p.species?.[0] || null,
        ratio: p.ratio || 1.5,
        srcset: (p.srcset || []).map((s) => `${s.url} ${s.w}w`).join(', '),
        src: p.fallback,
      })),
    ),
  };
  return new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
}
