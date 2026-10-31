import { defineConfig } from 'astro/config';
import localImages from './src/integrations/local-images.mjs';

// Static output. The local-images integration is dev-only (see DESIGN.md §6);
// production builds reference R2 directly and never include the cache.
export default defineConfig({
  // Canonical origin — needed for absolute og:url / og:image in link previews.
  site: 'https://photos.karnani.io',
  build: { format: 'directory' },
  integrations: [localImages()],
});
