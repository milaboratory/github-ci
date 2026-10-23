// readPackedManifest must read what `pnpm publish --dry-run` reads, or refuse the tarball.

import { execFileSync, spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import { describe, expect, it } from 'vitest';

import { readPackedManifest } from '../src/tarball';
import { hasRealPnpm, makeTarball, tempDir } from './helpers';

const A = '{"name":"@x/a","version":"1.0.0"}';
const B = '{"name":"@x/b","version":"2.0.0"}';
type Entry = [path: string, type: string, content: string];

/** A gzipped ustar archive with exactly these entries, as written. */
function handTar(entries: Entry[]): string {
  const blocks: Buffer[] = [];
  for (const [entryPath, type, content] of entries) {
    if (type === 'zero') {
      blocks.push(Buffer.alloc(512));
      continue;
    }
    const isLink = type === '1' || type === '2';
    const body = Buffer.from(isLink ? '' : content);
    const header = Buffer.alloc(512);
    header.write(entryPath, 0, 100, 'utf8');
    header.write(type === '5' ? '0000755\0' : '0000644\0', 100);
    header.write('0000000\0', 108);
    header.write('0000000\0', 116);
    header.write(body.length.toString(8).padStart(11, '0') + '\0', 124);
    header.write('00000000000\0', 136);
    header.write(type || '0', 156);
    if (isLink) header.write(content, 157, 100, 'utf8');
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

/** One pax record: "<length> <key>=<value>\n", the length counting itself. */
function pax(key: string, value: string): string {
  const body = ` ${key}=${value}\n`;
  let length = body.length + 1;
  while (String(length).length + body.length > length) length++;
  return `${length}${body}`;
}

/** name@version as pnpm reads the tarball, or 'error'. */
function pnpmSees(file: string): string {
  const args = ['publish', file, '--dry-run', '--json', '--registry=https://registry.npmjs.org/'];
  const result = spawnSync('pnpm', args, { cwd: tempDir('pnpm-dry-run-'), encoding: 'utf8' });
  if (result.status !== 0) return 'error';
  const info = JSON.parse(result.stdout) as { name: string; version: string };
  return `${info.name}@${info.version}`;
}

function weSee(file: string): string {
  try {
    const manifest = readPackedManifest(file);
    return `${String(manifest.name)}@${String(manifest.version)}`;
  } catch {
    return 'error';
  }
}

describe.skipIf(!hasRealPnpm())('readPackedManifest reads what pnpm reads', () => {
  it('a tarball made by tar', () => {
    const dir = tempDir('tar-');
    makeTarball(dir, 'a.tgz', { name: '@x/a', version: '1.0.0' });
    expect(weSee(path.join(dir, 'a.tgz'))).toBe('@x/a@1.0.0');
    expect(pnpmSees(path.join(dir, 'a.tgz'))).toBe('@x/a@1.0.0');
  });

  it('a tarball made by pnpm pack', () => {
    const pkg = tempDir('pnpm-pack-');
    const out = tempDir('pnpm-pack-out-');
    fs.writeFileSync(path.join(pkg, 'package.json'), A);
    execFileSync('pnpm', ['pack', '--pack-destination', out], { cwd: pkg, stdio: 'ignore' });
    const file = path.join(out, fs.readdirSync(out)[0]);
    expect(weSee(file)).toBe('@x/a@1.0.0');
    expect(pnpmSees(file)).toBe('@x/a@1.0.0');
  });

  it.each<[string, Entry[]]>([
    ['a long path in a pax header', [['package/package.json', 'x', pax('path', 'package/package.json')], ['ignored', '0', A]]],
    ['a long path in a GNU header', [['././@LongLink', 'L', 'package/package.json\0'], ['ignored', '0', A]]],
  ])('accepts %s', (_case, entries) => {
    const file = handTar(entries);
    expect(weSee(file)).toBe('@x/a@1.0.0');
    expect(pnpmSees(file)).toBe('@x/a@1.0.0');
  });

  it.each<[string, string, Entry[]]>([
    ['a second manifest under another top directory', '@x/a@1.0.0', [['package/package.json', '0', A], ['x/package.json', '0', B]]],
    ['a second manifest spelled package/./package.json', 'error', [['package/package.json', '0', A], ['package/./package.json', '0', B]]],
    ['a second manifest spelled package//package.json', 'error', [['package/package.json', '0', A], ['package//package.json', '0', B]]],
    ['a second manifest spelled package\\package.json', 'error', [['package/package.json', '0', A], ['package\\package.json', '0', B]]],
    ['a ./ prefix and a directory entry', '@x/a@1.0.0', [['./package/', '5', ''], ['./package/package.json', '0', A]]],
    ['a .. entry after the manifest', '@x/a@1.0.0', [['package/package.json', '0', A], ['package/../package.json', '0', B]]],
    ['an absolute path', 'error', [['/package/package.json', '0', A]]],
    ['a symlink named package.json', 'error', [['package/package.json', '0', A], ['package/package.json', '2', '/etc/hostname']]],
    ['a hard link after the manifest', '@x/a@1.0.0', [['package/package.json', '0', A], ['package/other.json', '1', 'package/package.json']]],
    ['a second manifest after an end-of-archive block', 'error', [['package/package.json', '0', A], ['', 'zero', ''], ['package/package.json', '0', B]]],
    ['a second manifest through a pax path', 'error', [['package/package.json', '0', A], ['x', 'x', pax('path', 'package/package.json')], ['other', '0', B]]],
    ['a pax size', 'error', [['x', 'x', pax('size', '0')], ['package/package.json', '0', A]]],
    ['a global pax header', 'error', [['package/package.json', 'g', pax('path', 'x')], ['package/package.json', '0', A]]],
    ['no manifest at all', 'error', [['package/index.js', '0', '1']]],
  ])('%s: %s', (_case, expected, entries) => {
    const file = handTar(entries);
    expect(weSee(file)).toBe(expected);
    if (expected !== 'error') expect(pnpmSees(file)).toBe(expected);
  });
});

describe('readPackedManifest refuses', () => {
  it('a second gzip member, which pnpm does not read', () => {
    const file = handTar([['package/package.json', '0', A]]);
    fs.appendFileSync(file, zlib.gzipSync(Buffer.alloc(1024)));
    expect(weSee(file)).toBe('error');
  });

  it('a pax record length that Number() reads but the tar crate does not', () => {
    const file = handTar([['x', 'x', '0x1f path=package/package.json\n'], ['other', '0', A]]);
    expect(weSee(file)).toBe('error');
  });
});
