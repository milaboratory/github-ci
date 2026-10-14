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

/** The `path` record of a pax extended header ("<len> path=<value>\n" records). */
function paxPath(body: Buffer): string | undefined {
  const text = body.toString('utf8');
  let offset = 0;
  while (offset < text.length) {
    const space = text.indexOf(' ', offset);
    if (space === -1) break;
    const length = parseInt(text.slice(offset, space), 10);
    if (!(length > 0)) break;
    const record = text.slice(space + 1, offset + length - 1);
    if (record.startsWith('path=')) return record.slice('path='.length);
    offset += length;
  }
  return undefined;
}

/**
 * The tarball's package/package.json, parsed. npm unpacks a tarball with its
 * top directory stripped and the last package.json written wins, so anything
 * our check and npm could read differently is rejected: entries outside
 * package/, or more than one package/package.json.
 */
export function readPackedManifest(file: string): { name?: unknown; version?: unknown; repository?: unknown } {
  const tar = zlib.gunzipSync(fs.readFileSync(file));
  let offset = 0;
  let nextPath: string | undefined;
  let manifest: Buffer | undefined;

  while (offset + BLOCK <= tar.length) {
    const header = tar.subarray(offset, offset + BLOCK);
    if (header.every((b) => b === 0)) break;

    const size = parseInt(field(header, 124, 12).trim() || '0', 8);
    const type = field(header, 156, 1);
    const prefix = field(header, 345, 155);
    const headerPath = prefix ? `${prefix}/${field(header, 0, 100)}` : field(header, 0, 100);
    const body = tar.subarray(offset + BLOCK, offset + BLOCK + size);
    offset += BLOCK + Math.ceil(size / BLOCK) * BLOCK;

    if (type === 'L') {
      nextPath = body.toString('utf8').replace(/\0.*$/s, '');
      continue;
    }
    if (type === 'x') {
      nextPath = paxPath(body) ?? nextPath;
      continue;
    }
    if (type === 'g') {
      continue;
    }

    const entryPath = (nextPath ?? headerPath).replace(/^\.\//, '');
    nextPath = undefined;
    if (!entryPath.startsWith('package/')) {
      throw new Error(`${file}: entry '${entryPath}' is outside package/`);
    }
    if (entryPath === 'package/package.json') {
      if (manifest) throw new Error(`${file}: more than one package/package.json`);
      if (type !== '0' && type !== '') throw new Error(`${file}: package/package.json is not a regular file`);
      manifest = body;
    }
  }
  if (!manifest) {
    throw new Error(`${file}: no package/package.json`);
  }
  return JSON.parse(manifest.toString('utf8'));
}
