// Dev-only Astro integration: serve processed image derivatives from the
// gitignored local cache at /local-images/<slug>/<key>, so trips render before
// (or without) any R2 upload. On a cache miss, 302-redirect to the real R2 URL
// so trips that exist only in R2 still load. Inactive in production builds.
import fs from 'node:fs';
import path from 'node:path';

const TYPES = { '.webp': 'image/webp', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg' };

export default function localImages() {
  return {
    name: 'photosite:local-images',
    hooks: {
      'astro:server:setup': ({ server, logger }) => {
        const cacheDir = path.resolve(process.cwd(), '.image-cache');

        // Read the R2 base URL (for the redirect fallback) without adding a TOML
        // dependency to the site — a tiny regex is enough.
        let base = '';
        try {
          const toml = fs.readFileSync(path.resolve(process.cwd(), '..', 'photosite.config.toml'), 'utf8');
          base = (toml.match(/publicBaseUrl\s*=\s*["']([^"']+)["']/) || [])[1] || '';
          base = base.replace(/\/+$/, '');
        } catch {
          /* config optional in dev */
        }

        logger.info(`serving local image cache from ${cacheDir}${base ? ` (miss → ${base})` : ''}`);

        server.middlewares.use('/local-images', (req, res, next) => {
          const rel = decodeURIComponent((req.url || '').split('?')[0]).replace(/^\/+/, '');
          const file = path.join(cacheDir, rel);

          // Stay within the cache dir; serve if present.
          if (file.startsWith(cacheDir) && fs.existsSync(file) && fs.statSync(file).isFile()) {
            res.setHeader('Content-Type', TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream');
            res.setHeader('Cache-Control', 'no-cache');
            fs.createReadStream(file).pipe(res);
            return;
          }

          if (base) {
            res.statusCode = 302;
            res.setHeader('Location', `${base}/${rel}`);
            res.end();
            return;
          }
          next();
        });
      },
    },
  };
}
