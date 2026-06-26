// Run the Astro dev server (with the local-image middleware) so trips render
// before any R2 upload. See DESIGN.md §6.
import fs from 'node:fs';
import path from 'node:path';
import { execa } from 'execa';
import * as ui from '../ui.js';
import { requireRepoRoot } from '../paths.js';

export async function preview() {
  const root = requireRepoRoot();
  const siteDir = path.join(root, 'site');

  if (!fs.existsSync(path.join(siteDir, 'node_modules'))) {
    ui.step('installing site dependencies (first run)…');
    await execa('npm', ['install'], { cwd: siteDir, stdio: 'inherit' });
  }

  ui.step('starting Astro dev server — Ctrl-C to stop');
  await execa('npm', ['run', 'dev'], { cwd: siteDir, stdio: 'inherit' });
}
