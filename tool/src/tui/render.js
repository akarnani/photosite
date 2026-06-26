// Launch the TUI on the alternate screen buffer, restoring the terminal on exit.
import React from 'react';
import { render } from 'ink';
import htm from 'htm';
import App from './App.js';

const html = htm.bind(React.createElement);

const ALT_ON = '\x1b[?1049h';
const ALT_OFF = '\x1b[?1049l';
const CURSOR_ON = '\x1b[?25h';

export async function runTui(props) {
  process.stdout.write(ALT_ON);
  try {
    const app = render(html`<${App} ...${props} />`);
    await app.waitUntilExit();
  } finally {
    process.stdout.write(CURSOR_ON + ALT_OFF);
  }
}
