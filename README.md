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

# 4. annotate species & captions (opens each photo, autocompletes species)
photosite annotate

# 5. preview locally — works even before anything is uploaded to R2
photosite preview

# 6. publish (the CLI offers to commit & push, which triggers the deploy)
```

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
