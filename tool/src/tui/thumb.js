// Render an image to a string of ANSI half-block rows for inline terminal
// display. Each character cell is the "▀" upper-half-block: foreground color =
// top pixel, background color = bottom pixel, so one text row encodes two pixel
// rows. Truecolor (24-bit) — works in iTerm2, Ghostty, and any truecolor term.
import sharp from 'sharp';

const ESC = '\x1b';
const RESET = `${ESC}[0m`;
const UPPER_HALF = '▀';

// Resize `file` to fit within `cols` columns and `maxRows` text rows (each row =
// 2 px tall), preserving aspect, and return { text, cols, rows }. Because a cell
// is 1 px wide × 2 px tall, the on-screen aspect ≈ the image aspect.
export async function renderHalfBlocks(file, { cols = 44, maxRows = 22 } = {}) {
  const meta = await sharp(file, { failOn: 'none' }).metadata();
  const srcW = meta.width || cols;
  const srcH = meta.height || cols;

  let pxW = Math.max(2, cols);
  let pxH = Math.round((pxW * srcH) / srcW);
  if (pxH % 2) pxH += 1; // even: whole number of half-block rows
  const maxPxH = maxRows * 2;
  if (pxH > maxPxH) {
    pxH = maxPxH;
    pxW = Math.max(2, Math.round((pxH * srcW) / srcH));
  }

  const { data, info } = await sharp(file, { failOn: 'none' })
    .rotate()
    .resize(pxW, pxH, { fit: 'fill' })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  return toHalfBlocks(data, info);
}

// Raw RGB pixels → { text, cols, rows } of half-block rows.
function toHalfBlocks(data, info) {
  const { width: w, height: h, channels: ch } = info;
  const at = (x, y) => {
    const i = (y * w + x) * ch;
    return `${data[i]};${data[i + 1]};${data[i + 2]}`;
  };

  const lines = [];
  for (let y = 0; y + 1 < h; y += 2) {
    let line = '';
    for (let x = 0; x < w; x++) {
      line += `${ESC}[38;2;${at(x, y)}m${ESC}[48;2;${at(x, y + 1)}m${UPPER_HALF}`;
    }
    lines.push(line + RESET);
  }
  return { text: lines.join('\n'), cols: w, rows: lines.length };
}

// Upright, downsized copy of an image (path or Buffer) to crop repeatedly while
// the cover position is nudged. Returns { buf, width, height }.
export async function preparePhoto(src, maxW = 960) {
  const { data, info } = await sharp(src, { failOn: 'none' })
    .rotate()
    .resize({ width: maxW, withoutEnlargement: true })
    .jpeg({ quality: 85 })
    .toBuffer({ resolveWithObject: true });
  return { buf: data, width: info.width, height: info.height };
}

// Half-block render of `photo` (from preparePhoto) cropped to a cols × rows
// frame the way CSS object-fit: cover + object-position x% y% would crop it
// (the same rule the site's hero and OG card use).
export async function renderCrop(photo, { cols, rows, pos }) {
  const pxW = Math.max(2, cols);
  const pxH = Math.max(2, rows * 2);
  const frame = pxW / pxH;
  const { width: W, height: H } = photo;
  let cw = W;
  let ch = H;
  if (W / H > frame) cw = Math.max(1, Math.round(H * frame));
  else ch = Math.max(1, Math.round(W / frame));
  const left = Math.round(((W - cw) * pos.x) / 100);
  const top = Math.round(((H - ch) * pos.y) / 100);
  const { data, info } = await sharp(photo.buf)
    .extract({ left, top, width: cw, height: ch })
    .resize(pxW, pxH, { fit: 'fill' })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return toHalfBlocks(data, info);
}
