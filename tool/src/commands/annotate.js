// Guided per-photo annotation. Each photo opens in the OS viewer and shows an
// action menu defaulting to Skip — so you can hammer Enter to move through
// photos — with Edit to set species/caption/title, plus set-cover and
// finish-early. Saves after every edited photo so nothing is lost.
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
  if (!fs.existsSync(img)) return;
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
  try {
    await execa(cmd, [img], { stdio: 'ignore', detached: true, windowsHide: true });
  } catch {
    /* viewer is a convenience, never fatal */
  }
}

const arraysEqual = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
const hint = (val) => (val ? pc.dim(`(current: ${val})`) : pc.dim('(blank — Enter to skip)'));

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
  const askLocal = (q) =>
    prompts(q, {
      onCancel: () => {
        aborted = true;
        return false;
      },
    });

  const save = () => {
    const merged = {};
    for (const ph of photos) merged[ph.file] = ann[ph.file] ?? { title: null, species: [], caption: null };
    writeTrip(P, slug, { trip: { ...trip, cover }, annotations: merged });
  };

  // Store an annotation, keeping it empty where it just matches EXIF (so the
  // site's EXIF fallback still applies and annotations.yaml stays lean).
  const apply = (p, { species, caption, title }) => {
    const cap = (caption || '').trim();
    ann[p.file] = {
      title: (title || '').trim() || null,
      species: arraysEqual(species, p.species || []) ? [] : species,
      caption: cap && cap !== (p.caption || '') ? cap : null,
    };
  };

  ui.heading(`Annotate: ${trip.title || slug} — ${photos.length} photos`);
  ui.info('Enter skips a photo (default). Choose Edit to set species/caption/title.');
  ui.info('Ctrl-C / Esc saves progress and exits.');

  let finished = false;
  for (let i = 0; i < photos.length; i++) {
    const p = photos[i];
    const a0 = ann[p.file] ?? {};
    const curSpecies = a0.species && a0.species.length ? a0.species : p.species || [];
    const curCaption = a0.caption ?? p.caption ?? '';
    const curTitle = a0.title ?? '';

    ui.heading(`[${i + 1}/${photos.length}] ${p.file}${cover === p.file ? pc.cyan(' ★ cover') : ''}`);
    ui.info(
      `current → species: ${curSpecies.join(', ') || '—'} | caption: ${curCaption || '—'} | title: ${curTitle || '—'}`,
    );
    await openInViewer(P, slug, p.file);

    // Per-photo menu, Skip first (Enter). Loops so "set cover" returns here.
    let advance = false;
    while (!advance) {
      const choices = [
        { title: 'Skip — leave unchanged', value: 'skip' },
        { title: 'Edit species / caption / title', value: 'edit' },
        ...(cover === p.file ? [] : [{ title: 'Set as cover photo', value: 'cover' }]),
        { title: 'Finish & save (skip remaining photos)', value: 'finish' },
      ];
      const { action } = await askLocal({ type: 'select', name: 'action', message: 'Action', choices, initial: 0 });
      if (aborted) break;

      if (action === 'cover') {
        cover = p.file;
        ui.ok(`cover → ${p.file}`);
        continue;
      }
      if (action === 'skip') {
        advance = true;
      } else if (action === 'finish') {
        finished = true;
        advance = true;
      } else if (action === 'edit') {
        const species = await editSpecies(askLocal, pool, curSpecies);
        if (aborted) break;
        const c = await askLocal({ type: 'text', name: 'v', message: `Caption ${hint(curCaption)}`, initial: curCaption });
        if (aborted) break;
        const t = await askLocal({ type: 'text', name: 'v', message: `Title ${hint(curTitle)}`, initial: curTitle });
        if (aborted) break;
        apply(p, { species, caption: c.v, title: t.v });
        save();
        ui.ok(`saved ${p.file}`);
        advance = true;
      }
    }
    if (aborted || finished) break;
  }

  save();
  if (aborted) {
    ui.info('\nStopped — progress saved.');
    return;
  }
  ui.ok(finished ? '\nFinished early — progress saved.' : '\nReached the end.');
  ui.info('Tip: `photosite preview` to review, then `photosite push` to publish.');
  if (offerPublish) await maybePublish({ root, upload: true, message: `Annotate trip: ${trip.title || slug}` });
}

// Species picker: type to add/search, pick "done" to finish. Typed values and
// matches surface first so Enter captures them; "done" is reachable on empty
// input. Mutates `pool` so newly-added names autocomplete on later photos.
async function editSpecies(askLocal, pool, current) {
  const chosen = [...current];
  for (;;) {
    const menu = [
      { title: chosen.length ? `✓ done (species: ${chosen.join(', ')})` : '✓ done — no species', value: '__done__' },
      ...(chosen.length ? [{ title: '✗ clear species', value: '__clear__' }] : []),
    ];
    const speciesChoices = pool.map((s) => ({ title: s, value: s }));

    const res = await askLocal({
      type: 'autocomplete',
      name: 'sp',
      message: 'Species — type to add/search, or ✓ done',
      limit: 10,
      choices: [...menu, ...speciesChoices],
      suggest: async (input) => {
        const v = input.trim();
        if (!v) return [...menu, ...speciesChoices];
        const lower = v.toLowerCase();
        const exact = pool.some((s) => s.toLowerCase() === lower);
        const matches = pool
          .filter((s) => s.toLowerCase().includes(lower))
          .sort((a, b) => Number(b.toLowerCase() === lower) - Number(a.toLowerCase() === lower))
          .map((s) => ({ title: s, value: s }));
        const addOpt = { title: `＋ add "${v}"`, value: v };
        if (exact) return matches;
        return matches.length ? [...matches, addOpt] : [addOpt];
      },
    });

    const v = res.sp;
    if (v === undefined || v === '__done__') break;
    if (v === '__clear__') {
      chosen.length = 0;
      continue;
    }
    if (v && !chosen.includes(v)) chosen.push(v);
    if (v && !pool.includes(v)) pool.push(v);
  }
  return chosen;
}
