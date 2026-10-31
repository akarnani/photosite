// Branded link-preview card for the home page, prerendered to dist/og/home.jpg.
import { getTrips, coverPhoto, siteConfig } from '../../lib/trips.js';
import { renderCard, homeCard } from '../../lib/ogCard.js';

export async function GET() {
  const trips = getTrips();
  const body = await renderCard(homeCard(trips, trips[0] ? coverPhoto(trips[0]) : null, siteConfig()));
  return new Response(body, { headers: { 'Content-Type': 'image/jpeg' } });
}
