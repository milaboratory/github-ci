import { execFileSync } from 'child_process';
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
    expect(() => readPackedManifest(file)).toThrow("entry 'x/");
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
});
