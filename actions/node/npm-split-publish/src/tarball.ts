// Mirrors pnpm 12 extract_manifest_from_packed.rs; see README "The upload job does not trust the artifact".

import * as fs from 'fs';
import * as zlib from 'zlib';

const BLOCK = 512;
const MANIFEST = 'package/package.json';
// Bounds runner memory; far above any package we publish.
const MAX_UNPACKED_BYTES = 2 * 1024 ** 3;
const PLAIN_TYPES = ['0', '\0', '1', '2', '5'];

export function readPackedManifest(file: string): Record<string, unknown> {
  const fail = (reason: string): never => {
    throw new Error(`${file}: ${reason}`);
  };
  const archive = gunzipOneMember(fs.readFileSync(file), fail);
  let manifest: Buffer | undefined;
  let extension: { path?: string } | undefined;
  let offset = 0;
  while (offset + BLOCK <= archive.length) {
    const header = archive.subarray(offset, offset + BLOCK);
    if (header.every((b) => b === 0)) {
      if (!archive.subarray(offset).every((b) => b === 0)) fail('data after the end of the archive');
      break;
    }
    if (checksum(header) !== number(header, 148, 8, fail)) fail('header checksum mismatch');
    const magic = header.toString('latin1', 257, 265);
    const ustar = magic === 'ustar\x0000';
    if (!ustar && magic !== 'ustar  \0') fail('not a ustar or GNU tar header');
    const type = String.fromCharCode(header[156]);
    const size = number(header, 124, 12, fail);
    const data = archive.subarray(offset + BLOCK, offset + BLOCK + size);
    if (data.length !== size) fail('truncated entry');
    offset += BLOCK + Math.ceil(size / BLOCK) * BLOCK;

    if (type === 'L' || type === 'x') {
      if (extension) fail('two extension headers for one entry');
      extension = { path: type === 'L' ? gnuLongName(data) : paxPath(data, fail) };
      continue;
    }
    if (!PLAIN_TYPES.includes(type)) fail(`unsupported entry type '${type}'`);
    const entryPath = extension?.path ?? headerPath(header, ustar);
    extension = undefined;
    if (normalize(entryPath) === MANIFEST) {
      if (manifest) fail(`more than one ${MANIFEST}`);
      if (type !== '0' && type !== '\0') fail(`${MANIFEST} is not a regular file`);
      manifest = data;
    }
  }
  if (extension) fail('extension header without an entry');
  if (!manifest) return fail(`no ${MANIFEST}`);
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(manifest)) as Record<string, unknown>;
}

function gunzipOneMember(gz: Buffer, fail: (reason: string) => never): Buffer {
  if (gz.length < 18 || gz[0] !== 0x1f || gz[1] !== 0x8b || gz[2] !== 8) fail('not a gzip file');
  const flags = gz[3];
  let pos = 10;
  if (flags & 0x04) pos += 2 + gz.readUInt16LE(pos);
  for (const flag of [0x08, 0x10]) if (flags & flag) pos = gz.indexOf(0, pos) + 1;
  if (flags & 0x02) pos += 2;
  if (pos < 10 || pos > gz.length) fail('bad gzip header');
  let inflated: { buffer: Buffer; engine: zlib.Zlib };
  try {
    inflated = zlib.inflateRawSync(gz.subarray(pos), { info: true, maxOutputLength: MAX_UNPACKED_BYTES }) as unknown as typeof inflated;
  } catch (error) {
    return fail(`cannot inflate: ${(error as Error).message}`);
  }
  const { buffer, engine } = inflated;
  if (pos + engine.bytesWritten + 8 !== gz.length) fail('data after the first gzip member');
  return buffer;
}

function checksum(header: Buffer): number {
  let sum = 0;
  for (let i = 0; i < BLOCK; i++) sum += i >= 148 && i < 156 ? 32 : header[i];
  return sum;
}

function number(header: Buffer, start: number, length: number, fail: (reason: string) => never): number {
  const text = cString(header.subarray(start, start + length)).trim();
  if (!/^[0-7]+$/.test(text)) fail(`bad numeric header field '${text}'`);
  return parseInt(text, 8);
}

function cString(bytes: Buffer): string {
  const end = bytes.indexOf(0);
  return bytes.subarray(0, end === -1 ? bytes.length : end).toString('utf8');
}

function headerPath(header: Buffer, ustar: boolean): string {
  const name = cString(header.subarray(0, 100));
  const prefix = ustar ? cString(header.subarray(345, 500)) : '';
  return prefix ? `${prefix}/${name}` : name;
}

// The tar crate drops one trailing NUL, no more.
function gnuLongName(data: Buffer): string {
  return data.subarray(0, data[data.length - 1] === 0 ? -1 : data.length).toString('utf8');
}

function paxPath(data: Buffer, fail: (reason: string) => never): string | undefined {
  let path: string | undefined;
  let rest = data;
  while (rest.length > 0) {
    const space = rest.indexOf(0x20);
    const digits = rest.subarray(0, Math.max(space, 0)).toString('latin1');
    const length = Number(digits);
    if (!/^\d+$/.test(digits) || length <= space + 1 || length > rest.length || rest[length - 1] !== 0x0a) fail('malformed pax header');
    const record = rest.subarray(space + 1, length - 1).toString('utf8');
    rest = rest.subarray(length);
    const eq = record.indexOf('=');
    const key = record.slice(0, eq);
    if (eq < 1 || key === 'size' || (key === 'path' && path !== undefined)) fail(`unsupported pax record '${key}'`);
    if (key === 'path') path = record.slice(eq + 1);
  }
  return path;
}

// pnpm's normalize_entry_path.
function normalize(entryPath: string): string {
  const raw = entryPath.replace(/\\/g, '/');
  if (raw === '') return '.';
  const absolute = raw.startsWith('/');
  const segments: string[] = [];
  for (const segment of raw.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment !== '..') segments.push(segment);
    else if (segments.length > 0 && segments[segments.length - 1] !== '..') segments.pop();
    else if (!absolute) segments.push('..');
  }
  const joined = segments.join('/');
  return absolute ? `/${joined}` : joined || '.';
}
