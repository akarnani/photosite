// Branded link-preview card per trip, prerendered to dist/og/trips/<slug>.jpg.
import { getTrips, coverPhoto, siteConfig } from '../../../lib/trips.js';
import { renderCard, tripCard } from '../../../lib/ogCard.js';

export function getStaticPaths() {
  return getTrips().map((trip) => ({ params: { slug: trip.slug }, props: { trip } }));
}

export async function GET({ props }) {
  const { trip } = props;
  const body = await renderCard(tripCard(trip, coverPhoto(trip), siteConfig()));
  return new Response(body, { headers: { 'Content-Type': 'image/jpeg' } });
}
