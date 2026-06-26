// Guided per-photo annotation. For each photo: opens it in the OS viewer, then
// a species hub (autocomplete + actions), then caption and title. Defaults show
// the *effective* current value (annotation, else EXIF). Saves after every photo
// so finishing early or Ctrl-C never loses prior work.
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
const dim = (s) => pc.dim(s);
const hint = (val) => (val ? dim(`(current: ${val})`) : dim('(blank — Enter to skip)'));

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
  ui.info('Type a species then Enter to add it. Use the menu actions to set cover, skip, or finish early.');
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

    const hub = await speciesHub({
      askLocal,
      pool,
      current: curSpecies,
      isCover: () => cover === p.file,
      markCover: () => {
        cover = p.file;
        ui.ok(`cover → ${p.file}`);
      },
    });
    if (aborted) break;
    if (hub.action === 'skip') continue;
    if (hub.action === 'finish') {
      apply(p, { species: hub.species, caption: curCaption, title: curTitle });
      finished = true;
      break;
    }

    const c = await askLocal({ type: 'text', name: 'v', message: `Caption ${hint(curCaption)}`, initial: curCaption });
    if (aborted) break;
    const t = await askLocal({ type: 'text', name: 'v', message: `Title ${hint(curTitle)}`, initial: curTitle });
    if (aborted) break;

    apply(p, { species: hub.species, caption: c.v, title: t.v });
    save();
    ui.ok(`saved ${p.file}`);
  }

  save();
  if (aborted) {
    ui.info('\nStopped — progress saved.');
    return;
  }
  ui.ok(finished ? '\nFinished early — progress saved.' : '\nAll photos annotated.');
  ui.info('Tip: `photosite preview` to review, then `photosite push` to publish.');
  if (offerPublish) await maybePublish({ root, upload: true, message: `Annotate trip: ${trip.title || slug}` });
}

// Species picker + per-photo action menu. Returns { species, action } where
// action is 'next' (go to caption/title), 'skip' (leave photo unchanged), or
// 'finish' (stop after this photo). Mutates `pool` so new names autocomplete.
async function speciesHub({ askLocal, pool, current, isCover, markCover }) {
  const chosen = [...current];
  for (;;) {
    const menu = [
      { title: chosen.length ? `✓ done (species: ${chosen.join(', ')})` : '✓ done — next field', value: '__done__' },
      ...(isCover() ? [] : [{ title: '★ set as cover photo', value: '__cover__' }]),
      ...(chosen.length ? [{ title: '✗ clear species', value: '__clear__' }] : []),
      { title: '⊘ skip this photo (no change)', value: '__skip__' },
      { title: '■ finish & save (skip remaining photos)', value: '__finish__' },
    ];
    const speciesChoices = pool.map((s) => ({ title: s, value: s }));

    const res = await askLocal({
      type: 'autocomplete',
      name: 'sp',
      message: 'Species — type to add/search, or pick an action',
      limit: 10,
      choices: [...menu, ...speciesChoices],
      // When typing, surface the typed value (or matches) FIRST so Enter adds it
      // rather than landing on a menu item. Empty input shows the action menu.
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
        // Existing matches first (Enter picks the closest), add-new at the end.
        // No match (e.g. a fully-typed new name) → add-new is the only/first option.
        if (exact) return matches;
        return matches.length ? [...matches, addOpt] : [addOpt];
      },
    });

    const v = res.sp;
    if (v === undefined) return { species: chosen, action: 'next' }; // cancelled (aborted flag set by caller)
    if (v === '__done__') return { species: chosen, action: 'next' };
    if (v === '__skip__') return { species: current, action: 'skip' };
    if (v === '__finish__') return { species: chosen, action: 'finish' };
    if (v === '__clear__') {
      chosen.length = 0;
      continue;
    }
    if (v === '__cover__') {
      markCover();
      continue;
    }
    if (v && !chosen.includes(v)) chosen.push(v);
    if (v && !pool.includes(v)) pool.push(v);
  }
}
