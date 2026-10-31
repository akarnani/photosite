// Local-only HTTP server behind `photosite favorites`: serves the comparison
// page, a tiny JSON API over the engine, and photo images (local derivative
// cache first, 302 to R2 on a miss — same idea as the dev middleware, §6).
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as engine from '../../../site/src/lib/favoritesEngine.js';

const PAGE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'page.html');
const TYPES = { '.webp': 'image/webp', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg' };

// Winners sorted oldest-first, with their trip. Undated photos sort last.
export function results(session, catalog) {
  return engine
    .winners(session)
    .map((id) => catalog.get(id))
    .filter(Boolean)
    .sort((x, y) => (x.date || '9999').localeCompare(y.date || '9999'));
}

const csvCell = (v) => {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function toCsv(rows) {
  const head = ['date', 'trip', 'trip_slug', 'file', 'title', 'caption'];
  const lines = rows.map((p) => [p.date, p.tripTitle, p.slug, p.file, p.title, p.caption].map(csvCell).join(','));
  return [head.join(','), ...lines].join('\n') + '\n';
}

// catalog: Map id → photo info (see commands/favorites.js). load/save persist
// the session; onDone fires once each time the session becomes finished.
export function createServer({ catalog, load, save, onDone }) {
  const view = (id) => {
    const p = catalog.get(id);
    return { id, slug: p.slug, file: p.file, trip: p.tripTitle, date: p.date, title: p.title, caption: p.caption, ratio: p.ratio, src: p.src };
  };

  const snapshot = (error) => {
    const session = load();
    const d = engine.derive(session);
    const pair = engine.nextPair(session, d);
    return {
      error: error || null,
      count: session.count,
      lives: session.lives,
      progress: engine.progress(session, d),
      canUndo: session.history.length > 0,
      pair: pair && pair.map(view),
      prefetch: engine.upcomingPairs(session).flat().map((id) => catalog.get(id).src),
      results: pair ? null : results(session, catalog).map((p) => view(p.id)),
    };
  };

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

  const serveImage = (res, id) => {
    const p = catalog.get(id);
    if (!p) return json(res, 404, { error: 'unknown photo' });
    const local = p.localFiles.find((f) => fs.existsSync(f));
    if (local) {
      res.writeHead(200, {
        'Content-Type': TYPES[path.extname(local).toLowerCase()] || 'application/octet-stream',
        'Cache-Control': 'max-age=3600',
      });
      fs.createReadStream(local).pipe(res);
    } else if (p.remote) {
      res.writeHead(302, { Location: p.remote });
      res.end();
    } else json(res, 404, { error: 'no image' });
  };

  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    try {
      if (req.method === 'GET' && url.pathname === '/') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
        return fs.createReadStream(PAGE).pipe(res);
      }
      if (req.method === 'GET' && url.pathname === '/api/state') return json(res, 200, snapshot());
      if (req.method === 'GET' && url.pathname.startsWith('/img/')) {
        return serveImage(res, decodeURIComponent(url.pathname.slice('/img/'.length)));
      }
      if (req.method === 'GET' && url.pathname === '/favorites.csv') {
        res.writeHead(200, {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': 'attachment; filename="favorites.csv"',
        });
        return res.end(toCsv(results(load(), catalog)));
      }
      if (req.method === 'POST' && url.pathname === '/api/decide') {
        const { a, b, result } = await readBody(req);
        const session = load();
        const err = engine.checkDecision(session, { a, b, result });
        if (err) return json(res, 409, snapshot(err));
        const next = engine.decide(session, { a, b, result });
        save(next);
        if (engine.isDone(next)) onDone?.(next);
        return json(res, 200, snapshot());
      }
      if (req.method === 'POST' && url.pathname === '/api/undo') {
        const session = load();
        if (session.history.length) save(engine.undo(session));
        return json(res, 200, snapshot());
      }
      json(res, 404, { error: 'not found' });
    } catch (e) {
      json(res, 500, { error: e.message });
    }
  });
}
