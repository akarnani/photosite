// Repo-root resolution and the canonical set of paths every command uses.
import fs from 'node:fs';
import path from 'node:path';

export const CONFIG_FILENAME = 'photosite.config.toml';

// Walk up from `start` looking for photosite.config.toml. Returns the dir or null.
export function findRepoRoot(start = process.cwd()) {
  let dir = path.resolve(start);
  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (fs.existsSync(path.join(dir, CONFIG_FILENAME))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export function requireRepoRoot(start) {
  const root = findRepoRoot(start);
  if (!root) {
    throw new Error(
      `Could not find ${CONFIG_FILENAME} in this or any parent directory.\n` +
        `Run \`photosite setup\` from your project root to create it.`,
    );
  }
  return root;
}

// All paths derived from the repo root.
export function paths(root) {
  const contentDir = path.join(root, 'site', 'src', 'content', 'trips');
  const cacheDir = path.join(root, 'site', '.image-cache');
  return {
    root,
    config: path.join(root, CONFIG_FILENAME),
    contentDir,
    cacheDir,
    tripDir: (slug) => path.join(contentDir, slug),
    cacheTripDir: (slug) => path.join(cacheDir, slug),
  };
}
