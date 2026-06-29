// Shared publishing helpers run after a successful trip operation. Pushing to
// the default branch triggers the Cloudflare Pages deploy.
import { execa } from 'execa';
import * as ui from './ui.js';

// Non-interactive commit + push (the decision was already made — e.g. inside the
// TUI, where a readline prompt afterwards can't read stdin). Never throws.
export async function commitAndPush({ root, message }) {
  try {
    await execa('git', ['add', '-A'], { cwd: root, stdio: 'inherit' });
    await execa('git', ['commit', '-m', message], { cwd: root, stdio: 'inherit' });
    await execa('git', ['push'], { cwd: root, stdio: 'inherit' });
    ui.ok('pushed — Cloudflare Pages will rebuild the site');
  } catch (e) {
    ui.warn(`git step did not complete: ${e.shortMessage || e.message}`);
    ui.info('Resolve manually, or run `photosite push`.');
  }
}

export async function maybePublish({ root, upload, message }) {
  if (upload === false) {
    ui.info('Skipping commit/push — images were not uploaded (--no-upload).');
    ui.info('Run `photosite upload` to push the images to R2, then `photosite push` to publish.');
    return;
  }

  if (!(await ui.confirm('Commit & push now? (triggers the Cloudflare Pages deploy)', false))) {
    ui.info('Done. Run `photosite push` when you are ready to publish.');
    return;
  }

  try {
    await execa('git', ['add', '-A'], { cwd: root, stdio: 'inherit' });
    await execa('git', ['commit', '-m', message], { cwd: root, stdio: 'inherit' });
    await execa('git', ['push'], { cwd: root, stdio: 'inherit' });
    ui.ok('pushed — Cloudflare Pages will rebuild the site');
  } catch (e) {
    ui.warn(`git step did not complete: ${e.shortMessage || e.message}`);
    ui.info('Resolve manually with git, then push to publish.');
  }
}
