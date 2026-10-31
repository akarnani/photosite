// Branded link-preview card for each genre page, prerendered to
// dist/og/genres/<genre>.jpg.
import { coverPhoto, siteConfig, genresInUse } from '../../../lib/trips.js';
import { renderCard, genreCard } from '../../../lib/ogCard.js';

export function getStaticPaths() {
  return genresInUse().map((g) => ({ params: { genre: g.id }, props: { g } }));
}

export async function GET({ props }) {
  const { g } = props;
  const body = await renderCard(genreCard(g, coverPhoto(g.trips[0]), siteConfig()));
  return new Response(body, { headers: { 'Content-Type': 'image/jpeg' } });
}
