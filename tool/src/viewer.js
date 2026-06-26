// Open a file in the OS default viewer (best-effort, never fatal).
import fs from 'node:fs';
import { execa } from 'execa';

export async function openImage(file) {
  if (!file || !fs.existsSync(file)) return;
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
  try {
    await execa(cmd, [file], { stdio: 'ignore', detached: true, windowsHide: true });
  } catch {
    /* viewer is a convenience */
  }
}
