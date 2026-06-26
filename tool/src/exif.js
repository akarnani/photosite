// exiftool wrapper + normalization into the photos.json metadata shape.
import { execa } from 'execa';

const TAGS = [
  'GPSLatitude', 'GPSLongitude', 'GPSLatitudeRef', 'GPSLongitudeRef', 'GPSAltitude',
  'DateTimeOriginal', 'CreateDate', 'Make', 'Model', 'LensModel', 'FNumber',
  'ExposureTime', 'ISO', 'FocalLength', 'Description', 'Caption-Abstract',
  'Subject', 'HierarchicalSubject', 'ImageWidth', 'ImageHeight',
];

export async function available() {
  try {
    await execa('exiftool', ['-ver']);
    return true;
  } catch {
    return false;
  }
}

// Run one batched exiftool call over all files. `-n` yields numeric values.
// Returns an array of records, each keyed by tag name plus SourceFile.
export async function readMetadata(files) {
  const args = ['-j', '-n', ...TAGS.map((t) => `-${t}`), ...files];
  const { stdout } = await execa('exiftool', args, { maxBuffer: 256 * 1024 * 1024 });
  return JSON.parse(stdout);
}

const toArray = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);
const num = (v) => (typeof v === 'number' ? v : v == null || v === '' ? null : Number(v));

function signed(value, ref, negRef) {
  const v = num(value);
  if (v == null) return null;
  return ref === negRef ? -Math.abs(v) : Math.abs(v);
}

// "2025:03:06 09:05:00" → "2025-03-06T09:05:00"
function toIso(dt) {
  if (!dt) return null;
  const m = String(dt).match(/^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
  if (!m) return null;
  const [, Y, Mo, D, H, Mi, S] = m;
  return `${Y}-${Mo}-${D}T${H}:${Mi}:${S}`;
}

function joinCamera(make, model) {
  make = (make || '').trim();
  model = (model || '').trim();
  if (!make && !model) return null;
  if (model && make && model.toLowerCase().startsWith(make.toLowerCase())) return model;
  return [make, model].filter(Boolean).join(' ') || null;
}

// Extract species leaves from hierarchical keywords + the flat `sp:` convention.
export function extractSpecies(subject, hier, speciesRoot) {
  const out = new Set();
  const prefix = `${speciesRoot}|`;
  for (const h of hier) {
    if (typeof h === 'string' && h.startsWith(prefix)) {
      const leaf = h.split('|').pop().trim();
      if (leaf) out.add(leaf);
    }
  }
  for (const s of subject) {
    if (typeof s === 'string' && /^sp:/i.test(s)) {
      const name = s.slice(3).trim();
      if (name) out.add(name);
    }
  }
  return [...out];
}

// Turn one raw exiftool record into the EXIF-derived fields of a photo record.
export function normalize(rec, cfg) {
  const lat = signed(rec.GPSLatitude, rec.GPSLatitudeRef, 'S');
  const lon = signed(rec.GPSLongitude, rec.GPSLongitudeRef, 'W');
  const gps = lat != null && lon != null ? { lat, lon } : null;

  const subject = toArray(rec.Subject).map(String);
  const hier = toArray(rec.HierarchicalSubject).map(String);
  const species = cfg.keywords.speciesFromKeywords
    ? extractSpecies(subject, hier, cfg.keywords.speciesRoot)
    : [];

  return {
    date: toIso(rec.DateTimeOriginal || rec.CreateDate),
    gps,
    camera: joinCamera(rec.Make, rec.Model),
    lens: (rec.LensModel || '').trim() || null,
    exposure: {
      fNumber: num(rec.FNumber),
      exposureTime: num(rec.ExposureTime),
      iso: num(rec.ISO),
      focalLength: num(rec.FocalLength),
    },
    caption: (rec.Description || rec['Caption-Abstract'] || '').trim() || null,
    species,
    keywords: subject,
  };
}
