// Reads package/package.json out of an npm tarball (gzip + ustar) without
// external tools, to check a tarball is what its manifest entry says.

import * as fs from 'fs';
import * as zlib from 'zlib';

const BLOCK = 512;

function field(header: Buffer, offset: number, length: number): string {
  const raw = header.subarray(offset, offset + length);
  const end = raw.indexOf(0);
  return raw.subarray(0, end === -1 ? raw.length : end).toString('utf8');
}

/** Records of a pax extended header ("<len> <key>=<value>\n" each). */
function paxRecords(body: Buffer): Map<string, string> {
  const records = new Map<string, string>();
  const text = body.toString('utf8');
  let offset = 0;
  while (offset < text.length) {
    const space = text.indexOf(' ', offset);
    if (space === -1) break;
    const length = parseInt(text.slice(offset, space), 10);
    if (!(length > 0)) break;
    const record = text.slice(space + 1, offset + length - 1);
    const eq = record.indexOf('=');
    if (eq > 0) records.set(record.slice(0, eq), record.slice(eq + 1));
    offset += length;
  }
  return records;
}

/**
 * The path as an unpacker resolves it: no leading ./, no empty or `.`
 * segments. `..` is refused rather than resolved.
 */
function normalizeEntryPath(raw: string, file: string): string {
  const segments = raw.split('/').filter((seg) => seg !== '' && seg !== '.');
  if (segments.includes('..')) {
    throw new Error(`${file}: entry '${raw}' contains '..'`);
  }
  return segments.join('/');
}

// Regular file, directory, and the headers that describe the next entry.
const FILE_TYPES = new Set(['0', '', '5']);

/**
 * The tarball's package/package.json, parsed. npm unpacks a tarball with its
 * top directory stripped and the last package.json written wins, so anything
 * this reader and npm could read differently is rejected: entries outside
 * package/ (after path normalization), `..`, more than one package.json,
 * links and other special entries, and pax headers that change sizes.
 */
export function readPackedManifest(file: string): { name?: unknown; version?: unknown; repository?: unknown } {
  const tar = zlib.gunzipSync(fs.readFileSync(file));
  let offset = 0;
  let nextPath: string | undefined;
  let manifest: Buffer | undefined;

  while (offset + BLOCK <= tar.length) {
    const header = tar.subarray(offset, offset + BLOCK);
    if (header.every((b) => b === 0)) break;

    const rawSize = field(header, 124, 12).trim();
    if (!/^[0-7]*$/.test(rawSize)) {
      // Base-256 sizes and the like: stop rather than mis-step past entries.
      throw new Error(`${file}: unsupported size field in a tar header`);
    }
    const size = parseInt(rawSize || '0', 8);
    const type = field(header, 156, 1);
    const prefix = field(header, 345, 155);
    const headerPath = prefix ? `${prefix}/${field(header, 0, 100)}` : field(header, 0, 100);
    const body = tar.subarray(offset + BLOCK, offset + BLOCK + size);
    offset += BLOCK + Math.ceil(size / BLOCK) * BLOCK;

    if (type === 'L') {
      nextPath = body.toString('utf8').replace(/\0.*$/s, '');
      continue;
    }
    if (type === 'x' || type === 'g') {
      const records = paxRecords(body);
      if (records.has('size')) {
        throw new Error(`${file}: pax size records are not supported`);
      }
      if (type === 'x' && records.has('path')) nextPath = records.get('path');
      continue;
    }
    if (!FILE_TYPES.has(type)) {
      throw new Error(`${file}: entry '${nextPath ?? headerPath}' has unsupported type '${type}'`);
    }

    const entryPath = normalizeEntryPath(nextPath ?? headerPath, file);
    nextPath = undefined;
    if (entryPath === 'package' && type === '5') {
      continue;
    }
    if (!entryPath.startsWith('package/')) {
      throw new Error(`${file}: entry '${entryPath}' is outside package/`);
    }
    if (entryPath === 'package/package.json') {
      if (manifest) throw new Error(`${file}: more than one package/package.json`);
      if (type === '5') throw new Error(`${file}: package/package.json is not a regular file`);
      manifest = body;
    }
  }
  if (!manifest) {
    throw new Error(`${file}: no package/package.json`);
  }
  return JSON.parse(manifest.toString('utf8'));
}
