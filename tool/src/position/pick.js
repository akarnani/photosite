// Run the browser cover-position picker (server.js + page.html) until the page
// presses Done. Used by `photosite cover --position` and the TUI's `b` key.
import path from 'node:path';
import { createPositionServer } from './server.js';
import { openUrl } from '../viewer.js';

const keyOf = (url) => (url ? url.replace(/^.*\//, '') : null);

/**
 * @param {object} o
 * @param {object} o.photo     photos.json record of the cover
 * @param {string} o.cacheDir  .image-cache/<slug>
 * @param {string} o.title     trip title (page heading)
 * @param {{x,y}|null} o.initial
 * @param {(pos:{x,y}|null) => void} o.onSave  each Save on the page
 * @param {(url:string) => void} [o.onUrl]     the page's URL once listening
 * @param {number} [o.port]
 * @param {boolean} [o.open=true]  open the default browser
 * @returns {Promise<{x,y}|null|undefined>} last saved position (undefined: none saved)
 */
export async function pickInBrowser({ photo, cacheDir, title, initial, onSave, onUrl, port = 4520, open = true }) {
  const largest = [...(photo.srcset || [])].sort((a, b) => b.w - a.w)[0];
  let current = initial || null;
  let saved;
  let finish;
  const done = new Promise((resolve) => (finish = resolve));

  const server = createPositionServer({
    info: { title, file: photo.file, ratio: photo.ratio || (photo.width && photo.height ? photo.width / photo.height : 1.5) },
    localFiles: [keyOf(largest?.url), keyOf(photo.fallback)].filter(Boolean).map((k) => path.join(cacheDir, k)),
    remote: largest?.url || photo.fallback || null,
    current: () => current,
    save: (pos) => {
      current = pos;
      saved = pos;
      onSave?.(pos);
    },
    onDone: () => finish(),
  });

  await new Promise((resolve, reject) => {
    server.once('error', (e) => {
      if (e.code !== 'EADDRINUSE') return reject(e);
      server.listen(0, '127.0.0.1', resolve); // preferred port taken: any free one
    });
    server.listen(port, '127.0.0.1', resolve);
  });
  const url = `http://localhost:${server.address().port}/`;
  onUrl?.(url);
  if (open) openUrl(url);

  await done;
  server.close();
  server.closeAllConnections?.();
  return saved;
}
