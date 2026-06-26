import React from 'react';
import { Box, Text } from 'ink';
import htm from 'htm';
import { useThumbnail } from './hooks.js';

const html = htm.bind(React.createElement);

export default function Thumbnail({ file, cols, rows, missing }) {
  const text = useThumbnail(missing ? null : file, cols, rows);
  if (missing) {
    return html`<${Box} height=${rows} alignItems="center" justifyContent="center">
      <${Text} dimColor>no local preview cached</${Text}>
    </${Box}>`;
  }
  if (!text) {
    return html`<${Box} height=${rows} alignItems="center" justifyContent="center">
      <${Text} dimColor>rendering…</${Text}>
    </${Box}>`;
  }
  return html`<${Text}>${text}</${Text}>`;
}
