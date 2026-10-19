import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';

import { publicSourceRepository } from '../src/github';
import { ensureRepository } from '../src/repository';
import { tempDir } from './helpers';

const SOURCE = 'https://github.com/fixture-org/fixture-repo';

function pkg(manifest: object): { root: string; dir: string; file: string } {
  const root = tempDir('prepare-test-');
  const dir = path.join(root, 'pkg');
  fs.mkdirSync(dir);
  const file = path.join(dir, 'package.json');
  fs.writeFileSync(file, JSON.stringify(manifest));
  return { root, dir, file };
}

describe('ensureRepository', () => {
  it('writes a missing repository into package.json', () => {
    const { root, dir, file } = pkg({ name: '@x/a', version: '1.0.0' });
    expect(ensureRepository(dir, root, SOURCE)).toBe('added');
    expect(JSON.parse(fs.readFileSync(file, 'utf8')).repository).toEqual({
      type: 'git',
      url: 'git+https://github.com/fixture-org/fixture-repo.git',
      directory: 'pkg',
    });
  });

  it('leaves a matching repository alone', () => {
    const { root, dir, file } = pkg({ name: '@x/a', version: '1.0.0', repository: 'github:fixture-org/fixture-repo' });
    const before = fs.readFileSync(file, 'utf8');
    expect(ensureRepository(dir, root, SOURCE)).toBe('present');
    expect(fs.readFileSync(file, 'utf8')).toBe(before);
  });

  it('refuses a different repository', () => {
    const { root, dir } = pkg({ name: '@x/a', version: '1.0.0', repository: 'fixture-org/old-name' });
    expect(() => ensureRepository(dir, root, SOURCE)).toThrow('@x/a: package.json repository "fixture-org/old-name" is not');
  });
});

describe('publicSourceRepository', () => {
  function event(repository: object | undefined): string {
    const file = path.join(tempDir('event-'), 'event.json');
    fs.writeFileSync(file, JSON.stringify(repository ? { repository } : {}));
    return file;
  }
  const env = (eventPath: string, server = 'https://github.com') => ({
    GITHUB_SERVER_URL: server,
    GITHUB_REPOSITORY: 'fixture-org/fixture-repo',
    GITHUB_EVENT_PATH: eventPath,
  });

  it('names a public github.com repository', () => {
    expect(publicSourceRepository(env(event({ private: false })))).toBe(SOURCE);
  });

  it.each([
    ['a private repository', () => env(event({ private: true }))],
    ['an event without repository', () => env(event(undefined))],
    ['a missing event file', () => env('/nonexistent/event.json')],
    ['GitHub Enterprise Server', () => env(event({ private: false }), 'https://ghes.example.test')],
  ])('returns nothing for %s', (_case, makeEnv) => {
    expect(publicSourceRepository(makeEnv())).toBeUndefined();
  });
});
