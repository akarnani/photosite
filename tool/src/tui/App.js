import fs from 'node:fs';
import path from 'node:path';
import React, { useState } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import htm from 'htm';
import PhotoList from './PhotoList.js';
import Thumbnail from './Thumbnail.js';
import EditPanel from './EditPanel.js';
import { useTerminalSize } from './hooks.js';
import { effective, toAnnotation } from './merge.js';

const html = htm.bind(React.createElement);

function StatusBar({ eff, mode }) {
  const hints =
    mode === 'cover'
      ? '↑↓ move · Enter set cover · o open · q quit'
      : '↑↓ move · e/Enter edit · o open+edit · c cover · q save & quit';
  return html`<${Box} flexDirection="column" marginTop=${1}>
    <${Box}><${Text} dimColor>species: </${Text}><${Text}>${eff.species.join(' · ') || '—'}</${Text}></${Box}>
    <${Box}><${Text} dimColor>caption: </${Text}><${Text}>${eff.caption || '—'}</${Text}></${Box}>
    <${Box} marginTop=${1}><${Text} dimColor>${hints}</${Text}></${Box}>
  </${Box}>`;
}

export default function App({ mode, title, photos, initialAnn, initialCover, pool, cacheDir, stemOf, persist, openViewer }) {
  const { exit } = useApp();
  const size = useTerminalSize();
  const [ann, setAnn] = useState(initialAnn);
  const [cover, setCover] = useState(initialCover);
  const [index, setIndex] = useState(0);
  const [editing, setEditing] = useState(false);

  const p = photos[index];
  const eff = effective(p, ann[p.file]);
  const cachePath = path.join(cacheDir, `${stemOf(p.file)}.jpg`);
  const hasCache = fs.existsSync(cachePath);

  const saveAnn = (file, annotation) => {
    const next = { ...ann, [file]: annotation };
    setAnn(next);
    persist(next, cover);
  };
  const setCoverTo = (file) => {
    setCover(file);
    persist(ann, file);
  };

  // Layout geometry from terminal size.
  const wide = size.columns >= 90;
  const listWidth = wide ? Math.min(46, Math.floor(size.columns * 0.45)) : size.columns;
  const bodyHeight = Math.max(6, size.rows - 7);
  const thumbCols = Math.max(10, Math.min(size.columns - listWidth - 4, 72));
  const thumbRows = Math.max(4, bodyHeight);

  useInput(
    (input, key) => {
      if (editing) return;
      if (input === 'q' || key.escape) return exit();
      if (key.upArrow || input === 'k') return setIndex((i) => Math.max(0, i - 1));
      if (key.downArrow || input === 'j') return setIndex((i) => Math.min(photos.length - 1, i + 1));
      if (input === 'o') {
        openViewer(p.file);
        if (mode !== 'cover') setEditing(true);
        return;
      }
      if (input === 'c' && mode !== 'cover') return setCoverTo(p.file);
      if (key.return || input === 'e') {
        if (mode === 'cover') {
          setCoverTo(p.file);
          return exit();
        }
        setEditing(true);
      }
    },
    { isActive: !editing },
  );

  return html`<${Box} flexDirection="column" width=${size.columns} height=${size.rows}>
    <${Box}>
      <${Text} bold>${mode === 'cover' ? 'Choose cover' : 'Annotate'} · ${title}  </${Text}>
      <${Text} dimColor>${index + 1}/${photos.length}${cover === p.file ? '  ★ cover' : ''}</${Text}>
    </${Box}>

    <${Box} height=${bodyHeight} marginTop=${1}>
      <${PhotoList} photos=${photos} index=${index} ann=${ann} cover=${cover} height=${bodyHeight} width=${listWidth} />
      ${wide &&
      html`<${Box} marginLeft=${2}>
        <${Thumbnail} file=${cachePath} cols=${thumbCols} rows=${thumbRows} missing=${!hasCache} />
      </${Box}>`}
    </${Box}>

    ${editing
      ? html`<${EditPanel}
          initial=${eff}
          pool=${pool}
          onCommit=${(vals) => {
            saveAnn(p.file, toAnnotation(p, vals));
            setEditing(false);
          }}
          onCancel=${() => setEditing(false)}
        />`
      : html`<${StatusBar} eff=${eff} mode=${mode} />`}
  </${Box}>`;
}
