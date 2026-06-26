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
    renderHalfBlocks(file, { cols, maxRows: rows })
      .then((r) => {
        cache.set(key, r.text);
        if (alive) setText(r.text);
      })
      .catch(() => {
        if (alive) setText(null);
      });
    return () => {
      alive = false;
    };
  }, [key]);

  return text;
}
