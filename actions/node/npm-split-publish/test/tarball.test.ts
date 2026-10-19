// readPackedManifest must read what npm reads. Each case builds a tarball and
// compares our result with npm's own (`npm pack <tarball> --dry-run --json`
// reads the manifest through pacote, as `npm publish` does).

import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import { describe, expect, it } from 'vitest';

import { readPackedManifest } from '../src/tarball';
import { makeTarball, tempDir } from './helpers';

const A = '{"name":"@x/a","version":"1.0.0"}';
const B = '{"name":"@x/b","version":"2.0.0"}';
type Entry = [path: string, type: string, content: string];

/** A gzipped ustar archive with exactly these entries, as written. */
function handTar(entries: Entry[]): string {
  const blocks: Buffer[] = [];
  for (const [entryPath, type, content] of entries) {
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

/** name@version as npm reads the tarball, or 'error'. */
function npmSees(file: string): string {
  const result = spawnSync('npm', ['pack', file, '--dry-run', '--json'], { cwd: tempDir('npm-pack-'), encoding: 'utf8' });
  if (result.status !== 0) return 'error';
  const [info] = JSON.parse(result.stdout) as { name: string; version: string }[];
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

describe('readPackedManifest reads what npm reads', () => {
  it('a tarball made by tar', () => {
    const dir = tempDir('tar-');
    makeTarball(dir, 'a.tgz', { name: '@x/a', version: '1.0.0' });
    expect(weSee(path.join(dir, 'a.tgz'))).toBe('@x/a@1.0.0');
    expect(npmSees(path.join(dir, 'a.tgz'))).toBe('@x/a@1.0.0');
  });

  it.each<[string, Entry[]]>([
    ['a second manifest under another top directory', [['package/package.json', '0', A], ['x/package.json', '0', B]]],
    ['a second manifest spelled package/./package.json', [['package/package.json', '0', A], ['package/./package.json', '0', B]]],
    ['a second manifest spelled package//package.json', [['package/package.json', '0', A], ['package//package.json', '0', B]]],
    ['a ./ prefix and a directory entry', [['./package/', '5', ''], ['./package/package.json', '0', A]]],
    ['a .. entry after the manifest', [['package/package.json', '0', A], ['package/../package.json', '0', B]]],
    ['a symlink named package.json', [['package/package.json', '0', A], ['package/package.json', '2', '/etc/hostname']]],
    ['a hard link after the manifest', [['package/package.json', '0', A], ['package/other.json', '1', 'package/package.json']]],
    ['no manifest at all', [['package/index.js', '0', '1']]],
  ])('%s', (_case, entries) => {
    const file = handTar(entries);
    expect(weSee(file)).toBe(npmSees(file));
  });
});
