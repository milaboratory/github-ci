import { execFileSync } from 'child_process';
import * as zlib from 'zlib';
import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';

import { readPackedManifest } from '../src/tarball';
import { TAR_ENV, makeTarball, tempDir } from './helpers';

/** Tars the given files (path -> content) as they are, under one root. */
function rawTarball(files: Record<string, string>, extraTarArgs: string[] = []): string {
  const staging = tempDir('raw-tar-');
  for (const [file, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(staging, file)), { recursive: true });
    fs.writeFileSync(path.join(staging, file), content);
  }
  const out = path.join(tempDir('raw-out-'), 'pkg.tgz');
  const tops = [...new Set(Object.keys(files).map((f) => f.split('/')[0]))];
  execFileSync('tar', ['-czf', out, ...extraTarArgs, '-C', staging, ...tops], { env: TAR_ENV });
  return out;
}

describe('readPackedManifest', () => {
  it('reads package/package.json', () => {
    const dir = tempDir('tar-');
    makeTarball(dir, 'a.tgz', { name: '@x/a', version: '1.0.0' });
    expect(readPackedManifest(path.join(dir, 'a.tgz'))).toMatchObject({ name: '@x/a', version: '1.0.0' });
  });

  it('reads past entries with long paths', () => {
    const long = `package/${'d'.repeat(80)}/${'f'.repeat(80)}.js`;
    const file = rawTarball({ [long]: '1', 'package/package.json': '{"name":"@x/a","version":"1.0.0"}' });
    expect(readPackedManifest(file)).toMatchObject({ name: '@x/a' });
  });

  it('rejects an entry outside package/ (npm strips the top directory)', () => {
    const file = rawTarball({ 'package/package.json': '{"name":"@x/a","version":"1.0.0"}', 'x/package.json': '{"name":"@x/b","version":"1.0.0"}' });
    // The x/ directory entry is the first one outside package/.
    expect(() => readPackedManifest(file)).toThrow("entry 'x' is outside package/");
  });

  it('rejects a long-path entry outside package/', () => {
    const long = `${'o'.repeat(80)}/${'p'.repeat(80)}/package.json`;
    const file = rawTarball({ 'package/package.json': '{"name":"@x/a","version":"1.0.0"}', [long]: '{}' });
    expect(() => readPackedManifest(file)).toThrow('is outside package/');
  });

  it('rejects a tarball without package/package.json', () => {
    const file = rawTarball({ 'package/index.js': '1' });
    expect(() => readPackedManifest(file)).toThrow('no package/package.json');
  });

  it.each([
    ['a second package.json spelled package/./package.json', [['package/package.json', '0', A], ['package/./package.json', '0', B]], 'more than one package/package.json'],
    ['a second package.json spelled package//package.json', [['package/package.json', '0', A], ['package//package.json', '0', B]], 'more than one package/package.json'],
    ['a .. segment', [['package/package.json', '0', A], ['package/../x.json', '0', '{}']], "contains '..'"],
    ['a symlink', [['package/package.json', '0', A], ['package/link', '2', '']], "unsupported type '2'"],
    ['a hard link', [['package/package.json', '0', A], ['package/hard', '1', '']], "unsupported type '1'"],
  ])('rejects %s', (_case, entries, message) => {
    expect(() => readPackedManifest(handTar(entries as Entry[]))).toThrow(message);
  });

  it('accepts a hand-built tarball with a ./ prefix and a package/ directory entry', () => {
    const file = handTar([['./package/', '5', ''], ['./package/package.json', '0', A]]);
    expect(readPackedManifest(file)).toMatchObject({ name: '@x/a' });
  });
});

const A = '{"name":"@x/a","version":"1.0.0"}';
const B = '{"name":"@x/b","version":"1.0.0"}';
type Entry = [path: string, type: string, content: string];

/** A gzipped ustar archive with exactly these entries, as written. */
function handTar(entries: Entry[]): string {
  const blocks: Buffer[] = [];
  for (const [entryPath, type, content] of entries) {
    const body = Buffer.from(content);
    const header = Buffer.alloc(512);
    header.write(entryPath, 0, 100, 'utf8');
    header.write('0000644\0', 100);
    header.write('0000000\0', 108);
    header.write('0000000\0', 116);
    header.write(body.length.toString(8).padStart(11, '0') + '\0', 124);
    header.write('00000000000\0', 136);
    header.write(type || '0', 156);
    header.write('ustar\0', 257);
    header.write('00', 263);
    header.fill(' ', 148, 156);
    let sum = 0;
    for (const byte of header) sum += byte;
    header.write(sum.toString(8).padStart(6, '0') + '\0 ', 148);
    blocks.push(header, body, Buffer.alloc((512 - (body.length % 512)) % 512));
  }
  blocks.push(Buffer.alloc(1024));
  const file = path.join(tempDir('hand-tar-'), 'pkg.tgz');
  fs.writeFileSync(file, zlib.gzipSync(Buffer.concat(blocks)));
  return file;
}
