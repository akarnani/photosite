import { defineConfig } from 'astro/config';
import localImages from './src/integrations/local-images.mjs';

// Static output. The local-images integration is dev-only (see DESIGN.md §6);
// production builds reference R2 directly and never include the cache.
export default defineConfig({
  // Canonical origin — needed for absolute og:url / og:image in link previews.
  site: 'https://photos.karnani.io',
  build: { format: 'directory' },
  // Astro 7 defaults to JSX-style whitespace collapsing, which drops the
  // space between text and an inline element on the next line (footer links,
  // "Seed <code>"). Keep the pre-7 behavior.
  compressHTML: true,
  integrations: [localImages()],
});
