# CLAUDE.md

Guidance for AI agents working in this repo. Keep this file current as the code evolves.

## What this is

A static underwater-photography portfolio (the **site/**) plus a local **CLI tool/**
that manages it. Photos are grouped by **trip**, stored as web-optimized
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
site/                   the Astro site — Cloudflare Pages builds this. Own package.json.
  src/content/trips/<slug>/{trip.yaml, photos.json, annotations.yaml}
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
- Leaflet is loaded once from CDN in `<head>`; component map scripts are `is:inline`.
- Strip trailing slash from `publicBaseUrl` before joining URLs.

## Commands (once `npm link`ed in tool/)

- `photosite setup` — re-runnable config wizard (writes rclone remote + config TOML)
- `photosite add-trip [--from <folder>] [--no-upload]` — ingest a folder
- `photosite update-trip [slug] --from <folder> [--prune] [--no-upload]`
- `photosite annotate [slug]` — guided species/caption/title editor with preview
- `photosite cover [slug]` — pick the trip cover photo
- `photosite preview` — Astro dev server with local-image middleware
- `photosite list`

Build the site: `cd site && npm run build`. Convenience wrappers in `justfile`.

## Conventions

- CLI status lines: `→` step, `✓` ok, `!` warn, `✗` error (picocolors).
- ESM everywhere, Node ≥18.
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
