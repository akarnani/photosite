// Cover focal point: which part of a trip's cover photo stays in frame when it
// is cropped (the home/genre hero banner, link-preview cards).
//
// trip.yaml `coverPosition:` takes the CSS object-position shorthand —
// "50% 20%" (x then y, 0% = left/top, 100% = right/bottom), or keywords such
// as "top", "center bottom", "left 30%". A lower y shows more of the top of
// the photo (moves the image down in the frame). Absent → centred.
//
// Shared by the site AND the CLI — keep it dependency-free.

const KEYWORDS = { left: 0, top: 0, center: 50, right: 100, bottom: 100 };
const clamp = (n) => Math.min(100, Math.max(0, n));

// Parse one token as a percentage, or null.
function pct(tok) {
  if (tok in KEYWORDS) return KEYWORDS[tok];
  const m = /^(-?\d+(?:\.\d+)?)%?$/.exec(tok);
  return m ? clamp(Number(m[1])) : null;
}

/**
 * Parse a coverPosition value into `{ x, y }` percentages, or null when it is
 * absent or unparseable (callers then fall back to their default crop).
 * Accepts a string ("50% 20%", "top", "right 30%") or a bare number (y only).
 */
export function parseCoverPosition(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number') return { x: 50, y: clamp(value) };
  const toks = String(value).trim().toLowerCase().split(/\s+/);
  if (toks.length === 1) {
    const t = toks[0];
    // A lone vertical keyword sets y; anything else sets x (CSS semantics).
    if (t === 'top' || t === 'bottom') return { x: 50, y: KEYWORDS[t] };
    const x = pct(t);
    return x == null ? null : { x, y: 50 };
  }
  if (toks.length !== 2) return null;
  let [a, b] = toks;
  // "top left" / "bottom right": vertical keyword first → swap.
  if ((a === 'top' || a === 'bottom') || (b === 'left' || b === 'right')) [a, b] = [b, a];
  const x = pct(a);
  const y = pct(b);
  return x == null || y == null ? null : { x, y };
}

// CSS object-position string for a parsed position (null → undefined, i.e.
// leave the stylesheet's default).
export function objectPosition(pos) {
  return pos ? `${pos.x}% ${pos.y}%` : undefined;
}
