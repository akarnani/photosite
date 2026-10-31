// Local-only HTTP server behind `photosite cover --position` (no value): a page
// that shows the cover in the exact frames the site crops it to (hero banner
// at several widths, link-preview card) and lets you drag it into place.
// Saving writes trip.yaml `coverPosition`. Same shape as favorites/server.js.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCoverPosition } from '../../../site/src/lib/coverPosition.js';

const PAGE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'page.html');
const TYPES = { '.webp': 'image/webp', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg' };

/**
 * @param {object} o
 * @param {object} o.info      { slug, title, file, ratio } shown on the page
 * @param {string[]} o.localFiles  cached derivatives to try, best first
 * @param {string|null} o.remote   R2 URL to 302 to on a cache miss
 * @param {() => object|null} o.current  current { x, y } (or null = centred)
 * @param {(pos: object|null) => void} o.save  persist (null clears)
 * @param {() => void} o.onDone  the page pressed "Done"
 */
export function createPositionServer({ info, localFiles, remote, current, save, onDone }) {
  const json = (res, code, body) => {
    res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(body));
  };
  const readBody = (req) =>
    new Promise((resolve, reject) => {
      let data = '';
      req.on('data', (c) => (data += c));
      req.on('end', () => {
        try {
          resolve(data ? JSON.parse(data) : {});
        } catch (e) {
          reject(e);
        }
      });
      req.on('error', reject);
    });
  const state = () => ({ ...info, position: current() });

  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    try {
      if (req.method === 'GET' && url.pathname === '/') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
        return fs.createReadStream(PAGE).pipe(res);
      }
      if (req.method === 'GET' && url.pathname === '/api/state') return json(res, 200, state());
      if (req.method === 'GET' && url.pathname === '/img') {
        const local = localFiles.find((f) => fs.existsSync(f));
        if (local) {
          res.writeHead(200, { 'Content-Type': TYPES[path.extname(local).toLowerCase()] || 'application/octet-stream' });
          return fs.createReadStream(local).pipe(res);
        }
        if (remote) {
          res.writeHead(302, { Location: remote });
          return res.end();
        }
        return json(res, 404, { error: 'no image' });
      }
      if (req.method === 'POST' && url.pathname === '/api/save') {
        const body = await readBody(req);
        if (body.clear) save(null);
        else {
          const pos = parseCoverPosition(`${Number(body.x)}% ${Number(body.y)}%`);
          if (!pos) return json(res, 400, { error: 'bad position' });
          save({ x: Math.round(pos.x), y: Math.round(pos.y) });
        }
        return json(res, 200, state());
      }
      if (req.method === 'POST' && url.pathname === '/api/done') {
        json(res, 200, { ok: true });
        return onDone();
      }
      json(res, 404, { error: 'not found' });
    } catch (e) {
      json(res, 500, { error: e.message });
    }
  });
}
