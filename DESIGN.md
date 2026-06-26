# Underwater Photography Portfolio — Design & Implementation Plan

A static photography portfolio site plus a local CLI that manages it. The site is
a quiet, images-first gallery; the CLI is the only way photos get in. This
document is the source of truth for intent and contracts and is written to be
implemented from scratch.

The subject is **underwater / dive photography** ("Below the Surface"). The theme
is leaned into in default copy and palette, but all visual tokens live at the top
of `global.css` and are meant to be edited.

---

## 1. Goals and non-goals

**Goals**
- Cheap to run (target: $0/month plus a domain) and low-maintenance.
- Mostly static. No server, no database, no CMS, no upload UI.
- Photos are grouped by **trip**.
- A **map** shows where photos were taken, derived from photo GPS EXIF.
- Per-photo **annotations** (species, a memory/caption, title) are easy to add via
  a guided CLI workflow — not by hand-editing YAML unless you want to.
- Adding/updating photos is a **scripted CLI workflow**, not a web UI.
- You can **preview the whole site locally before any photo is uploaded** to R2.
- The site looks good on phone, tablet, small laptop, and full monitor.

**Non-goals (out of scope for v1)**
- User accounts, comments, e-commerce, search.
- In-browser uploading or editing.
- Serving original/RAW files (only web-optimized derivatives are published).
- Cloudflare resource automation — bucket/token/domain are created by hand in the
  dashboard, documented in the README. The wizard records values; it does not call
  the Cloudflare API.

---

## 2. Architecture decisions and rationale

Implement these as written; the rationale explains why, so don't substitute
equivalents without reason.

| Decision | Choice | Why |
|---|---|---|
| Hosting | **Cloudflare Pages** (free tier) | No bandwidth caps even on free tier — critical for an image-heavy site. Netlify/GitHub Pages/Vercel free tiers cap bandwidth (~100GB/mo). |
| Image storage | **Cloudflare R2** | Keeps large binaries out of git so the repo never hits GitHub size limits (recommended <1GB, ~5GB soft cap; 100MB per-file hard block). R2 free tier: 10GB storage, zero egress fees. |
| Static generator | **Astro** | Content-collection-friendly, first-class image handling, JS ecosystem makes EXIF + map glue trivial. |
| Map | **Leaflet** + CARTO dark basemap | No API key, free tiles, fits a dark gallery. Build points from photo GPS. |
| Uploads + secrets | **rclone** (S3-compatible) | No custom upload code; rclone stores R2 credentials in its own config, keeping secrets out of the repo. |
| Metadata | **exiftool** | Reliable EXIF/IPTC/XMP extraction including Lightroom/Capture One hierarchical keywords that lightweight JS EXIF libs miss. |
| Image processing | **sharp** | Fast, generates responsive widths + WebP + JPEG fallback + blur placeholder. |
| Local preview | **gitignored derivative cache + Astro dev middleware** | Lets the site render before (or without) any R2 upload; production builds never see it. See §6. |
| Repo layout | **Monorepo**, one repo | Tool and site are coupled through the metadata schema; schema changes are one atomic commit. Avoids cross-repo write/version-sync pain. |
| Tool packaging | Node CLI, installed on PATH via `npm link` | Same language as the site (one toolchain, shared schema). A compiled binary is optional future polish, not the foundation. |
| Photo editor | **Capture One** | Default workflow. Export web JPEGs via a Process Recipe; species verified out of hierarchical keywords (see §11). |

**Repo structure**

```
photosite/
  DESIGN.md                  # this document
  photosite.config.toml      # committed, non-secret project config
  README.md                  # user-facing setup/deploy steps
  justfile                   # convenience wrappers (optional)
  .gitignore
  .env.example               # placeholder; real .env is gitignored
  .githooks/pre-commit       # gitleaks secret scan (opt-in)
  tool/                      # the CLI — LOCAL ONLY, never deployed
    package.json             # its own dependency set
    bin/photosite.js
    src/...
  site/                      # the Astro site — Cloudflare Pages builds THIS
    package.json             # its own dependency set
    astro.config.mjs
    .image-cache/            # gitignored local derivative cache (see §6)
    src/...
    src/content/trips/<slug>/{trip.yaml, photos.json, annotations.yaml}
```

Cloudflare Pages **root directory is `site/`**, so the build only ever sees the
site's dependency closure; the tool's deps never touch the deploy. Keep the two
`package.json` files as independent dependency sets — do **not** use a hoisted
workspace, so the Pages build stays lean.

---

## 3. Configuration and secrets model

Three tiers:

1. **Committed, non-secret** → `photosite.config.toml`. Identical for anyone who
   clones. Bucket names and public URLs are not secrets (they appear in shipped
   HTML).
2. **Secret** → R2 access key id + secret. Stored **only** inside the rclone
   remote (`~/.config/rclone/rclone.conf`). Never written to the repo.
3. **Future build-time secret** (none needed in v1) → Cloudflare Pages encrypted
   env vars, or a gitignored `.env`.

The Cloudflare build needs **zero credentials**: it pulls a git repo and reads
images from R2 over public HTTPS. The only machine holding a real credential is
the user's own.

**Guardrails to implement**
- `.gitignore` excludes `.env`, `.env.local`, `secrets*`, `*.local.*`,
  `node_modules/`, `site/dist/`, `site/.astro/`, and **`site/.image-cache/`**.
- `.env.example` with placeholders (documents any future secret).
- `.githooks/pre-commit` runs `gitleaks protect --staged` if gitleaks is
  installed (no-op with a friendly message if not). Enabled via
  `git config core.hooksPath .githooks`.
- Setup instructions must tell the user to create an **R2 token scoped to the
  one bucket**, object read/write only — not an account-wide key.

---

## 4. CLI tool specification

Binary name: `photosite`. Node ≥18, ESM. Deps: `commander` (commands),
`prompts` (interactive), `execa` (shell out to rclone/exiftool), `sharp`,
`js-yaml`, `smol-toml`, `picocolors`.

All commands resolve the repo root by walking up from cwd to find
`photosite.config.toml` (except `setup`, which tolerates its absence).

**Cross-cutting UX conventions**
- Friendly colored status lines: `→` step, `✓` ok, `!` warn, `✗` error.
- Cancelling a prompt (Ctrl-C / Esc) exits cleanly with no partial writes.
- Any command that takes a `<slug>` makes it optional: if omitted, show a
  `prompts` **select list** of existing trips (title + slug) instead of erroring.
- Every interactive prompt pre-fills from current state where one exists.

### `photosite setup`
Re-runnable configuration wizard. Records values and writes the rclone remote; it
does **not** create Cloudflare resources (those are manual — see README/§12).
1. Check `rclone` and `exiftool` are installed; warn with install URLs if not
   (don't hard-fail — user may configure before installing).
2. Load existing config if present; pre-fill every prompt with current values.
   If the rclone remote already exists, read back its non-secret fields
   (e.g. endpoint → account id) to pre-fill.
3. Prompt for: site title; public image base URL (validate http/https); rclone
   remote name; bucket; Cloudflare account id; R2 access key id (password
   field); R2 secret (password field).
4. Write/update the rclone remote (see §8). On re-run, **blank key/secret means
   keep existing** — do not overwrite credentials with empties.
5. Optionally tune image widths/quality (default: keep current).
6. Prompt whether species come from Capture One hierarchical keywords, and if so
   the species root keyword (default `Species`). Default `speciesFromKeywords =
   false` until the user verifies the hierarchy survives export (§11).
7. Save `photosite.config.toml`. Never write secrets to it.

### `photosite add-trip`
Flags (all optional, fall back to prompts): `--name`, `--location`, `--dates`,
`--from`, `--no-upload`. Behavior:
1. Require rclone + exiftool (hard-fail if missing) — unless `--no-upload`, where
   rclone is not required.
2. Prompt for trip name, location, dates, short intro, and source photo folder
   (validate folder exists).
3. Derive `slug` from name. If a trip with that slug already exists, fail and
   point at `update-trip`.
4. List source images in the folder; fail if none.
5. Run the pipeline (§5) → photo records. This always writes the local derivative
   cache (§6).
6. Upload variants to R2 — **unless `--no-upload`** (process + cache only, for a
   pure-local preview).
7. Write `trip.yaml` (cover defaults to the newest photo), `photos.json`, and stub
   `annotations.yaml` (§7).
8. Offer to launch `annotate` now (y/N).
9. Offer to **commit & push** (see "Publishing" below) — suppressed if
   `--no-upload`, since R2 wouldn't yet hold the images the deploy would request.

### `photosite update-trip [slug] --from <folder>`
Flags: `--from` (prompt if absent), `--prune`, `--no-upload`. Behavior:
1. Require the trip to exist; require rclone + exiftool (rclone optional under
   `--no-upload`).
2. List source images; reprocess the whole folder, refresh the local cache, and
   re-upload (rclone `--checksum` makes unchanged uploads cheap). This makes
   update idempotent and keeps the bucket matched to the folder.
3. Determine **orphaned** remote objects: keys under `<slug>/` whose stem has no
   matching local file. If any and `--prune` (or interactive confirm), delete them
   from R2 (and the local cache); otherwise leave in place and report.
4. Rewrite `photos.json`; refresh `cover` if it no longer exists; re-stub
   `annotations.yaml` (preserving existing entries, adding blanks for new files).
5. Offer to commit & push (suppressed under `--no-upload`).

### `photosite annotate [slug]`
Interactive, guided annotation — the primary way species/captions/titles get set.
1. Resolve the trip (select list if no slug).
2. Walk photos **newest-first**, one at a time. For each:
   - Open the image in the OS default viewer (`open`/`xdg-open`/`start` via
     `execa`); best-effort, never fatal if it fails.
   - Show current values (from `annotations.yaml`, falling back to EXIF) and
     prompt for **title**, **species**, **caption**.
   - **Species autocomplete** draws from a global list of every species already
     used across all trips, so repeated species are one keystroke. Free-text new
     entries are allowed; multiple species per photo supported.
   - A **"set as cover"** keypress marks the current photo as the trip cover
     (writes `cover` in `trip.yaml`).
   - Allow skip/back/quit at any point; partial progress is saved as you go.
3. Write `annotations.yaml`, preserving untouched entries.
4. On finish, offer to preview and/or commit & push.

### `photosite cover [slug]`
Standalone cover picker: resolve trip, present a select list of its photos
(filename + caption hint), write the chosen filename to `trip.yaml`.

### `photosite preview`
Convenience wrapper that runs the Astro dev server from `site/` with the
local-image middleware active (§6), so you can review trips — including ones not
yet uploaded — before publishing. Prints the local URL.

### `photosite list`
List trips with title, photo count, location, dates, and slug.

### Publishing helper (shared)
After a successful `add-trip` / `update-trip` / `annotate`, offer:
`commit & push now?` → runs `git add -A && git commit -m "<message>" && git push`,
which triggers the Cloudflare Pages deploy. Skipped automatically when the
operation ran with `--no-upload` (R2 wouldn't have the images the live site needs).
Declining is always safe; it just prints the manual reminder.

---

## 5. Image pipeline specification

All conversion happens in an OS temp directory created with `fs.mkdtemp` and
removed in a `finally` block (so it's cleaned up even on error). Per source image:

- Open with sharp, call `.rotate()` to honor EXIF orientation, `failOn: "none"`
  so odd/HEIC files don't crash the batch.
- Read source width/height. Generate WebP at each configured width **that does
  not exceed the source width** (never upscale); if none qualify, use the source
  width. WebP quality from config (default 80).
- Generate one JPEG fallback at `min(fallbackWidth, sourceWidth)` (mozjpeg,
  same quality).
- Generate a tiny (24px wide) WebP, base64-encoded, as an inline blur-up
  placeholder (`lqip`).
- Compute `ratio = width/height` for layout/aspect-ratio.

After processing all images into the temp dir:
1. **Copy the whole dir into the local cache** `site/.image-cache/<slug>/`
   (overwriting that slug's prior contents). This happens regardless of upload so
   local preview always works.
2. Unless `--no-upload`, upload the temp dir to `<remote>:<bucket>/<slug>/` with
   `rclone copy --checksum`.

Build each public URL as `<publicBaseUrl>/<slug>/<key>` (strip any trailing slash
on the base). Sort photo records newest-first by `date`.

The **key stem** for a file is its basename, lowercased, non-`[a-z0-9._-]`
collapsed to `-`. Variant keys: `<stem>-<width>.webp`; fallback `<stem>.jpg`.

---

## 6. Local preview architecture

Goal: `photosite add-trip` then `photosite preview` shows the real gallery with no
R2 round-trip, while the deployed site still serves everything from R2 and never
ships the cache.

Three pieces:

1. **Persistent derivative cache.** The pipeline (§5) writes finished variants to
   `site/.image-cache/<slug>/<key>` (gitignored), before the upload step.
2. **Dev-only middleware.** An Astro integration registers Vite middleware in the
   `astro:server:setup` hook (active only under `astro dev`). It serves
   `/local-images/<slug>/<key>` from the cache. **Cache miss → 302 redirect to the
   real R2 URL** `<publicBaseUrl>/<slug>/<key>`, so older trips not in the local
   cache still render.
3. **Dev URL rewrite.** The content loader (`src/lib/trips.js`) rewrites each
   `photos.json` URL when `import.meta.env.DEV`: swap the `publicBaseUrl` prefix for
   `/local-images`. In a production build it leaves the real R2 URLs untouched, so
   `dist/` references only R2 and the middleware/cache are absent from the deploy.

Result: a brand-new, not-yet-uploaded trip previews entirely from local disk;
anything missing locally falls through to R2; production is pure R2. `lqip`
placeholders are inline base64 and render regardless of cache state.

---

## 7. Metadata extraction & data schemas

### exiftool call
Run `exiftool -j -n <tags> <files...>` (one batch). `-n` gives numeric values.
Request: GPSLatitude, GPSLongitude, GPSLatitudeRef, GPSLongitudeRef, GPSAltitude,
DateTimeOriginal, CreateDate, Make, Model, LensModel, FNumber, ExposureTime, ISO,
FocalLength, Description, Caption-Abstract, Subject, HierarchicalSubject,
ImageWidth, ImageHeight.

**GPS sign:** the raw EXIF GPSLatitude/Longitude are unsigned; apply sign from
the ref (`S`/`W` → negative). Only emit `gps` when both lat and lon are present.

**Subject / HierarchicalSubject** may each be a string or an array — normalize to
arrays.

**Species extraction** (only when `keywords.speciesFromKeywords` is true):
- From HierarchicalSubject entries starting with `"<speciesRoot>|"`, take the
  last `|`-segment (the leaf).
- Also accept a flat `sp:Name` convention in Subject.
- De-duplicate.
- When the flag is false, species come only from `annotations.yaml`.

**Caption:** `Description` or `Caption-Abstract`.

### `photosite.config.toml`
```toml
[site]
title = "Below the Surface"
publicBaseUrl = "https://img.example.com"   # R2 custom domain

[r2]
remote = "r2"
bucket = "dive-photos"

[images]
widths = [480, 960, 1600, 2400]
quality = 80
fallbackWidth = 1600

[keywords]
speciesFromKeywords = false
speciesRoot = "Species"
```

### `trip.yaml` (hand-editable; tool seeds it)
```yaml
title: Raja Ampat
slug: example-raja-ampat
location: { name: "Raja Ampat, Indonesia", lat: -0.234, lon: 130.519 }
dates: "2025-03-05 to 2025-03-07"
summary: "Short intro paragraph."
cover: manta-cleaning.jpg          # filename of the cover photo (defaults to newest)
```

### `photos.json` (tool-generated; do not hand-edit)
Array of:
```json
{
  "file": "manta-cleaning.jpg",
  "width": 1600, "height": 1067, "ratio": 1.5,
  "lqip": "data:image/webp;base64,...",
  "fallback": "https://img.example.com/<slug>/manta-cleaning.jpg",
  "srcset": [
    { "url": "https://img.example.com/<slug>/manta-cleaning-480.webp", "w": 480 },
    { "url": "https://img.example.com/<slug>/manta-cleaning-960.webp", "w": 960 }
  ],
  "date": "2025-03-06T09:05:00",
  "gps": { "lat": -0.502, "lon": 130.672 },
  "camera": "Sony A7 IV",
  "lens": "FE 16-35mm F2.8 GM",
  "exposure": { "fNumber": 6.3, "exposureTime": 0.008, "iso": 500, "focalLength": 16 },
  "caption": "EXIF Description if present, else null",
  "species": ["from keywords if enabled, else []"],
  "keywords": ["Raja Ampat", "underwater"]
}
```

### `annotations.yaml` (tool stubs + writes via `annotate`; also hand-editable)
Keyed by photo filename. The tool adds a blank entry per photo and preserves
existing ones.
```yaml
manta-cleaning.jpg:
  title: null
  species: [Reef manta ray]
  caption: "Cleaning station at Manta Sandy — three passes overhead."
```

---

## 8. rclone integration

- Detect installation via `rclone version`.
- List remotes via `rclone listremotes`; existing remote → `config update`,
  else `config create`.
- Create/update an S3 remote: `provider=Cloudflare`, `region=auto`, `acl=private`,
  `endpoint=https://<accountId>.r2.cloudflarestorage.com`. Only pass
  `access_key_id` / `secret_access_key` when provided (so re-running setup
  without re-entering them preserves the stored credential).
- Read non-secret fields back via `rclone config show <name>` to pre-fill the
  wizard (parse `key = value` lines; never display secrets).
- Upload: `rclone copy <localDir> <remote>:<bucket>/<prefix> --checksum`.
- List keys: `rclone lsf <remote>:<bucket>/<prefix> --files-only -R`.
- Delete: `rclone deletefile <remote>:<bucket>/<prefix><key>`.

---

## 9. Site specification

Astro, static output (`build.format: "directory"`).

### Content loading (build-time)
A `src/lib/trips.js` module reads each `src/content/trips/<slug>/` folder using
Node `fs` + `js-yaml` + `JSON.parse`. **Resolve the content dir from
`process.cwd()`**, not `import.meta.url` — under Vite's SSR build, `import.meta.url`
points into a bundled chunk and breaks the relative path. (Real gotcha; the
reference implementation hit it.)

Expose: `getTrips()` (sorted newest-first by first photo date), `getTrip(slug)`,
`pointsForTrip(trip)`, `allPoints()`. The loader also applies the **dev URL
rewrite** of §6 when `import.meta.env.DEV`.

**Merge rule:** overlay `annotations.yaml` onto each `photos.json` entry.
Annotations win for `caption`, `species`, `title`; everything else comes from the
photo record. A non-empty annotation `species` overrides EXIF species; empty
falls back to EXIF.

### Pages
- `/` (`index.astro`): hero (site title + eyebrow + intro); a global clustered
  map of all geotagged points; a responsive grid of trip cards linking to
  `/trips/<slug>/`.
- `/trips/[slug]` (`[slug].astro`): `getStaticPaths` from `getTrips()`; trip
  header (location · dates eyebrow, title, summary); a per-trip map (fit to the
  trip's points, no clustering); the gallery.

### Components
- `Base.astro`: HTML head (viewport, title, description), loads Leaflet + Leaflet
  MarkerCluster CSS/JS **once** from CDN in `<head>` (synchronous, so the global
  `L` is available to component inline scripts), header nav, footer, `<slot />`.
- `PhotoMap.astro`: props `points`, `id`, `cluster`, `height`, `caption`. Renders
  a map div + an `is:inline` script (`define:vars` to pass points). CARTO
  `dark_all` tiles. Circle markers in the aqua accent; popups show a thumbnail +
  title linking to the photo (anchor on trip page, trip page on the global map).
  Cluster when `cluster` and MarkerCluster is present. Fit bounds to points;
  single point → `setView` at a sensible zoom. Render nothing if no points.
- `Gallery.astro`: props `photos`. CSS-columns masonry. Each photo is a
  `<button class="shot">` containing a `<picture>` (`<source type="image/webp"
  srcset sizes>` + `<img>` fallback with width/height, `loading="lazy"`,
  `decoding="async"`, `lqip` as background, `aspect-ratio` from `ratio`). Hover/
  focus reveals a caption overlay (species in italic serif, caption note). Click
  opens a lightbox.
- **Lightbox** (vanilla JS, no dependency): one overlay per gallery; opens to the
  clicked photo; supports prev/next, Escape to close, click-backdrop to close;
  shows species + caption + formatted EXIF (`f/8 · 1/200s · ISO 400 · 16mm`,
  converting decimal exposure time to `1/x`). Locks body scroll while open.

### Responsive requirements
- Gallery columns: 1 / 2 / 3 / 4 at ~540 / 900 / 1300px breakpoints.
- Fluid type scale (`clamp`), fluid section padding and gaps.
- `<picture>` `sizes`:
  `(min-width:1300px) 25vw, (min-width:900px) 33vw, (min-width:540px) 50vw, 100vw`.
- Quality floor: visible keyboard focus (`:focus-visible`), `prefers-reduced-
  motion` respected (disable transforms/transitions), maps usable on touch.

---

## 10. Design system

A quiet, images-first gallery — the UI recedes so photographs dominate. Spend the
one bold move on the dark "below the surface" atmosphere and the map-as-
navigation; keep everything else disciplined.

**Palette (CSS custom properties)**
```
--depth-900 #06121a   --depth-800 #0a1c27   --depth-700 #102a38
--surface   #0d232f   --line      #1c3a49
--mist      #e9f1f3 (text)        --mist-dim #93abb6 (secondary)
--aqua      #58d2c6 (accent — pins, links, focus; used sparingly)
--aqua-deep #2b8e87   --sand #d9c7a3 (warm secondary, very sparing)
```
Background: a subtle radial "depth" gradient over `--depth-900`.

**Type**
- Display/headings + species names: serif stack — `"Iowan Old Style",
  "Palatino Linotype", Palatino, "Book Antiqua", Georgia, serif` (field-journal
  feel).
- Body: system sans stack.
- Captions / EXIF / eyebrows: mono stack. Eyebrows uppercased, wide letter-
  spacing, in `--aqua`.

**Map:** CARTO `dark_all` basemap; aqua circle markers; rounded, bordered frame.

These are tokens at the top of `global.css`; the look must be changeable by
editing them.

---

## 11. Capture One / keyword workflow (document for the user)

Species can live in the file (embedded keywords) or in `annotations.yaml`. The
file route only works if the export preserves the hierarchy. The user must verify
on a real export:

```
exiftool -a -G -s -HierarchicalSubject -Subject yourphoto.jpg
```
- If `HierarchicalSubject` shows `Species|Fish|Tasselled wobbegong` → enable
  `speciesFromKeywords` and set `speciesRoot`.
- If only a flattened `Subject` list appears → keep species in `annotations.yaml`.

**Recommended default** (and what setup ships): caption via Capture One's
Description (IPTC `dc:description`, unambiguous) + species in YAML via the
`annotate` command, unless the hierarchy verifiably survives export. In Capture
One, create a Process Recipe that outputs web JPEGs with keywords enabled in the
recipe's Metadata section, export to a folder, and point the CLI at it.

---

## 12. Deployment

**R2** (manual, in the Cloudflare dashboard): create the bucket; create a
**bucket-scoped** read/write API token (not an account-wide key); bind a custom
domain (e.g. `img.yoursite.com`) — the `r2.dev` URL is rate-limited and not for
production. Feed the bucket, account id, and token into `photosite setup`.

**Cloudflare Pages**: connect the repo and set Root directory `site`, Build
command `npm run build`, Output directory `dist`. Push to main → rebuild. Custom
site domain ~$10–15/yr; otherwise $0.

Free-tier limits to respect: Pages allows 20,000 files per deployment and 25 MiB
per file — at `widths.length + 1` files per photo, budget accordingly (e.g. ~4k
photos at 5 files each).

---

## 13. Implementation gotchas

1. **Astro content path:** resolve from `process.cwd()`, not `import.meta.url`
   (Vite SSR bundling breaks the latter at build time).
2. **GPS sign:** apply from `GPSLatitudeRef`/`GPSLongitudeRef`; raw tags are
   unsigned even with `-n`.
3. **rclone create vs update:** check `listremotes` first; never pass empty
   credential fields on re-run.
4. **Subject/HierarchicalSubject** can be string or array — always normalize.
5. **sharp:** `.rotate()` for orientation; skip widths above source width;
   `failOn: "none"` for HEIC/odd files.
6. **Temp dir:** `mkdtemp` + cleanup in `finally`. (The local cache in §6 is a
   *separate*, persistent copy — don't clean that one.)
7. **Leaflet:** load once in `<head>`; component scripts are `is:inline` so the
   global `L` resolves.
8. **publicBaseUrl:** strip trailing slash before joining URLs.
9. **Dev image middleware** is dev-only; the production `dist/` must reference R2
   directly and must not include `.image-cache/`.

---

## 14. Acceptance criteria

- `photosite setup` runs, is re-runnable, writes config, and stores R2 creds in
  rclone (not the repo); re-running without re-entering the secret preserves it.
- `photosite add-trip` ingests a folder, writes the local cache, uploads variants
  to R2 (unless `--no-upload`), and produces `trip.yaml` + `photos.json` + stubbed
  `annotations.yaml`; temp files are gone afterward.
- `photosite add-trip --no-upload` followed by `photosite preview` renders the new
  trip's gallery from the local cache with no R2 traffic.
- `photosite annotate` walks a trip, opens each photo, offers species autocomplete
  and a set-as-cover action, and writes `annotations.yaml` preserving prior entries.
- `photosite update-trip` re-syncs a folder idempotently and can prune orphaned R2
  objects (and their cache copies).
- `npm run build` in `site/` produces a static site where: trips list renders,
  each trip page renders its gallery, geotagged photos appear as map pins,
  annotations override EXIF, images use responsive WebP with a JPEG fallback, and
  the lightbox works with keyboard nav.
- Layout is correct and usable from ~360px to large desktop; focus is visible;
  reduced-motion is honored.
- No secret ever appears in the repo or build output; `dist/` references only R2.

---

## 15. Build order

1. **Scaffold** monorepo, configs, `.gitignore` (incl. `.image-cache/`),
   `.env.example`, gitleaks hook, `justfile`, README stub.
2. **Tool core:** config load/save, repo-root resolution, rclone wrapper, exiftool
   wrapper, sharp pipeline (temp-dir cleanup + local-cache dual-write), trip
   read/write/merge helpers, global-species collector.
3. **Tool commands:** `setup`, `add-trip`, `update-trip`, `annotate`, `cover`,
   `preview`, `list`; shared publishing helper; wire up `commander` + `npm link`.
4. **Site:** content loader + merge + dev URL rewrite, Astro dev-image integration,
   `Base` layout, `PhotoMap`, `Gallery` + lightbox, index and trip pages,
   `global.css` tokens.
5. **Seed** an example trip (placeholder URLs + a few bundled cache images) and
   verify both `npm run build` and `photosite preview` render before any upload.
6. **README** with the user-facing setup → Capture One export → add-trip →
   annotate → preview → publish → deploy steps.

---

## 16. Future (explicitly deferred)

- Compiled single-binary tool (`go install`-style) if portability is wanted.
- A thin Capture One `.coplugin` wrapper for an in-app "publish" button (native
  Swift/C# only; the SDK is limited and doesn't expose richer keyword data than
  the export, so it's optional polish over the watched-folder/CLI flow).
- Group/filter galleries by species family if hierarchical keywords are adopted.
- Cloudflare resource automation (bucket/token/domain via API) if manual setup
  proves annoying.
