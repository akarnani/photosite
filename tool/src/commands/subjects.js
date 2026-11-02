// Group every photo by subject with a local CLIP model (see src/subjects.js),
// for `favorites --by-subject` and the site's "by subject" game. Writes
// site/src/content/subjects.json; commit it (`photosite push`) to publish.
import pc from 'picocolors';
import * as ui from '../ui.js';
import { requireRepoRoot, paths } from '../paths.js';
import { listTripSlugs, readTrip } from '../trips.js';
import * as sub from '../subjects.js';

export async function subjects(opts) {
  const root = requireRepoRoot();
  const P = paths(root);
  const slugs = listTripSlugs(P);
  if (!slugs.length) ui.fail('No trips exist yet. Run `photosite add-trip` first.');

  const minSize = Number(opts.min ?? 3);
  if (!Number.isInteger(minSize) || minSize < 1) ui.fail('--min must be a positive whole number');

  const items = [];
  const named = new Map(); // id → your own species from annotations.yaml
  for (const slug of slugs) {
    const { photos, annotations } = readTrip(P, slug);
    for (const p of photos) {
      const id = `${slug}/${p.file}`;
      items.push({ id, source: sub.photoSource(P, slug, p) });
      const species = [].concat(annotations[p.file]?.species || []).filter(Boolean);
      if (species.length) named.set(id, String(species[0]));
    }
  }
  const remote = items.filter((it) => !it.source.local).length;

  const modelId = opts.model || sub.DEFAULT_MODEL;
  ui.step(
    sub.modelCached(P, modelId)
      ? `Loading ${ui.value(modelId)}`
      : `Downloading ${ui.value(modelId)} (one time, a few hundred MB — runs offline after this)`,
  );
  const model = await sub.loadModel(P, modelId);

  ui.step(
    `Looking at ${items.length} photos` +
      (remote ? pc.dim(` (${remote} not in .image-cache — fetching those from R2)`) : ''),
  );
  const tty = process.stdout.isTTY;
  const started = Date.now();
  const { vectors, embedded, failed } = await sub.embedPhotos(P, model, items, {
    onProgress: (done, total) => {
      if (!tty) return;
      const secs = (Date.now() - started) / 1000;
      const eta = Math.round((secs / done) * (total - done));
      process.stdout.write(`\r  ${done}/${total} ${pc.dim(`~${eta}s left`)}   `);
    },
  });
  if (tty && embedded + failed.length) process.stdout.write('\n');
  ui.ok(`${embedded} new, ${items.length - embedded - failed.length} cached`);
  for (const f of failed) ui.warn(`Skipped ${f.id}: ${f.error}`);

  const labels = await sub.labelVectors(model);
  const photos = items
    .filter((it) => vectors.has(it.id))
    .map((it) => ({ id: it.id, vec: vectors.get(it.id), name: named.get(it.id) }));
  const groups = sub.groupBySubject(photos, labels, { minSize });
  sub.writeSubjects(P, modelId, groups);

  ui.heading(`${groups.length} subjects`);
  const w = Math.max(...groups.map((g) => g.name.length));
  for (const g of groups) console.log(`  ${g.name.padEnd(w)}  ${pc.dim(String(g.ids.length).padStart(4))}`);
  ui.ok(`Wrote ${ui.value('site/src/content/subjects.json')} — play with ${ui.value('photosite favorites --by-subject')}`);
  ui.info(
    'Wrong subject? Set its species in `photosite annotate` and re-run (fast — photos are cached).\n' +
      'Commit the file (`photosite push`) to use subjects on the site.',
  );
}
