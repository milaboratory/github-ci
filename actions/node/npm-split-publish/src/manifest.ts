// The contract between the two halves of the split publish: `pack` writes
// manifest.jsonl next to the tarballs, `publish` uploads them in file order.

import * as fs from 'fs';
import * as path from 'path';

export const MANIFEST_FILE = 'manifest.jsonl';

/** One packed package, in upload order (dependencies first). */
export interface ManifestEntry {
  name: string;
  version: string;
  /** Tarball basename inside the manifest's directory. */
  file: string;
  /** Registry URL the package is published to, e.g. https://registry.npmjs.org/. */
  registry: string;
  /**
   * publishConfig.tag / publishConfig.access, '' when unset. The upload passes
   * them as flags: pnpm ignores a packed publishConfig.tag, and a flag wins
   * over a packed publishConfig.access.
   */
  tag: string;
  access: string;
}

const FIELDS: (keyof ManifestEntry)[] = ['name', 'version', 'file', 'registry', 'tag', 'access'];

// The manifest crosses from the build job to the upload job as an artifact,
// so the upload job does not trust it: every value ends up in pnpm's argv and
// must not be readable as an option.
const NAME = /^(@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/;
const VERSION = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$/;
const TAG = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const FILE = /^[A-Za-z0-9][A-Za-z0-9._-]*\.tgz$/;
const ACCESS = ['', 'public', 'restricted'];

/** Throws when an entry's values are not what pack writes. */
export function validateEntry(value: unknown, where: string): ManifestEntry {
  if (typeof value !== 'object' || value === null) {
    throw new Error(`${where}: not an object`);
  }
  const record = value as Record<string, unknown>;
  for (const field of FIELDS) {
    if (typeof record[field] !== 'string') {
      throw new Error(`${where}: '${field}' must be a string`);
    }
  }
  const e = Object.fromEntries(FIELDS.map((f) => [f, record[f]])) as unknown as ManifestEntry;
  const fail = (field: keyof ManifestEntry, rule: string) => {
    throw new Error(`${where}: '${field}' ${rule} (got ${JSON.stringify(e[field])})`);
  };
  if (!NAME.test(e.name)) fail('name', 'is not a valid npm package name');
  if (!VERSION.test(e.version)) fail('version', 'is not a semver version');
  if (!FILE.test(e.file)) fail('file', 'must be a .tgz basename');
  if (!e.registry.startsWith('https://')) fail('registry', 'must be an https URL');
  if (e.tag !== '' && !TAG.test(e.tag)) fail('tag', 'is not a valid dist-tag');
  if (!ACCESS.includes(e.access)) fail('access', "must be '', 'public' or 'restricted'");
  return e;
}

export function parseManifest(text: string): ManifestEntry[] {
  return text
    .split('\n')
    .map((line, i) => ({ line: line.trim(), lineNo: i + 1 }))
    .filter(({ line }) => line !== '')
    .map(({ line, lineNo }) => {
      const where = `${MANIFEST_FILE}:${lineNo}`;
      let value: unknown;
      try {
        value = JSON.parse(line);
      } catch {
        throw new Error(`${where}: not JSON`);
      }
      return validateEntry(value, where);
    });
}

/** Validates too, so a bad value fails in the build job, not at upload. */
export function formatManifest(entries: ManifestEntry[]): string {
  return entries
    .map((e) => validateEntry(e, `${MANIFEST_FILE} entry ${e.name}`))
    .map((e) => JSON.stringify(Object.fromEntries(FIELDS.map((f) => [f, e[f]]))) + '\n')
    .join('');
}

/** Entries of `<dir>/manifest.jsonl`; none when the file is missing or empty. */
export function readManifest(dir: string): ManifestEntry[] {
  const file = path.join(dir, MANIFEST_FILE);
  if (!fs.existsSync(file)) {
    return [];
  }
  return parseManifest(fs.readFileSync(file, 'utf8'));
}

export function writeManifest(dir: string, entries: ManifestEntry[]): void {
  fs.writeFileSync(path.join(dir, MANIFEST_FILE), formatManifest(entries));
}
