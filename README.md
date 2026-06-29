# Below the Surface — underwater photography portfolio

A cheap-to-run ($0/month + a domain), low-maintenance static photo portfolio.
Photos are grouped by **trip**, plotted on a **map** from their GPS EXIF, and
annotated with species and short captions. A small local CLI does all the
heavy lifting; the published site is fully static.

- **Site** — [Astro](https://astro.build), hosted free on **Cloudflare Pages**.
- **Images** — web-optimized derivatives in **Cloudflare R2** (kept out of git).
- **Tool** — a local Node CLI (`photosite`) that ingests folders, generates
  responsive WebP/JPEG variants, uploads them, and writes the site's content.

See [`DESIGN.md`](DESIGN.md) for the full spec and rationale.

## How it fits together

```
Capture One export ──▶ photosite add-trip ──▶  R2 (images)  +  site/src/content (metadata)
                                  │
                                  └──▶ photosite annotate ──▶ species & captions
                                                                    │
                            git push ──▶ Cloudflare Pages builds site/ ──▶ live
```

The Cloudflare build needs **zero credentials**: it pulls the git repo and reads
images from R2 over public HTTPS. The only machine holding an R2 credential is
yours, and it lives in rclone's own config — never in this repo.

## Prerequisites

- [Node.js](https://nodejs.org) ≥ 18
- [exiftool](https://exiftool.org) — metadata extraction
- [rclone](https://rclone.org/install/) — uploads to R2
- A Cloudflare account (free) with an R2 bucket and a Pages project

## Quick start

```sh
# 1. install the CLI on your PATH
cd tool && npm install && npm link        # or: just link

# 2. configure (writes rclone remote + photosite.config.toml; no secrets in repo)
photosite setup

# 3. add a trip from a folder of exported JPEGs
photosite add-trip --from ~/Exports/raja-ampat

# 4. annotate species & captions (full-screen browser with inline thumbnails)
photosite annotate

# 5. preview locally — works even before anything is uploaded to R2
photosite preview

# 6. publish (the CLI offers to commit & push, which triggers the deploy)
```

### Annotating & covers (terminal UI)

`photosite annotate` and `photosite cover` open a full-screen browser: a photo
list on the left and a live **inline thumbnail** on the right (truecolor
half-blocks — works great in iTerm2 and Ghostty). You don't have to open every
photo in Preview just to find the one you want.

```
↑/↓      move through photos          e / Enter   edit the selected photo
o        open full-size + edit        c           set as cover
q / Esc  save & quit
```

In edit mode you set **species** (autocompletes from species you've used
before), **caption**, and **title**. Changes save as you go. `cover` is the same
browser in pick mode — Enter sets the cover. Thumbnails come from the local image
cache (populated by `add-trip`/`update-trip`); both commands need an interactive
terminal.

### Adding many trips at once

If you have a parent folder with one subfolder per trip (Capture One nests
exports a few levels deep — that's fine), `add-trips` scans the whole tree:

```sh
photosite add-trips ~/Exports        # or: photosite add-trips --from ~/Exports
```

It finds image folders at any depth (skipping Capture One's `Cache`, `Proxies`,
etc.), lets you **multiselect** which become trips, then asks title / location /
dates / summary for each up front (title defaults from the folder name, dates
from EXIF). Once you've described them all, it processes and uploads everything
unattended and offers a single commit & push. Use `--min <n>` to hide folders
with fewer than _n_ photos. Annotate any of them afterward with
`photosite annotate <slug>`.

### Process now, upload later

`add-trip`/`add-trips` with `--no-upload` process and cache images locally but
skip R2 — handy for previewing first or working offline. The tool remembers which trips you haven't uploaded yet, so just:

```sh
photosite upload          # uploads everything still pending (no slug needed)
photosite push            # deploy
```

`photosite list` flags pending trips with `⬆ pending upload`. You can still
target one with `photosite upload <slug>` or force all with `--all`. (If the
local cache is gone — e.g. a fresh clone — re-run `update-trip --from <folder>`
instead.)

## Cloudflare setup (one time, in the dashboard)

The CLI records values but does **not** create cloud resources. Do these by hand:

1. **R2 bucket** — create a bucket (e.g. `dive-photos`).
2. **R2 API token** — create a token **scoped to that one bucket**, object
   read/write only (not an account-wide key). Note the access key id + secret.
3. **R2 custom domain** — bind a domain like `img.yoursite.com` to the bucket.
   The `r2.dev` URL is rate-limited and not for production.
4. **Cloudflare Pages** — connect this repo. Root directory `site`, build command
   `npm run build`, output directory `dist`. Pushes to `main` rebuild the site.

Then run `photosite setup` and paste in the bucket, account id, and token.

## Photo workflow (Capture One)

Create a Process Recipe that outputs web JPEGs with keywords enabled in the
recipe's Metadata section, export to a folder, and point `photosite add-trip` at
it. Species can come from `annotations.yaml` (default, via `photosite annotate`)
or from embedded hierarchical keywords — see [`DESIGN.md`](DESIGN.md) §11 to
decide which.

## Try it before configuring anything

The repo ships with an example trip (`example-raja-ampat`) using placeholder
images, so you can see the site immediately:

```sh
cd site && npm install && npm run dev      # or: photosite preview
```

Delete `site/src/content/trips/example-raja-ampat/` and
`site/.image-cache/example-raja-ampat/` once you've added a real trip.

## Repo layout

| Path | What |
|---|---|
| `photosite.config.toml` | committed, non-secret project config |
| `tool/` | the CLI (local only, never deployed) |
| `site/` | the Astro site (Cloudflare Pages builds this) |
| `site/src/content/trips/<slug>/` | `trip.yaml`, `photos.json`, `annotations.yaml` |
| `DESIGN.md` | full design & implementation spec |

## License

[MIT](LICENSE) © Andrew Karnani
