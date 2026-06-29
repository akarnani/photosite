// Launch the TUI on the alternate screen buffer, restoring the terminal on exit.
import React from 'react';
import { render } from 'ink';
import htm from 'htm';
import App from './App.js';

const html = htm.bind(React.createElement);

const ALT_ON = '\x1b[?1049h';
const ALT_OFF = '\x1b[?1049l';
const CURSOR_ON = '\x1b[?25h';

// Run the Ink app on the alternate screen, restoring the terminal on exit. We
// never run a readline prompt after this (prompts can't read stdin once Ink's
// useInput has touched it), so the publish question is asked inside Ink.
export async function runTui(props) {
  process.stdout.write(ALT_ON);
  try {
    const app = render(html`<${App} ...${props} />`);
    await app.waitUntilExit();
  } finally {
    process.stdout.write(CURSOR_ON + ALT_OFF);
  }
}
