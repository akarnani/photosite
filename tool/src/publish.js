// Shared "commit & push now?" helper run after a successful trip operation.
// Pushing to the default branch triggers the Cloudflare Pages deploy.
import { execa } from 'execa';
import * as ui from './ui.js';

export async function maybePublish({ root, upload, message }) {
  if (upload === false) {
    ui.info('Skipping commit/push — images were not uploaded (--no-upload).');
    ui.info('Re-run without --no-upload to upload, then `photosite push` to publish.');
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
