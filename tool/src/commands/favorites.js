// Narrow every photo down to your N favorites (e.g. for printing) by picking
// the better of two photos, over and over, in a local browser page. Progress is
// saved after every pick (gitignored .image-cache/.favorites.json), so you can
// quit and resume. The final list is sorted chronologically with its trip.
import fs from 'node:fs';
import path from 'node:path';
import pc from 'picocolors';
import * as ui from '../ui.js';
import { requireRepoRoot, paths } from '../paths.js';
import { listTripSlugs, readTrip } from '../trips.js';
import { openUrl } from '../viewer.js';
import * as engine from '../favorites/engine.js';
import { createServer, results, toCsv } from '../favorites/server.js';

const stateFile = (P) => path.join(P.cacheDir, '.favorites.json');
const keyOf = (url) => (url ? url.replace(/^.*\//, '') : null);

// Map id ("<slug>/<file>") → everything the page and results need.
function buildCatalog(P, slugs) {
  const catalog = new Map();
  for (const slug of slugs) {
    const { trip, photos, annotations } = readTrip(P, slug);
    for (const p of photos) {
      const ann = annotations[p.file] || {};
      const largest = [...(p.srcset || [])].sort((x, y) => y.w - x.w)[0];
      const id = `${slug}/${p.file}`;
      catalog.set(id, {
        id,
        slug,
        file: p.file,
        tripTitle: trip.title || slug,
        date: p.date || null,
        title: ann.title || null,
        caption: ann.caption ?? p.caption ?? null,
        ratio: p.ratio || 1.5,
        src: `/img/${encodeURIComponent(id)}`,
        localFiles: [keyOf(largest?.url), keyOf(p.fallback)].filter(Boolean).map((k) => path.join(P.cacheTripDir(slug), k)),
        remote: largest?.url || p.fallback || null,
      });
    }
  }
  return catalog;
}

const positiveInt = (v, name) => {
  if (v === undefined) return undefined;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1) ui.fail(`--${name} must be a positive whole number`);
  return n;
};

function printResults(session, catalog) {
  const rows = results(session, catalog);
  ui.heading(`Your ${rows.length} favorites (oldest first)`);
  for (const p of rows) {
    const date = p.date ? p.date.slice(0, 10) : '—'.padEnd(10);
    const label = p.title || p.caption;
    console.log(`  ${pc.dim(date)}  ${pc.bold(p.tripTitle)}  ${pc.cyan(p.file)}${label ? pc.dim(`  ${label}`) : ''}`);
  }
  return rows;
}

export async function favorites(opts) {
  const root = requireRepoRoot();
  const P = paths(root);
  const file = stateFile(P);
  const allSlugs = listTripSlugs(P);
  if (!allSlugs.length) ui.fail('No trips exist yet. Run `photosite add-trip` first.');

  const count = positiveInt(opts.count, 'count');
  const lives = positiveInt(opts.lives, 'lives');

  let session = !opts.reset && fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
  const catalog = buildCatalog(P, allSlugs);

  if (session) {
    // Drop photos whose trip/file has since disappeared.
    session.ids = session.ids.filter((id) => catalog.has(id));
    if (count) session.count = count;
    if (lives) session.lives = lives;
  }

  if (opts.results) {
    if (!session) ui.fail('No favorites session yet. Run `photosite favorites` to start one.');
    if (!engine.isDone(session)) ui.warn('Session not finished yet — showing the photos still in the running.');
    printResults(session, catalog);
    return;
  }

  if (session) {
    const pr = engine.progress(session);
    ui.step(
      `Resuming: ${pr.decisions} picks so far, ${pr.alive} of ${pr.total} photos still in, top ${session.count}, ${session.lives} lives each ` +
        pc.dim('(--reset to start over)'),
    );
  } else {
    let slugs = allSlugs;
    if (opts.trips) {
      slugs = opts.trips.split(',').map((s) => s.trim()).filter(Boolean);
      const unknown = slugs.filter((s) => !allSlugs.includes(s));
      if (unknown.length) ui.fail(`Unknown trip(s): ${unknown.join(', ')}. Known trips: ${allSlugs.join(', ')}`);
    } else if (process.stdin.isTTY) {
      ({ slugs } = await ui.ask({
        type: 'multiselect',
        name: 'slugs',
        message: 'Trips to include',
        instructions: false,
        hint: 'space to toggle, a for all, enter to confirm',
        min: 1,
        choices: allSlugs.map((s) => {
          const { trip, photos } = readTrip(P, s);
          return { title: `${trip.title || s}  (${photos.length} photos)`, value: s, selected: true };
        }),
      }));
    }
    let n = count;
    if (!n && process.stdin.isTTY) {
      ({ n } = await ui.ask({ type: 'number', name: 'n', message: 'How many favorites?', initial: 20, min: 1 }));
    }
    const ids = [...catalog.keys()].filter((id) => slugs.includes(id.split('/')[0]));
    if (!ids.length) ui.fail('Those trips have no photos.');
    session = engine.newSession(ids, { count: n || 20, lives: lives || 2 });
    ui.step(`Starting: ${ids.length} photos → top ${session.count}, ${session.lives} lives each`);
  }

  const save = (s) => {
    session = s;
    fs.mkdirSync(P.cacheDir, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(s) + '\n');
  };
  save(session);

  const finish = () => {
    if (engine.isDone(session)) {
      const rows = printResults(session, catalog);
      if (opts.out) {
        fs.writeFileSync(opts.out, toCsv(rows));
        ui.ok(`wrote ${opts.out}`);
      }
    } else {
      const pr = engine.progress(session);
      ui.ok(`Saved: ${pr.alive} photos still in, roughly ${pr.remaining} more pick${pr.remaining === 1 ? "" : "s"}. Run again to resume.`);
    }
  };

  const server = createServer({
    catalog,
    load: () => session,
    save,
    onDone: () => ui.ok('Done! The results are on the page. Press Ctrl-C here to exit.'),
  });

  const port = positiveInt(opts.port, 'port') ?? 4519;
  await new Promise((resolve) => {
    server.once('error', (e) => {
      if (e.code !== 'EADDRINUSE') ui.fail(e.message);
      server.listen(0, '127.0.0.1', resolve); // preferred port taken: any free one
    });
    server.listen(port, '127.0.0.1', resolve);
  });
  const url = `http://localhost:${server.address().port}/`;
  ui.ok(`Open ${ui.value(url)}  ${pc.dim('(Ctrl-C to stop — progress is saved after every pick)')}`);
  if (opts.open !== false) openUrl(url);

  await new Promise((resolve) => process.once('SIGINT', resolve));
  console.log();
  server.close();
  finish();
  process.exit(0);
}
