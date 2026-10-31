// Branded link-preview cards (Open Graph images), rendered at build time.
//
// A card is the cover photo cropped to 1200×630 with a scrim and the trip's
// title / location / dates set over it. Text is laid out by satori (which turns
// glyphs into SVG paths using bundled fonts, so nothing depends on fonts being
// installed on the build machine) and composited onto the photo with sharp.
//
// The cover is read from the local derivative cache when present, otherwise
// fetched from R2 over public HTTPS — so the production build still needs no
// credentials. If the photo can't be had, the card renders on a plain gradient
// rather than failing the build.
import fs from 'node:fs';
import path from 'node:path';
import satori from 'satori';
import sharp from 'sharp';
import { GENRES } from './genres.js';

export const OG_WIDTH = 1200;
export const OG_HEIGHT = 630;

// Site palette (src/styles/global.css). The accent is per card: the genre's,
// or the neutral one on mixed (home) cards.
const C = {
  ink900: '#0e0e0d',
  ink700: '#1e1d1b',
  text: '#ecebe7',
  textDim: '#9d9b95',
  accent: '#e3d2ad',
};
const accentOf = (genre) => GENRES[genre]?.accent || C.accent;
// '#rrggbb' → 'r,g,b' for rgba() strings.
const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(',');

// Resolve from process.cwd() (site/), not import.meta.url — see DESIGN.md §13.1.
const FONT_DIR = path.join(process.cwd(), 'node_modules', '@fontsource');
const CACHE_DIR = path.join(process.cwd(), '.image-cache');

let fonts;
function loadFonts() {
  if (fonts) return fonts;
  const f = (pkg, file) => fs.readFileSync(path.join(FONT_DIR, pkg, 'files', file));
  // latin + latin-ext under one name: satori falls through for missing glyphs.
  fonts = [
    { name: 'Serif', weight: 600, style: 'normal', data: f('source-serif-4', 'source-serif-4-latin-600-normal.woff') },
    { name: 'Serif', weight: 600, style: 'normal', data: f('source-serif-4', 'source-serif-4-latin-ext-600-normal.woff') },
    { name: 'Mono', weight: 500, style: 'normal', data: f('jetbrains-mono', 'jetbrains-mono-latin-500-normal.woff') },
    { name: 'Mono', weight: 500, style: 'normal', data: f('jetbrains-mono', 'jetbrains-mono-latin-ext-500-normal.woff') },
  ];
  return fonts;
}

// Cover photo bytes: local cache first, then R2. Returns null on failure.
async function loadPhoto(slug, url) {
  if (!url) return null;
  const cached = path.join(CACHE_DIR, slug, path.basename(new URL(url).pathname));
  if (fs.existsSync(cached)) return fs.readFileSync(cached);
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  } catch (err) {
    console.warn(`! og card: couldn't fetch ${url} (${err.message}) — using plain background`);
    return null;
  }
}

// Minimal element helper so we can feed satori without JSX.
const h = (type, style, ...children) => ({ type, props: { style, children } });

// Shrink the title as it gets longer so it stays on one or two lines.
function titleSize(title) {
  const n = title.length;
  if (n <= 14) return 104;
  if (n <= 22) return 88;
  if (n <= 32) return 72;
  return 60;
}

function overlay({ eyebrow, title, footerLeft, footerRight, accent = C.accent }) {
  return h(
    'div',
    {
      width: '100%',
      height: '100%',
      boxSizing: 'border-box', // satori defaults to content-box
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'flex-end',
      padding: '56px 64px',
      // Scrim: clear at the top so the photo reads, deep at the bottom for text.
      backgroundImage: `linear-gradient(180deg, rgba(14,14,13,0) 25%, rgba(14,14,13,0.62) 58%, rgba(14,14,13,0.94) 100%)`,
    },
    eyebrow &&
      h(
        'div',
        { display: 'flex', fontFamily: 'Mono', fontSize: 24, letterSpacing: 3, color: accent, textTransform: 'uppercase', marginBottom: 14, textShadow: '0 1px 6px rgba(14,14,13,0.9)' },
        eyebrow,
      ),
    h(
      'div',
      { display: 'flex', fontFamily: 'Serif', fontSize: titleSize(title), lineHeight: 1.05, color: C.text, letterSpacing: -1, textShadow: '0 2px 12px rgba(14,14,13,0.6)' },
      title,
    ),
    h(
      'div',
      {
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginTop: 30,
        paddingTop: 22,
        borderTop: `2px solid rgba(${rgb(accent)},0.45)`,
        fontFamily: 'Mono',
        fontSize: 22,
        letterSpacing: 1,
        color: C.textDim,
      },
      h('div', { display: 'flex', color: C.text }, footerLeft),
      h('div', { display: 'flex' }, footerRight),
    ),
  );
}

// Fill OG_WIDTH×OG_HEIGHT, keeping the focal point `pos` ({ x, y } in %, like
// CSS object-position) in frame.
async function focalCrop(photo, pos) {
  const { data, info } = await sharp(photo, { failOn: 'none' }).rotate().toBuffer({ resolveWithObject: true });
  const scale = Math.max(OG_WIDTH / info.width, OG_HEIGHT / info.height);
  const w = Math.max(OG_WIDTH, Math.round(info.width * scale));
  const hgt = Math.max(OG_HEIGHT, Math.round(info.height * scale));
  return sharp(data)
    .resize(w, hgt)
    .extract({
      left: Math.round(((w - OG_WIDTH) * pos.x) / 100),
      top: Math.round(((hgt - OG_HEIGHT) * pos.y) / 100),
      width: OG_WIDTH,
      height: OG_HEIGHT,
    })
    .toBuffer();
}

async function background(photo, position) {
  if (photo) {
    try {
      // A trip-set coverPosition wins; otherwise let sharp find the subject.
      if (position) return await focalCrop(photo, position);
      return await sharp(photo, { failOn: 'none' })
        .rotate()
        .resize(OG_WIDTH, OG_HEIGHT, { fit: 'cover', position: sharp.strategy.attention })
        .toBuffer();
    } catch (err) {
      console.warn(`! og card: couldn't decode cover (${err.message}) — using plain background`);
    }
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${OG_WIDTH}" height="${OG_HEIGHT}">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${C.ink700}"/><stop offset="1" stop-color="${C.ink900}"/>
    </linearGradient></defs>
    <rect width="100%" height="100%" fill="url(#g)"/></svg>`;
  return sharp(Buffer.from(svg)).toBuffer();
}

/**
 * Render a card to JPEG.
 * @param {object} o
 * @param {string} o.slug       trip slug (for the local-cache lookup)
 * @param {string} [o.photoUrl] absolute R2 URL of the cover's JPEG fallback
 * @param {{x:number,y:number}} [o.position] focal point (trip.yaml coverPosition)
 * @param {string} [o.eyebrow]  small uppercase line above the title
 * @param {string} o.title
 * @param {string} o.footerLeft
 * @param {string} o.footerRight
 * @param {string} [o.accent]   '#rrggbb' for the eyebrow + rule (genre accent)
 */
export async function renderCard({ slug, photoUrl, position, ...text }) {
  const [photo, svg] = await Promise.all([
    loadPhoto(slug, photoUrl),
    satori(overlay(text), { width: OG_WIDTH, height: OG_HEIGHT, fonts: loadFonts() }),
  ]);
  return sharp(await background(photo, position))
    .composite([{ input: Buffer.from(svg) }])
    .jpeg({ quality: 82, mozjpeg: true })
    .toBuffer();
}

// Bump when the card design changes so every cached preview image refreshes.
const DESIGN_VERSION = 2;

// Short hash of everything drawn on a card, appended to its URL as ?v=… —
// apps cache preview images by URL, so a new cover or title needs a new URL.
function version(card) {
  let h = 0;
  for (const c of JSON.stringify([DESIGN_VERSION, card])) h = (h * 31 + c.codePointAt(0)) >>> 0;
  return h.toString(36);
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

// Card spec for a trip page. `cover` is coverPhoto(trip).
export function tripCard(trip, cover, site) {
  const card = {
    slug: trip.slug,
    photoUrl: cover?.remoteFallback,
    ...(cover?.position && { position: cover.position }),
    eyebrow: [trip.location?.name, trip.dates].filter(Boolean).join(' · '),
    title: trip.title || trip.slug,
    footerLeft: site.title,
    footerRight: plural(trip.photos.length, 'photograph'),
    accent: accentOf(trip.genre),
  };
  return { ...card, path: `/og/trips/${trip.slug}.jpg?v=${version(card)}` };
}

// Card spec for the home page: the latest trip's cover under the site title.
// One genre on the site → its eyebrow and accent; several → neutral.
export function homeCard(trips, cover, site) {
  const photos = trips.reduce((n, t) => n + t.photos.length, 0);
  const genres = [...new Set(trips.map((t) => t.genre))];
  const only = genres.length === 1 ? GENRES[genres[0]] : null;
  const card = {
    slug: trips[0]?.slug,
    photoUrl: cover?.remoteFallback,
    ...(cover?.position && { position: cover.position }),
    eyebrow: only ? only.eyebrow : 'Photography',
    title: site.title,
    footerLeft: site.author && site.author !== site.title ? site.author : '',
    footerRight: `${plural(trips.length, 'trip')} · ${plural(photos, 'photograph')}`,
    accent: only ? only.accent : C.accent,
  };
  return { ...card, path: `/og/home.jpg?v=${version(card)}` };
}

// Card spec for a genre page. `g` is a genresInUse() entry (with its trips).
export function genreCard(g, cover, site) {
  const photos = g.trips.reduce((n, t) => n + t.photos.length, 0);
  const card = {
    slug: g.trips[0]?.slug,
    photoUrl: cover?.remoteFallback,
    ...(cover?.position && { position: cover.position }),
    eyebrow: g.eyebrow,
    title: g.label,
    footerLeft: site.title,
    footerRight: `${plural(g.trips.length, 'trip')} · ${plural(photos, 'photograph')}`,
    accent: g.accent,
  };
  return { ...card, path: `/og/genres/${g.id}.jpg?v=${version(card)}` };
}
