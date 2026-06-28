// Launch the TUI on the alternate screen buffer, restoring the terminal on exit.
import React from 'react';
import { render } from 'ink';
import htm from 'htm';
import App from './App.js';

const html = htm.bind(React.createElement);

const ALT_ON = '\x1b[?1049h';
const ALT_OFF = '\x1b[?1049l';
const CURSOR_ON = '\x1b[?25h';

// Hand stdin back to plain line mode after the TUI: drop raw mode and Ink's
// listeners, and discard any buffered keystroke (e.g. the Esc/q used to quit) so
// a following prompts() session doesn't read it as an answer or a cancel.
function resetStdin() {
  const stdin = process.stdin;
  try {
    if (stdin.isTTY && stdin.setRawMode) stdin.setRawMode(false);
  } catch {
    /* ignore */
  }
  stdin.removeAllListeners('keypress');
  stdin.removeAllListeners('data');
  stdin.removeAllListeners('readable');
  stdin.pause();
  try {
    while (stdin.read() !== null) {
      /* drain buffered input */
    }
  } catch {
    /* ignore */
  }
}

export async function runTui(props) {
  process.stdout.write(ALT_ON);
  try {
    const app = render(html`<${App} ...${props} />`);
    await app.waitUntilExit();
  } finally {
    process.stdout.write(CURSOR_ON + ALT_OFF);
    await new Promise((r) => setTimeout(r, 20)); // let Ink finish tearing down
    resetStdin();
  }
}
