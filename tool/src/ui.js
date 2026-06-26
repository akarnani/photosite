// Friendly colored status lines and prompt helpers shared by all commands.
import pc from 'picocolors';
import prompts from 'prompts';

export const step = (msg) => console.log(`${pc.cyan('→')} ${msg}`);
export const ok = (msg) => console.log(`${pc.green('✓')} ${msg}`);
export const warn = (msg) => console.log(`${pc.yellow('!')} ${msg}`);
export const error = (msg) => console.error(`${pc.red('✗')} ${msg}`);
export const info = (msg) => console.log(pc.dim(msg));
export const heading = (msg) => console.log(`\n${pc.bold(msg)}`);
export const value = (msg) => pc.cyan(msg);

// Print an error and exit non-zero.
export function fail(msg, code = 1) {
  error(msg);
  process.exit(code);
}

// Wrap prompts() so that cancelling (Ctrl-C / Esc) exits cleanly with no
// partial writes, instead of returning a half-filled answers object.
export async function ask(questions) {
  let cancelled = false;
  const answers = await prompts(questions, {
    onCancel: () => {
      cancelled = true;
      return false; // stop asking remaining questions
    },
  });
  if (cancelled) {
    info('Cancelled — no changes made.');
    process.exit(0);
  }
  return answers;
}

// Single confirm prompt → boolean.
export async function confirm(message, initial = false) {
  const { yes } = await ask({ type: 'confirm', name: 'yes', message, initial });
  return yes;
}
