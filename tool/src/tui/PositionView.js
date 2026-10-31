// Cover position view: the cover rendered in the frames the site crops it to
// (hero banner on a desktop, link-preview card, hero on a phone). Arrow keys
// move the photo inside the frames; Enter saves trip.yaml `coverPosition`.
// `b` hands off to the browser picker (src/position/) for pixel-exact drags.
import React, { useEffect, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import htm from 'htm';
import { preparePhoto, renderCrop } from './thumb.js';
import { loadImage } from './hooks.js';

const html = htm.bind(React.createElement);
const clamp = (n) => Math.min(100, Math.max(0, n));

// Frame shapes, matching the site (hero: 100vw × clamp(340px, 56vw, 620px)).
const DESKTOP = 1920 / 620;
const OG = 1200 / 630;
const PHONE = 390 / 340;

// Fit the three frames into cols × rows of terminal cells. A cell is 1 px wide
// and 2 px tall in half-block terms, so a frame of ratio r is w cols × w/r/2 rows.
function layout(cols, rows) {
  let dw = Math.min(cols, 120);
  let dRows = Math.round(dw / DESKTOP / 2);
  const maxD = Math.max(4, Math.floor((rows - 4) * 0.5));
  if (dRows > maxD) {
    dRows = maxD;
    dw = Math.round(dRows * 2 * DESKTOP);
  }
  let lowRows = Math.max(3, rows - dRows - 4);
  let ogW = Math.round(lowRows * 2 * OG);
  let phW = Math.round(lowRows * 2 * PHONE);
  if (ogW + phW + 4 > cols) {
    const k = (cols - 4) / (ogW + phW);
    lowRows = Math.max(3, Math.floor(lowRows * k));
    ogW = Math.round(lowRows * 2 * OG);
    phW = Math.round(lowRows * 2 * PHONE);
  }
  return {
    desktop: { cols: dw, rows: dRows },
    og: { cols: ogW, rows: lowRows },
    phone: { cols: phW, rows: lowRows },
  };
}

function Frame({ label, text, cols, rows }) {
  return html`<${Box} flexDirection="column" marginRight=${2}>
    ${text
      ? html`<${Text}>${text}</${Text}>`
      : html`<${Box} width=${cols} height=${rows} alignItems="center" justifyContent="center"><${Text} dimColor>rendering…</${Text}></${Box}>`}
    <${Text} dimColor>${label}</${Text}>
  </${Box}>`;
}

/**
 * @param {object} p
 * @param {string} p.src          local path or https URL of the photo
 * @param {{x,y}|null} p.initial  current coverPosition (null = centred)
 * @param {number} p.cols, p.rows available space
 * @param {(pos:{x,y}|null) => void} p.onSave   null = centred (clears the setting)
 * @param {() => void} p.onCancel
 * @param {(pos:{x,y}, onUrl:(url)=>void) => Promise<{x,y}|null|undefined>} [p.onBrowser]
 */
export default function PositionView({ src, initial, cols, rows, onSave, onCancel, onBrowser }) {
  const [pos, setPos] = useState(initial || { x: 50, y: 50 });
  const [photo, setPhoto] = useState(null);
  const [error, setError] = useState(null);
  const [frames, setFrames] = useState({});
  const [browsing, setBrowsing] = useState(false);
  const [url, setUrl] = useState(null);
  const L = layout(cols, rows);

  useEffect(() => {
    let alive = true;
    loadImage(src)
      .then((s) => preparePhoto(s))
      .then((p) => alive && setPhoto(p))
      .catch((e) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [src]);

  useEffect(() => {
    if (!photo) return;
    let alive = true;
    Promise.all(
      ['desktop', 'og', 'phone'].map((k) => renderCrop(photo, { ...L[k], pos }).then((r) => [k, r.text])),
    ).then((pairs) => alive && setFrames(Object.fromEntries(pairs)));
    return () => {
      alive = false;
    };
  }, [photo, pos.x, pos.y, cols, rows]);

  useInput(
    (input, key) => {
      if (key.escape || input === 'q') return onCancel();
      if (key.return) {
        const centred = Math.round(pos.x) === 50 && Math.round(pos.y) === 50;
        return onSave(centred ? null : { x: Math.round(pos.x), y: Math.round(pos.y) });
      }
      const d = key.shift ? 10 : 2;
      // Arrows move the photo: ↓ slides it down, revealing more of its top.
      if (key.downArrow || input === 'j') return setPos((p) => ({ ...p, y: clamp(p.y - d) }));
      if (key.upArrow || input === 'k') return setPos((p) => ({ ...p, y: clamp(p.y + d) }));
      if (key.rightArrow || input === 'l') return setPos((p) => ({ ...p, x: clamp(p.x - d) }));
      if (key.leftArrow || input === 'h') return setPos((p) => ({ ...p, x: clamp(p.x + d) }));
      if (input === 'J') return setPos((p) => ({ ...p, y: clamp(p.y - 10) }));
      if (input === 'K') return setPos((p) => ({ ...p, y: clamp(p.y + 10) }));
      if (input === 'L') return setPos((p) => ({ ...p, x: clamp(p.x - 10) }));
      if (input === 'H') return setPos((p) => ({ ...p, x: clamp(p.x + 10) }));
      if (input === 'c') return setPos({ x: 50, y: 50 });
      if (input === 'b' && onBrowser) {
        setBrowsing(true);
        onBrowser(pos, setUrl)
          .then((next) => {
            if (next !== undefined) setPos(next || { x: 50, y: 50 });
          })
          .finally(() => setBrowsing(false));
      }
    },
    { isActive: !browsing },
  );

  if (error) {
    return html`<${Box} flexDirection="column">
      <${Text} color="red">Couldn't load the photo: ${error}</${Text}>
      <${Text} dimColor>Esc to go back</${Text}>
    </${Box}>`;
  }

  const readout = `${Math.round(pos.x)}% ${Math.round(pos.y)}%`;
  return html`<${Box} flexDirection="column">
    <${Frame} label="Hero — desktop" text=${frames.desktop} ...${L.desktop} />
    <${Box} marginTop=${1}>
      <${Frame} label="Link preview" text=${frames.og} ...${L.og} />
      <${Frame} label="Hero — phone" text=${frames.phone} ...${L.phone} />
    </${Box}>
    <${Box} marginTop=${1}>
      <${Text} color="cyan">${readout}  </${Text}>
      <${Text} dimColor>
        ${browsing
          ? `adjusting in the browser${url ? ` (${url})` : ''} — press Done there to come back`
          : `←↑↓→ move photo (shift / HJKL ×5) · c centre${onBrowser ? ' · b fine-tune in browser' : ''} · Enter save · Esc cancel`}
      </${Text}>
    </${Box}>
  </${Box}>`;
}
