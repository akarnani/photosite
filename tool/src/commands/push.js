// Commit any pending changes and push — for when add/update/annotate was run
// without publishing (e.g. you wanted to preview first). Pushing triggers the
// Cloudflare Pages deploy.
import { execa } from 'execa';
import * as ui from '../ui.js';
import { requireRepoRoot } from '../paths.js';

export async function push(message) {
  const root = requireRepoRoot();

  try {
    await execa('git', ['rev-parse', '--is-inside-work-tree'], { cwd: root });
  } catch {
    ui.fail('Not a git repository — nothing to push.');
  }

  const { stdout } = await execa('git', ['status', '--porcelain'], { cwd: root });
  if (stdout.trim()) {
    let msg = message;
    if (!msg) {
      msg = (await ui.ask({ type: 'text', name: 'm', message: 'Commit message', initial: 'Update photos' })).m;
    }
    ui.step('committing changes');
    await execa('git', ['add', '-A'], { cwd: root, stdio: 'inherit' });
    await execa('git', ['commit', '-m', msg || 'Update photos'], { cwd: root, stdio: 'inherit' });
  } else {
    ui.info('Working tree clean — nothing new to commit.');
  }

  ui.step('pushing');
  try {
    await execa('git', ['push'], { cwd: root, stdio: 'inherit' });
  } catch (e) {
    ui.fail(`git push failed: ${e.shortMessage || e.message}`);
  }
  ui.ok('pushed — Cloudflare Pages will rebuild the site');
}
