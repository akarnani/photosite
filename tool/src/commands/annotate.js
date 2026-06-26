// Guided per-photo annotation: opens each image, prompts for title/species/
// caption with species autocomplete, and lets you set the cover. Saves after
// every photo so quitting (Ctrl-C) preserves progress.
import fs from 'node:fs';
import path from 'node:path';
import prompts from 'prompts';
import { execa } from 'execa';
import pc from 'picocolors';
import * as ui from '../ui.js';
import { requireRepoRoot, paths } from '../paths.js';
import { readTrip, writeTrip, collectSpecies } from '../trips.js';
import { fileStem } from '../pipeline.js';
import { resolveSlug } from '../select.js';
import { maybePublish } from '../publish.js';

// Best-effort: open the cached fallback JPEG in the OS default viewer.
async function openInViewer(P, slug, file) {
  const img = path.join(P.cacheTripDir(slug), `${fileStem(file)}.jpg`);
  if (!fs.existsSync(img)) {
    ui.info('(no local preview cached for this photo — run add/update-trip to cache it)');
    return;
  }
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
  try {
    await execa(cmd, [img], { stdio: 'ignore', detached: true, windowsHide: true });
  } catch {
    /* viewer is a convenience, never fatal */
  }
}

export async function annotate(slugArg, opts = {}) {
  const offerPublish = opts.offerPublish !== false;
  const root = requireRepoRoot();
  const P = paths(root);
  const slug = await resolveSlug(P, slugArg);

  const { trip, photos, annotations } = readTrip(P, slug);
  if (!photos.length) ui.fail('Trip has no photos to annotate.');

  const pool = collectSpecies(P);
  const ann = { ...annotations };
  let cover = trip.cover;

  let aborted = false;
  const onCancel = () => {
    aborted = true;
    return false;
  };
  const askLocal = (q) => prompts(q, { onCancel });

  const save = () => {
    const merged = {};
    for (const ph of photos) merged[ph.file] = ann[ph.file] ?? { title: null, species: [], caption: null };
    writeTrip(P, slug, { trip: { ...trip, cover }, annotations: merged });
  };

  ui.heading(`Annotate: ${trip.title || slug} — ${photos.length} photos`);
  ui.info('Enter keeps the current value. Ctrl-C / Esc saves progress and exits.');

  for (let i = 0; i < photos.length; i++) {
    const p = photos[i];
    const cur = ann[p.file] ?? { title: null, species: [], caption: null };

    ui.heading(`[${i + 1}/${photos.length}] ${p.file}${cover === p.file ? pc.cyan(' (cover)') : ''}`);
    await openInViewer(P, slug, p.file);
    if (cur.title || cur.caption || (cur.species || []).length) {
      ui.info(
        `current → title: ${cur.title || '—'} | species: ${(cur.species || []).join(', ') || '—'} | caption: ${
          cur.caption || '—'
        }`,
      );
    }

    const t = await askLocal({ type: 'text', name: 'v', message: 'Title', initial: cur.title || '' });
    if (aborted) break;

    const species = await promptSpecies(askLocal, pool, cur.species || [], () => aborted);
    if (aborted) break;

    const c = await askLocal({ type: 'text', name: 'v', message: 'Caption', initial: cur.caption || '' });
    if (aborted) break;

    ann[p.file] = {
      title: (t.v || '').trim() || null,
      species,
      caption: (c.v || '').trim() || null,
    };

    if (cover !== p.file) {
      const mk = await askLocal({ type: 'confirm', name: 'v', message: 'Make this the cover photo?', initial: false });
      if (aborted) break;
      if (mk.v) cover = p.file;
    }

    save();
    ui.ok(`saved ${p.file}`);
  }

  save();
  if (aborted) {
    ui.info('\nStopped — progress saved.');
    return;
  }

  ui.ok('\nAll photos annotated.');
  ui.info('Tip: run `photosite preview` to review before publishing.');
  if (offerPublish) await maybePublish({ root, upload: true, message: `Annotate trip: ${trip.title || slug}` });
}

// Repeatedly autocomplete species from the global pool; allow adding new names;
// a "✓ done" sentinel ends the list. Mutates `pool` so new names autocomplete next.
async function promptSpecies(askLocal, pool, current, isAborted) {
  const chosen = [...current];
  for (;;) {
    const res = await askLocal({
      type: 'autocomplete',
      name: 'sp',
      message: chosen.length ? `Species [${chosen.join(', ')}] — add more or ✓ done` : 'Species — type to search/add, or ✓ done',
      limit: 8,
      choices: [{ title: '✓ done', value: '__done__' }, ...pool.map((s) => ({ title: s, value: s }))],
      suggest: async (input, choices) => {
        const v = input.trim();
        const lower = v.toLowerCase();
        const filtered = choices.filter((c) => c.value === '__done__' || c.title.toLowerCase().includes(lower));
        if (v && !pool.some((s) => s.toLowerCase() === lower)) {
          filtered.push({ title: `＋ add "${v}"`, value: v });
        }
        return filtered;
      },
    });
    if (isAborted()) return chosen;
    const sp = res.sp;
    if (sp === undefined || sp === '__done__' || sp === '') break;
    if (!chosen.includes(sp)) chosen.push(sp);
    if (!pool.includes(sp)) pool.push(sp);
  }
  return chosen;
}
