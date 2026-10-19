import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';

import { normalizeRepository, repositoryState, withRepository } from '../src/repository';
import { tempDir } from './helpers';

const SOURCE = 'https://github.com/Fixture-Org/Repo';

describe('normalizeRepository', () => {
  it.each([
    'https://github.com/fixture-org/repo',
    'git+https://github.com/fixture-org/repo.git',
    'git://github.com/fixture-org/repo.git',
    'git@github.com:fixture-org/repo.git',
    'ssh://git@github.com/fixture-org/repo',
    'github:fixture-org/repo',
    'fixture-org/repo',
    'https://github.com/Fixture-Org/Repo/',
  ])('reads %s as the same repository', (value) => {
    expect(normalizeRepository(value)).toBe('https://github.com/fixture-org/repo');
    expect(normalizeRepository({ type: 'git', url: value })).toBe('https://github.com/fixture-org/repo');
  });

  it.each([undefined, '', 'https://gitlab.com/fixture-org/repo', { type: 'git' }])('does not recognise %j', (value) => {
    expect(normalizeRepository(value)).toBeUndefined();
  });
});

describe('repositoryState', () => {
  it('tells missing, matching and different repositories apart', () => {
    expect(repositoryState({}, SOURCE)).toBe('missing');
    expect(repositoryState({ repository: '' }, SOURCE)).toBe('missing');
    expect(repositoryState({ repository: { url: 'git+https://github.com/fixture-org/repo.git' } }, SOURCE)).toBe('matches');
    expect(repositoryState({ repository: 'https://github.com/fixture-org/renamed' }, SOURCE)).toBe('mismatch');
  });
});

describe('withRepository', () => {
  function pkgDir(manifest: object): { root: string; dir: string; file: string; original: string } {
    const root = tempDir('repo-test-');
    const dir = path.join(root, 'packages', 'lib');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'package.json');
    const original = JSON.stringify(manifest) + '\n';
    fs.writeFileSync(file, original);
    return { root, dir, file, original };
  }

  it('fills in a missing repository while fn runs, then restores the file', async () => {
    const { root, dir, file, original } = pkgDir({ name: '@x/lib', version: '1.0.0' });
    const during = await withRepository(dir, root, SOURCE, async () => JSON.parse(fs.readFileSync(file, 'utf8')));
    expect(during.repository).toEqual({ type: 'git', url: 'git+https://github.com/Fixture-Org/Repo.git', directory: 'packages/lib' });
    expect(fs.readFileSync(file, 'utf8')).toBe(original);
  });

  it('omits directory for a package at the workspace root', async () => {
    const { dir, file } = pkgDir({ name: '@x/lib', version: '1.0.0' });
    const during = await withRepository(dir, dir, SOURCE, async () => JSON.parse(fs.readFileSync(file, 'utf8')));
    expect(during.repository).toEqual({ type: 'git', url: 'git+https://github.com/Fixture-Org/Repo.git' });
  });

  it('restores the file when fn fails', async () => {
    const { root, dir, file, original } = pkgDir({ name: '@x/lib', version: '1.0.0' });
    await expect(withRepository(dir, root, SOURCE, async () => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    expect(fs.readFileSync(file, 'utf8')).toBe(original);
  });

  it('leaves a declared repository alone', async () => {
    const { root, dir, file, original } = pkgDir({ name: '@x/lib', version: '1.0.0', repository: 'fixture-org/repo' });
    await withRepository(dir, root, SOURCE, async () => expect(fs.readFileSync(file, 'utf8')).toBe(original));
  });
});
