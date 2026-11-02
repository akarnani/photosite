// Group photos by subject with a local CLIP model — no API key, and no
// internet after the one-time model download (cached in
// site/.image-cache/.models).
//
// 1. Embed: each photo's smallest rendition (local cache, else R2) → a CLIP
//    image vector. Cached per photo in .image-cache/.subjects-embeddings.json,
//    so re-runs only embed new photos.
// 2. Name: zero-shot against SUBJECT_LABELS (src/subjectLabels.js) — each
//    photo gets its best-matching label. A species you've set in
//    annotations.yaml (`photosite annotate`) wins over the model's guess.
// 3. Group: photos sharing a label form a group; labels with too few photos
//    fold into the nearest bigger group by image similarity.
//
// Output: site/src/content/subjects.json (committed; read by the favorites
// game on the site and in the CLI). Everything model-related is imported
// lazily so other commands never load onnxruntime.
import fs from 'node:fs';
import path from 'node:path';
import { SUBJECT_LABELS } from './subjectLabels.js';

// ViT-L/14: ~400 MB download, a few minutes for ~600 photos on a laptop CPU,
// and far better at telling a nudibranch from a frogfish than the base models.
export const DEFAULT_MODEL = 'Xenova/clip-vit-large-patch14';
export const subjectsFile = (P) => path.join(P.root, 'site', 'src', 'content', 'subjects.json');
const embeddingsFile = (P) => path.join(P.cacheDir, '.subjects-embeddings.json');
const keyOf = (url) => (url ? url.replace(/^.*\//, '') : null);

// ---- Model -----------------------------------------------------------------

export async function loadModel(P, id = DEFAULT_MODEL) {
  let tf;
  try {
    tf = await import('@huggingface/transformers');
  } catch (e) {
    throw new Error(`The local AI model library isn't installed (${e.code || e.message}). Run \`npm install\` in tool/.`);
  }
  tf.env.cacheDir = path.join(P.cacheDir, '.models');
  const opts = { dtype: 'q8' };
  const [processor, vision, tokenizer, text] = await Promise.all([
    tf.AutoProcessor.from_pretrained(id),
    tf.CLIPVisionModelWithProjection.from_pretrained(id, opts),
    tf.AutoTokenizer.from_pretrained(id),
    tf.CLIPTextModelWithProjection.from_pretrained(id, opts),
  ]);
  return { id, tf, processor, vision, tokenizer, text };
}

// True once the model's files are in the local cache (no download needed).
export const modelCached = (P, id = DEFAULT_MODEL) => fs.existsSync(path.join(P.cacheDir, '.models', id));

const normalize = (v) => {
  let n = 0;
  for (const x of v) n += x * x;
  n = Math.sqrt(n) || 1;
  return Float32Array.from(v, (x) => x / n);
};

export const dot = (a, b) => {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
};

export async function embedImage(model, buffer) {
  const image = await model.tf.RawImage.fromBlob(new Blob([buffer]));
  const inputs = await model.processor(image);
  const { image_embeds } = await model.vision(inputs);
  return normalize(image_embeds.data);
}

export async function embedTexts(model, texts) {
  const inputs = model.tokenizer(texts, { padding: true, truncation: true });
  const { text_embeds } = await model.text(inputs);
  const dim = text_embeds.dims[1];
  return texts.map((_, i) => normalize(text_embeds.data.slice(i * dim, (i + 1) * dim)));
}

// ---- Photos → image bytes --------------------------------------------------

// Smallest rendition: the local derivative if cached, else fetched from R2.
export function photoSource(P, slug, photo) {
  const smallest = [...(photo.srcset || [])].sort((a, b) => a.w - b.w)[0];
  const local = [keyOf(smallest?.url), keyOf(photo.fallback)]
    .filter(Boolean)
    .map((k) => path.join(P.cacheTripDir(slug), k))
    .find((f) => fs.existsSync(f));
  return { local, remote: smallest?.url || photo.fallback || null };
}

async function readSource({ local, remote }) {
  if (local) return fs.readFileSync(local);
  if (!remote) throw new Error('no local file or remote URL');
  const res = await fetch(remote);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${remote}`);
  return Buffer.from(await res.arrayBuffer());
}

// ---- Embedding cache -------------------------------------------------------

const toB64 = (v) => Buffer.from(v.buffer, v.byteOffset, v.byteLength).toString('base64');
const fromB64 = (s) => {
  const b = Buffer.from(s, 'base64');
  return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
};

function loadEmbeddings(P, id) {
  try {
    const j = JSON.parse(fs.readFileSync(embeddingsFile(P), 'utf8'));
    if (j.model !== id) return new Map();
    return new Map(Object.entries(j.vectors).map(([id, s]) => [id, fromB64(s)]));
  } catch {
    return new Map();
  }
}

function saveEmbeddings(P, id, vectors) {
  fs.mkdirSync(P.cacheDir, { recursive: true });
  const out = { model: id, vectors: Object.fromEntries([...vectors].map(([id, v]) => [id, toB64(v)])) };
  fs.writeFileSync(embeddingsFile(P), JSON.stringify(out));
}

// Embed every photo in `items` ([{ id, source }]) not already cached.
// onProgress(done, total, id, error?) is called after each one.
export async function embedPhotos(P, model, items, { onProgress } = {}) {
  const vectors = loadEmbeddings(P, model.id);
  const todo = items.filter((it) => !vectors.has(it.id));
  let done = 0;
  const failed = [];
  for (const it of todo) {
    try {
      vectors.set(it.id, await embedImage(model, await readSource(it.source)));
    } catch (e) {
      failed.push({ id: it.id, error: e.message });
    }
    done++;
    onProgress?.(done, todo.length, it.id);
    if (done % 50 === 0) saveEmbeddings(P, model.id, vectors);
  }
  saveEmbeddings(P, model.id, vectors);
  return { vectors, embedded: todo.length - failed.length, failed };
}

// ---- Grouping (pure) -------------------------------------------------------

// photos: [{ id, vec, name? }], labels: [{ name, vec }] → [{ name, ids }]
// (biggest first). Each photo takes its `name` if given (your own species),
// else its best label; a group with fewer than `minSize` photos folds into
// the group whose centroid is most similar to each of its photos.
export function groupBySubject(photos, labels, { minSize = 3 } = {}) {
  const byLabel = new Map();
  for (const p of photos) {
    let best = 0;
    let bestSim = -Infinity;
    labels.forEach((l, i) => {
      const s = dot(p.vec, l.vec);
      if (s > bestSim) (best = i), (bestSim = s);
    });
    const name = p.name || labels[best].name;
    if (!byLabel.has(name)) byLabel.set(name, []);
    byLabel.get(name).push(p);
  }
  const centroid = (members) => {
    const c = new Float32Array(members[0].vec.length);
    for (const m of members) for (let i = 0; i < c.length; i++) c[i] += m.vec[i];
    return normalize(c);
  };
  let big = [...byLabel].filter(([, m]) => m.length >= minSize);
  const small = [...byLabel].filter(([, m]) => m.length < minSize).flatMap(([, m]) => m);
  if (!big.length) return [{ name: 'All photos', ids: photos.map((p) => p.id).sort() }];
  const centroids = big.map(([, m]) => centroid(m));
  for (const p of small) {
    let best = 0;
    centroids.forEach((c, i) => {
      if (dot(p.vec, c) > dot(p.vec, centroids[best])) best = i;
    });
    big[best][1].push(p);
  }
  return big
    .map(([name, m]) => ({ name, ids: m.map((p) => p.id).sort() }))
    .sort((a, b) => b.ids.length - a.ids.length || a.name.localeCompare(b.name));
}

// Each label's prompts are averaged (prompt ensembling beats any single one).
export async function labelVectors(model, labels = SUBJECT_LABELS) {
  return Promise.all(
    labels.map(async (l) => {
      const vecs = await embedTexts(model, l.prompts);
      const c = new Float32Array(vecs[0].length);
      for (const v of vecs) for (let i = 0; i < c.length; i++) c[i] += v[i];
      return { name: l.name, vec: normalize(c) };
    }),
  );
}

export function writeSubjects(P, model, groups) {
  const out = { model, generated: new Date().toISOString().slice(0, 10), groups };
  fs.writeFileSync(subjectsFile(P), JSON.stringify(out, null, 2) + '\n');
}

export function readSubjects(P) {
  try {
    return JSON.parse(fs.readFileSync(subjectsFile(P), 'utf8'));
  } catch {
    return null;
  }
}
