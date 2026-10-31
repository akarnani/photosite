import fs from 'node:fs';
import path from 'node:path';
import React, { useState } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import htm from 'htm';
import PhotoList from './PhotoList.js';
import Thumbnail from './Thumbnail.js';
import EditPanel from './EditPanel.js';
import PositionView from './PositionView.js';
import { useTerminalSize } from './hooks.js';
import { effective, toAnnotation } from './merge.js';

const html = htm.bind(React.createElement);

// Smallest published rendition of a photo (photos.json srcset, else fallback).
function remotePreview(p) {
  const set = [...(p.srcset || [])].sort((a, b) => a.w - b.w);
  return set[0]?.url || p.fallback || null;
}

function StatusBar({ eff, mode }) {
  const hints =
    mode === 'cover'
      ? '↑↓ move · Enter set cover & position it · o open · q quit'
      : '↑↓ move · e/Enter edit · o open+edit · c cover · p cover position · q save & quit';
  return html`<${Box} flexDirection="column" marginTop=${1}>
    <${Box}><${Text} dimColor>species: </${Text}><${Text}>${eff.species.join(' · ') || '—'}</${Text}></${Box}>
    <${Box}><${Text} dimColor>caption: </${Text}><${Text}>${eff.caption || '—'}</${Text}></${Box}>
    <${Box} marginTop=${1}><${Text} dimColor>${hints}</${Text}></${Box}>
  </${Box}>`;
}

export default function App({ mode, title, photos, initialAnn, initialCover, initialPosition = null, pool, cacheDir, stemOf, persist, openViewer, openBrowserPicker, offerPublish, result }) {
  const { exit } = useApp();
  const size = useTerminalSize();
  const [ann, setAnn] = useState(initialAnn);
  const [cover, setCover] = useState(initialCover);
  // trip.yaml coverPosition as { x, y } (null = centred). It belongs to one
  // photo, so changing the cover resets it.
  const [position, setPosition] = useState(initialPosition);
  const [positioning, setPositioning] = useState(false);
  // Cover mode starts on the current cover.
  const [index, setIndex] = useState(() => (mode === 'cover' ? Math.max(0, photos.findIndex((x) => x.file === initialCover)) : 0));
  const [editing, setEditing] = useState(false);
  const [quitting, setQuitting] = useState(false);

  // Quitting: if we can offer to publish, ask inside the TUI (a readline prompt
  // after Ink exits can't read stdin); otherwise just leave.
  const requestQuit = () => (offerPublish ? setQuitting(true) : exit());
  const finishQuit = (publish) => {
    if (result) result.publish = publish;
    exit();
  };
  useInput(
    (input, key) => {
      if (input === 'y' || input === 'Y') return finishQuit(true);
      if (input === 'n' || input === 'N' || key.escape || key.return) return finishQuit(false);
    },
    { isActive: quitting },
  );

  const p = photos[index];
  const eff = effective(p, ann[p.file]);
  // Prefer the local derivative; otherwise preview the smallest R2 rendition
  // (e.g. trips processed on another machine, or a cleared cache).
  const cachePath = path.join(cacheDir, `${stemOf(p.file)}.jpg`);
  const thumbSrc = fs.existsSync(cachePath) ? cachePath : remotePreview(p);

  const saveAnn = (file, annotation) => {
    const next = { ...ann, [file]: annotation };
    setAnn(next);
    persist(next, cover, position);
  };
  const setCoverTo = (file) => {
    const pos = file === cover ? position : null;
    setCover(file);
    setPosition(pos);
    persist(ann, file, pos);
  };
  // Open the position view for the cover. In cover mode the highlighted photo
  // becomes the cover first; in annotate mode `c` does that, `p` just positions.
  const startPositioning = () => {
    if (mode === 'cover' && p.file !== cover) setCoverTo(p.file);
    setPositioning(true);
  };
  const savePosition = (pos) => {
    setPosition(pos);
    persist(ann, cover, pos);
    setPositioning(false);
    if (mode === 'cover') exit();
  };
  // Position view source: the full-size local derivative, else R2's fallback
  // JPEG (bigger than the thumbnail rendition — framing needs the detail).
  const coverPhoto = photos.find((x) => x.file === cover) || p;
  const coverCache = path.join(cacheDir, `${stemOf(coverPhoto.file)}.jpg`);
  const positionSrc = fs.existsSync(coverCache) ? coverCache : coverPhoto.fallback || remotePreview(coverPhoto);

  // Layout geometry from terminal size.
  // Wide terminals: list | image side by side. Narrow ones: image stacked
  // under a shorter list, so the preview is never hidden.
  const wide = size.columns >= 90;
  const listWidth = wide ? Math.min(46, Math.floor(size.columns * 0.45)) : size.columns;
  const bodyHeight = Math.max(6, size.rows - 7);
  const listHeight = wide ? bodyHeight : Math.max(3, Math.floor(bodyHeight * 0.35));
  const thumbCols = wide ? Math.max(10, Math.min(size.columns - listWidth - 4, 72)) : Math.max(10, size.columns - 2);
  const thumbRows = wide ? Math.max(4, bodyHeight) : Math.max(3, bodyHeight - listHeight - 1);

  useInput(
    (input, key) => {
      if (input === 'q' || key.escape) return requestQuit();
      if (key.upArrow || input === 'k') return setIndex((i) => Math.max(0, i - 1));
      if (key.downArrow || input === 'j') return setIndex((i) => Math.min(photos.length - 1, i + 1));
      if (input === 'o') {
        openViewer(p.file);
        if (mode !== 'cover') setEditing(true);
        return;
      }
      if (input === 'c' && mode !== 'cover') return setCoverTo(p.file);
      if (input === 'p' && cover) return startPositioning();
      if (key.return || input === 'e') {
        if (mode === 'cover') return startPositioning();
        setEditing(true);
      }
    },
    { isActive: !editing && !quitting && !positioning },
  );

  if (positioning) {
    return html`<${Box} flexDirection="column" width=${size.columns} height=${size.rows}>
      <${Box}>
        <${Text} bold>Cover position · ${title}  </${Text}>
        <${Text} dimColor>${coverPhoto.file}</${Text}>
      </${Box}>
      <${Box} marginTop=${1}>
        <${PositionView}
          src=${positionSrc}
          initial=${position}
          cols=${Math.max(20, size.columns - 2)}
          rows=${Math.max(10, size.rows - 5)}
          onSave=${savePosition}
          onCancel=${() => setPositioning(false)}
          onBrowser=${openBrowserPicker
            ? (pos, onUrl) =>
                openBrowserPicker(coverPhoto, pos, onUrl, (np) => {
                  setPosition(np);
                  persist(ann, cover, np);
                })
            : undefined}
        />
      </${Box}>
    </${Box}>`;
  }

  return html`<${Box} flexDirection="column" width=${size.columns} height=${size.rows}>
    <${Box}>
      <${Text} bold>${mode === 'cover' ? 'Choose cover' : 'Annotate'} · ${title}  </${Text}>
      <${Text} dimColor>${index + 1}/${photos.length}${cover === p.file ? '  ★ cover' : ''}</${Text}>
    </${Box}>

    <${Box} height=${bodyHeight} marginTop=${1} flexDirection=${wide ? 'row' : 'column'}>
      <${PhotoList} photos=${photos} index=${index} ann=${ann} cover=${cover} height=${listHeight} width=${listWidth} />
      <${Box} marginLeft=${wide ? 2 : 1} marginTop=${wide ? 0 : 1}>
        <${Thumbnail} file=${thumbSrc} cols=${thumbCols} rows=${thumbRows} missing=${!thumbSrc} />
      </${Box}>
    </${Box}>

    ${quitting
      ? html`<${Box} marginTop=${1}>
          <${Text} color="cyan">Commit &amp; push now? </${Text}><${Text} dimColor>(y / N) — triggers the deploy</${Text}>
        </${Box}>`
      : editing
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
