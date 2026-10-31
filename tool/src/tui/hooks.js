// React hooks for the TUI: terminal size (reacts to resize) and async thumbnails.
import { useState, useEffect } from 'react';
import { renderHalfBlocks } from './thumb.js';

export function useTerminalSize() {
  const read = () => ({ columns: process.stdout.columns || 80, rows: process.stdout.rows || 24 });
  const [size, setSize] = useState(read);
  useEffect(() => {
    const on = () => setSize(read());
    process.stdout.on('resize', on);
    return () => process.stdout.off('resize', on);
  }, []);
  return size;
}

// Render-once cache keyed by file + geometry, so scrolling back is instant.
const cache = new Map();

export function useThumbnail(file, cols, rows) {
  const key = file ? `${file}@${cols}x${rows}` : null;
  const [text, setText] = useState(() => (key && cache.has(key) ? cache.get(key) : null));

  useEffect(() => {
    let alive = true;
    if (!key) {
      setText(null);
      return;
    }
    if (cache.has(key)) {
      setText(cache.get(key));
      return;
    }
    setText(null);
    loadImage(file)
      .then((src) => renderHalfBlocks(src, { cols, maxRows: rows }))
      .then((r) => {
        cache.set(key, r.text);
        if (alive) setText(r.text);
      })
      .catch(() => {
        if (alive) setText(false); // false = failed (vs null = still loading)
      });
    return () => {
      alive = false;
    };
  }, [key]);

  return text;
}

// A local path is handed to sharp as-is; an http(s) URL (R2 public bucket) is
// fetched into memory. Nothing is written to .image-cache/.
const remote = new Map();
export function loadImage(file) {
  if (!/^https?:\/\//.test(file)) return Promise.resolve(file);
  if (!remote.has(file)) {
    const p = fetch(file).then(async (res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    });
    p.catch(() => remote.delete(file));
    remote.set(file, p);
  }
  return remote.get(file);
}
