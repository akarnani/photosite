// Thin wrapper around the rclone CLI. All R2 access goes through here.
import { execa } from 'execa';

export async function available() {
  try {
    await execa('rclone', ['version']);
    return true;
  } catch {
    return false;
  }
}

export async function listRemotes() {
  const { stdout } = await execa('rclone', ['listremotes']);
  return stdout
    .split('\n')
    .map((s) => s.trim().replace(/:$/, ''))
    .filter(Boolean);
}

// Read a remote's config back as key→value (includes secrets — callers must
// only read non-secret fields and never display them). Returns null if missing.
export async function showRemote(name) {
  try {
    const { stdout } = await execa('rclone', ['config', 'show', name]);
    const out = {};
    for (const line of stdout.split('\n')) {
      const m = line.match(/^([A-Za-z0-9_-]+)\s*=\s*(.*)$/);
      if (m) out[m[1]] = m[2].trim();
    }
    return out;
  } catch {
    return null;
  }
}

// Derive the Cloudflare account id from a stored R2 endpoint, if present.
export function accountIdFromRemote(remoteConf) {
  const ep = remoteConf?.endpoint || '';
  const m = ep.match(/^https:\/\/([^.]+)\.r2\.cloudflarestorage\.com/i);
  return m ? m[1] : '';
}

// Create or update an S3-compatible R2 remote. Empty access key / secret are
// omitted so re-running setup without re-entering them preserves the stored
// credential.
export async function upsertRemote({ name, accountId, accessKeyId, secret }) {
  const remotes = await listRemotes();
  const exists = remotes.includes(name);

  const settings = {
    provider: 'Cloudflare',
    region: 'auto',
    acl: 'private',
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
  };
  if (accessKeyId) settings.access_key_id = accessKeyId;
  if (secret) settings.secret_access_key = secret;

  const pairs = Object.entries(settings).flatMap(([k, v]) => [k, String(v)]);
  const args = exists
    ? ['config', 'update', name, ...pairs, '--non-interactive']
    : ['config', 'create', name, 's3', ...pairs, '--non-interactive'];

  await execa('rclone', args);
  return { action: exists ? 'update' : 'create' };
}

// Upload a local dir to <remote>:<bucket>/<prefix>. --checksum makes unchanged
// files cheap (no re-upload).
export async function copyDir({ remote, bucket, prefix, localDir }) {
  const dest = `${remote}:${bucket}/${prefix}`;
  await execa('rclone', ['copy', localDir, dest, '--checksum'], { stdio: 'inherit' });
}

// List object keys under <remote>:<bucket>/<prefix> (recursive, files only).
export async function listKeys({ remote, bucket, prefix }) {
  const dest = `${remote}:${bucket}/${prefix}`;
  try {
    const { stdout } = await execa('rclone', ['lsf', dest, '--files-only', '-R']);
    return stdout
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
  } catch {
    return []; // prefix may not exist yet
  }
}

export async function deleteKey({ remote, bucket, prefix, key }) {
  const dest = `${remote}:${bucket}/${prefix}${key}`;
  await execa('rclone', ['deletefile', dest]);
}
