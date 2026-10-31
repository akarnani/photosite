// Load/save the committed, NON-SECRET photosite.config.toml. Secrets never go here.
import fs from 'node:fs';
import { parse, stringify } from 'smol-toml';
import { CONFIG_FILENAME } from './paths.js';
import path from 'node:path';

export const DEFAULT_CONFIG = {
  site: { title: 'Below the Surface', author: '', publicBaseUrl: 'https://img.example.com' },
  r2: { remote: 'r2', bucket: 'dive-photos' },
  images: { widths: [480, 960, 1600, 2400], quality: 80, fallbackWidth: 1600 },
  keywords: { speciesFromKeywords: false, speciesRoot: 'Species' },
};

const HEADER = `# photosite project config — committed, NON-SECRET.
# Bucket names and public URLs are not secrets; they ship in HTML. R2
# credentials live only in your rclone remote. Re-run \`photosite setup\` to edit.
`;

// Strip any trailing slash so URL joins never double up.
export const stripTrailingSlash = (u) => String(u || '').replace(/\/+$/, '');

export function mergeDefaults(cfg = {}) {
  return {
    site: { ...DEFAULT_CONFIG.site, ...(cfg.site || {}) },
    r2: { ...DEFAULT_CONFIG.r2, ...(cfg.r2 || {}) },
    images: { ...DEFAULT_CONFIG.images, ...(cfg.images || {}) },
    keywords: { ...DEFAULT_CONFIG.keywords, ...(cfg.keywords || {}) },
  };
}

export function loadConfig(root) {
  const file = path.join(root, CONFIG_FILENAME);
  if (!fs.existsSync(file)) return null;
  return mergeDefaults(parse(fs.readFileSync(file, 'utf8')));
}

export function saveConfig(root, cfg) {
  const file = path.join(root, CONFIG_FILENAME);
  fs.writeFileSync(file, HEADER + '\n' + stringify(cfg) + '\n');
}
