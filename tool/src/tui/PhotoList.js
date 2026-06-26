import React from 'react';
import { Box, Text } from 'ink';
import htm from 'htm';
import { effective } from './merge.js';

const html = htm.bind(React.createElement);

const pad = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s.padEnd(n));

export default function PhotoList({ photos, index, ann, cover, height, width }) {
  const rows = Math.max(1, height);
  // Keep the selection roughly centered, clamped to the ends.
  let start = Math.min(Math.max(0, index - Math.floor(rows / 2)), Math.max(0, photos.length - rows));
  const visible = photos.slice(start, start + rows);

  return html`<${Box} flexDirection="column" width=${width}>
    ${visible.map((p, vi) => {
      const i = start + vi;
      const sel = i === index;
      const eff = effective(p, ann[p.file]);
      const marks = `${eff.species.length ? 'S' : ' '} ${eff.caption ? 'C' : ' '} ${cover === p.file ? '★' : ' '}`;
      const row = ` ${sel ? '▸' : ' '} ${String(i + 1).padStart(3)}  ${pad(p.file, Math.max(6, width - 16))}  ${marks}`;
      return html`<${Text} key=${p.file} inverse=${sel} wrap="truncate">${row}</${Text}>`;
    })}
  </${Box}>`;
}
