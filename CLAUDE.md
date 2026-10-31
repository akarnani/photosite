# CLAUDE.md

Guidance for AI agents working in this repo. Keep this file current as the code evolves.

## What this is

A static photography portfolio (the **site/**) — underwater, wildlife, air
shows — plus a local **CLI tool/** that manages it. Photos are grouped by **trip**, stored as web-optimized
derivatives in Cloudflare R2, and rendered by an Astro static site hosted on
Cloudflare Pages. There is no server, database, or upload UI.

**`DESIGN.md` is the source of truth.** Read it before making non-trivial changes —
it specifies every command, schema, and the rationale behind the architecture.

## Layout

```
photosite.config.toml   committed, NON-SECRET project config (TOML)
tool/                   the CLI — LOCAL ONLY, never deployed. Own package.json.
  bin/photosite.js      commander entry point
  src/                  modules + commands
  src/tui/              Ink TUI for annotate/cover (App, EditPanel, PhotoList,
                        Thumbnail, half-block thumb.js renderer)
  src/favorites/        `favorites` picker: server.js (local http + JSON API),
                        page.html (UI). Engine lives in the site (below).
site/                   the Astro site — Cloudflare Pages builds this. Own package.json.
  src/content/trips/<slug>/{trip.yaml, photos.json, annotations.yaml}
  src/lib/genres.js     photo genres (copy + accent per genre). Shared with the
                        CLI by relative path — dependency-free. trip.yaml
                        `genre:` (absent → underwater); /[genre]/ pages
  src/lib/favoritesEngine.js  pure pick-your-favorites engine, shared by the
                        /favorites/ page AND the CLI (tool imports it by relative
                        path — it must stay dependency-free and browser-safe)
  src/pages/favorites/  public game: index.astro + photos.json.js catalog
  .image-cache/         gitignored local derivative cache for offline preview
```

The two `package.json` files are **independent dependency sets** — do NOT introduce
a hoisted workspace. The Pages build (root dir `site/`) must never pull the tool's
deps.

## Hard rules

- **Secrets never touch the repo.** R2 credentials live only in the user's rclone
  remote (`~/.config/rclone/rclone.conf`). `photosite.config.toml` holds only
  non-secret values (bucket names, public URLs — they ship in HTML anyway).
- **The production build needs zero credentials** — it reads images from R2 over
  public HTTPS. Anything under `site/.image-cache/` and the dev-image middleware
  must be absent from `dist/`.
- **photos.json is tool-generated** — never hand-edit. `annotations.yaml` and
  `trip.yaml` are user-editable; the tool preserves existing annotation entries.

## Key gotchas (see DESIGN.md §13)

- Astro content loader resolves paths from `process.cwd()`, NOT `import.meta.url`
  (Vite SSR bundling breaks the latter at build time).
- GPS EXIF tags are unsigned even with `-n`; apply sign from the Ref tags.
- exiftool Subject/HierarchicalSubject may be a string or an array — normalize.
- sharp: `.rotate()` for orientation, `failOn: "none"`, never upscale past source.
- rclone: check `listremotes` before create-vs-update; never pass empty creds.
- Maps: **MapLibre GL** loaded once from CDN in `<head>` (pinned + SRI); the
  `PhotoMap` script is `is:inline`. Flat **custom vector style** (authored inline
  in `PhotoMap.astro`, site palette) over MapTiler tiles via `PUBLIC_MAPTILER_KEY`
  (client-side, domain-restricted, read from `site/.env` — not a repo secret).
  `cluster` prop → GeoJSON clustering for the home map; default → HTML `.map-pin`
  markers fit to the trip. No key → the map shows a notice.
- Link previews: `Base.astro` emits OG/Twitter tags (needs `site` in
  `astro.config.mjs`). Branded 1200×630 cards are prerendered by
  `src/lib/ogCard.js` (satori + sharp, fontsource `.woff` fonts) to
  `/og/trips/<slug>.jpg` and `/og/home.jpg`, from the cover via `.image-cache/`
  or R2 HTTPS. `?v=` hash busts app caches; bump `DESIGN_VERSION` on redesign.
  satori needs `boxSizing: 'border-box'` on padded roots. `sharp`/`satori` in
  `site/` are the site's own deps (Node ≥20.9, `site/.nvmrc`).
- Strip trailing slash from `publicBaseUrl` before joining URLs.
- TUI (`annotate`/`cover`): **Ink + React via `htm`** (tagged templates — NO JSX
  build step; keep it that way). Runs on the alternate screen (`runTui`).
  Thumbnails are truecolor half-blocks (`thumb.js`) rendered from the local
  `.image-cache/<slug>/<stem>.jpg`; missing cache → "no local preview". Both
  commands require a TTY (`cover` has a `prompts` fallback; `annotate` errors).
  `ink`/`react`/`htm`/`ink-text-input` are tool-only deps — never in `site/`.

## Commands (once `npm link`ed in tool/)

- `photosite setup` — re-runnable config wizard (writes rclone remote + config TOML)
- `photosite add-trip [--from <folder>] [--genre <g>] [--slug <slug>] [--no-upload]` — ingest a
  folder. Slug defaults to title + year (titles may repeat; slugs can't)
- `photosite add-trips [parent] [--min <n>] [--no-upload]` — bulk: scan a parent
  tree (`discover.js`), multiselect image folders, describe each, process all
- `photosite update-trip [slug] --from <folder> [--prune] [--no-upload]`
- `photosite annotate [slug]` — full-screen TUI: photo list + live thumbnail,
  edit species/caption/title (see `tool/src/tui/`)
- `photosite cover [slug]` — same TUI in "cover" mode (Enter sets cover)
- `photosite preview` — Astro dev server with local-image middleware
- `photosite upload [slug] [--all]` — push cached derivatives to R2 without
  reprocessing; no slug → uploads the **pending** set (trips processed with
  `--no-upload`), tracked in gitignored `.image-cache/.upload-state.json`
  (`state.js`); `list` flags pending trips
- `photosite push [message]` — commit pending changes and push (triggers deploy)
- `photosite list`
- `photosite favorites [--count <n>] [--lives <n>] [--trips a,b] [--reset]` — pick
  your N favorites (for prints) by choosing the better of two photos in a local
  browser page (`src/favorites/`). Cull phase: a photo is out after `--lives`
  losses (default 2) until ~2×N finalists remain; final phase: Bradley-Terry
  scores, matchups focused on the cut line. State = replayed pick history in
  gitignored `.image-cache/.favorites.json` (resumable, undo = pop). Results are
  sorted chronologically with their trip (`--results`, `--out <csv>`). Plain
  `node:http`, no new deps; images from the local cache, else 302 to R2.
  `--seed <s>`: pairing is a pure function of (seed, history) — ties break on a
  seeded per-photo hash, so the whole first round depends only on the seed.
  The same game is public at `/favorites/` (footer link + "pick your favorites"
  on trip pages): client-side, localStorage progress, `?seed&n&lives&trip` URL
  is shareable, `&picks=` (5-char `photoCode`s) shows a friend's results and
  marks overlap with yours. Ids are `<slug>/<file>` in both, so a seed pairs
  identically in the CLI and on the site. The URL also carries the whole game
  (`&h=<count>.<base64url>`, 2 bits per pick via `encodeHistory`/
  `decodeHistory`, `&v=` photo-set fingerprint), kept current with
  `replaceState`: it's a cross-device resume link, and `&ask=1` shares one
  exact matchup ("which would you pick?").

Build the site: `cd site && npm run build`. Convenience wrappers in `justfile`.

## Conventions

- CLI status lines: `→` step, `✓` ok, `!` warn, `✗` error (picocolors).
- ESM everywhere, Node ≥20.9 (sharp 0.35 requirement).
- Cancelling a prompt exits cleanly with no partial writes.
- `<slug>` args are optional; omitting one shows a select list of trips.

## Example trip

`site/src/content/trips/example-raja-ampat/` is a committed placeholder trip
(R2 URLs point at the non-existent `img.example.com`). Its derivatives under
`site/.image-cache/example-raja-ampat/` are the ONE cache subtree that is
committed (a `.gitignore` exception) so `photosite preview` renders it on a
fresh clone. Delete the trip folder and that cache subtree once real trips exist.

## Build status

All phases complete. `npm run build` (in `site/`) and `photosite preview` both
render. Verified: GPS signing, no-upscale widths, annotation-over-EXIF merge,
prod output references R2 only (no `/local-images` leakage), dev middleware
serves the cache and 302s to R2 on a miss.

- [x] Phase 1 — scaffold
- [x] Phase 2 — tool core modules
- [x] Phase 3 — tool commands + CLI
- [x] Phase 4 — Astro site
- [x] Phase 5 — seed example trip + verify build
