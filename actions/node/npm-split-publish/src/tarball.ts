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

/** The tarball's package/package.json, parsed. Throws if it has none. */
export function readPackedManifest(file: string): { name?: unknown; version?: unknown } {
  const tar = zlib.gunzipSync(fs.readFileSync(file));
  let offset = 0;
  let longName: string | undefined;
  while (offset + BLOCK <= tar.length) {
    const header = tar.subarray(offset, offset + BLOCK);
    if (header.every((b) => b === 0)) break;

    const size = parseInt(field(header, 124, 12).trim() || '0', 8);
    const type = field(header, 156, 1);
    const prefix = field(header, 345, 155);
    const name = longName ?? (prefix ? `${prefix}/${field(header, 0, 100)}` : field(header, 0, 100));
    longName = undefined;
    const body = tar.subarray(offset + BLOCK, offset + BLOCK + size);
    offset += BLOCK + Math.ceil(size / BLOCK) * BLOCK;

    if (type === 'L') {
      longName = body.toString('utf8').replace(/\0.*$/s, '');
      continue;
    }
    if ((type === '0' || type === '') && name === 'package/package.json') {
      return JSON.parse(body.toString('utf8'));
    }
  }
  throw new Error(`${file}: no package/package.json`);
}
