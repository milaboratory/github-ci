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
   * publishConfig.tag / publishConfig.access, '' when unset. They travel here
   * because `npm publish <tarball>` ignores publishConfig inside the tarball.
   */
  tag: string;
  access: string;
}

const FIELDS: (keyof ManifestEntry)[] = ['name', 'version', 'file', 'registry', 'tag', 'access'];

export function parseManifest(text: string): ManifestEntry[] {
  return text
    .split('\n')
    .map((line, i) => ({ line: line.trim(), lineNo: i + 1 }))
    .filter(({ line }) => line !== '')
    .map(({ line, lineNo }) => {
      let value: unknown;
      try {
        value = JSON.parse(line);
      } catch {
        throw new Error(`${MANIFEST_FILE}:${lineNo}: not JSON`);
      }
      if (typeof value !== 'object' || value === null) {
        throw new Error(`${MANIFEST_FILE}:${lineNo}: not an object`);
      }
      const record = value as Record<string, unknown>;
      for (const field of FIELDS) {
        if (typeof record[field] !== 'string') {
          throw new Error(`${MANIFEST_FILE}:${lineNo}: '${field}' must be a string`);
        }
      }
      for (const field of ['name', 'version', 'file', 'registry'] as const) {
        if (record[field] === '') {
          throw new Error(`${MANIFEST_FILE}:${lineNo}: '${field}' is empty`);
        }
      }
      if (path.basename(record.file as string) !== record.file) {
        throw new Error(`${MANIFEST_FILE}:${lineNo}: 'file' must be a basename`);
      }
      return Object.fromEntries(FIELDS.map((f) => [f, record[f]])) as unknown as ManifestEntry;
    });
}

export function formatManifest(entries: ManifestEntry[]): string {
  return entries.map((e) => JSON.stringify(Object.fromEntries(FIELDS.map((f) => [f, e[f]]))) + '\n').join('');
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
