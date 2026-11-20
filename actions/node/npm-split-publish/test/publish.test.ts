import { execFileSync, spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';

import { ManifestEntry, writeManifest } from '../src/manifest';
import { checkPackedPublishConfig, npmrcFor, NOT_REGISTERED_RETRIES, publishArgs, publishTarballs } from '../src/publish';
import { Call, fakeRunner, makeTarball, notFound, ok, quiet, tempDir } from './helpers';

const NPMJS = 'https://registry.npmjs.org/';
const GITHUB = 'https://npm.pkg.github.com/';

function entry(name: string, overrides: Partial<ManifestEntry> = {}): ManifestEntry {
  const version = overrides.version ?? '1.0.0';
  const file = `${name.replace('@', '').replace('/', '-')}-${version}.tgz`;
  return { name, version, file, registry: NPMJS, tag: '', access: '', ...overrides };
}

const LIB = entry('@fixture/lib', { access: 'restricted' });
const APP = entry('@fixture/app', { version: '2.0.0', tag: 'next' });

/** A tarball dir with real tarballs matching the entries. */
function tarballDir(entries: ManifestEntry[]): string {
  const dir = tempDir('publish-test-');
  for (const e of entries) makeTarball(dir, e.file, { name: e.name, version: e.version });
  writeManifest(dir, entries);
  return dir;
}

interface NpmState {
  published?: string[];
  failingPublish?: string[];
  /** Tarballs whose upload the registry refuses as already published. */
  duplicate?: string[];
}

/** Fake npm; records the npm config in effect at each publish. */
function fakeNpm(state: NpmState = {}) {
  const configs: string[] = [];
  const run = fakeRunner((call: Call) => {
    if (call.command !== 'npm') return undefined;
    if (call.args[0] === 'view') {
      return state.published?.includes(call.args[1]) ? ok(call.args[1].split('@').pop() + '\n') : notFound();
    }
    if (call.args[0] === 'publish') {
      configs.push(fs.readFileSync(call.options.env!.NPM_CONFIG_USERCONFIG!, 'utf8'));
      const file = path.basename(call.args[1]);
      if (state.duplicate?.includes(file)) {
        return { code: 1, stdout: '', stderr: 'npm error code E403\nnpm error 403 You cannot publish over the previously published versions: 1.0.0.' };
      }
      return state.failingPublish?.includes(file) ? { code: 1, stdout: '', stderr: 'npm error code E403' } : ok(`+ ${file}`);
    }
    return undefined;
  });
  return { run, configs, publishes: () => run.calls.filter((c) => c.args[0] === 'publish') };
}

async function publish(entries: ManifestEntry[], npm = fakeNpm(), options: { accessPublic?: boolean; npmAuthToken?: string; npmjsFallbackToken?: string } = {}) {
  const dir = tarballDir(entries);
  const userconfig = path.join(dir, '..', `${path.basename(dir)}.npmrc`);
  const published = await publishTarballs({ dir, userconfig, accessPublic: false, ...options }, { ...quiet, run: npm.run });
  return { dir, published, npm };
}

describe('publishArgs', () => {
  it('skips lifecycle scripts and passes the registry, tag and access', () => {
    expect(publishArgs(APP, '/t', false)).toEqual(['publish', `/t/${APP.file}`, '--ignore-scripts', `--registry=${NPMJS}`, '--tag=next']);
    expect(publishArgs(LIB, '/t', false)).toEqual(['publish', `/t/${LIB.file}`, '--ignore-scripts', `--registry=${NPMJS}`, '--tag=latest', '--access=restricted']);
  });

  it('accessPublic overrides the manifest access', () => {
    expect(publishArgs(LIB, '/t', true).slice(-1)).toEqual(['--access=public']);
  });
});

describe('checkPackedPublishConfig', () => {
  it('allows ordinary publishConfig keys and the entry registry', () => {
    expect(() =>
      checkPackedPublishConfig('x', { access: 'public', tag: 'next', registry: 'https://registry.npmjs.org', main: 'dist/index.js', 'umd:main': 'x.js' }, NPMJS),
    ).not.toThrow();
    expect(() => checkPackedPublishConfig('x', undefined, NPMJS)).not.toThrow();
  });

  it.each([
    [{ '@scope:registry': 'https://evil.test/' }, "sets '@scope:registry'"],
    [{ '//evil.test/:_authToken': 'x' }, "sets '//evil.test/:_authToken'"],
    [{ proxy: 'http://evil.test' }, "sets 'proxy'"],
    [{ _authToken: 'x' }, "sets '_authToken'"],
    [{ registry: 'https://evil.test/' }, 'publishConfig.registry https://evil.test/ is not'],
    ['text', 'is not an object'],
  ])('refuses %j', (config, message) => {
    expect(() => checkPackedPublishConfig('x', config, NPMJS)).toThrow(message);
  });
});

describe('npmrcFor', () => {
  it('configures no npmjs token without a fallback, so only OIDC can authenticate', () => {
    expect(npmrcFor([LIB], {})).toBe('');
  });

  it('configures the npmjs fallback token as an env reference', () => {
    expect(npmrcFor([LIB], { npmjsFallbackToken: 'secret' })).toBe('//registry.npmjs.org/:_authToken=${NPMJS_FALLBACK_TOKEN}\n');
  });

  it('sends the GitHub token to GitHub Packages only', () => {
    const config = npmrcFor([LIB, entry('@milaboratory/internal', { registry: GITHUB })], { npmAuthToken: 'gh' });
    expect(config).toBe('//npm.pkg.github.com/:_authToken=${NPM_AUTH_TOKEN}\n');
  });

  it('requires a token for GitHub Packages', () => {
    expect(() => npmrcFor([entry('@milaboratory/internal', { registry: GITHUB })], {})).toThrow('npm-auth-token is empty');
  });

  it.each([
    ['http://npm.pkg.github.com/', 'only https registries are supported'],
    ['https://npm.example.test/', 'no credentials for this registry'],
    ['https://npm.pkg.github.com.evil.test/', 'no credentials for this registry'],
    ['https://npm.pkg.github.com@evil.test/', 'credentials or a port'],
    ['https://user:pass@npm.pkg.github.com/', 'credentials or a port'],
    ['https://npm.pkg.github.com:8443/', 'credentials or a port'],
    ['not a url', 'not a URL'],
  ])('refuses %s', (registry, message) => {
    expect(() => npmrcFor([entry('@x/y', { registry })], { npmAuthToken: 'gh', npmjsFallbackToken: 'np' })).toThrow(message);
  });
});

describe('publishTarballs', () => {
  it('publishes in manifest order', async () => {
    const { npm, published } = await publish([LIB, APP]);
    expect(npm.publishes().map((c) => path.basename(c.args[1]))).toEqual([LIB.file, APP.file]);
    expect(published).toEqual([LIB, APP]);
  });

  it('skips versions that are already published', async () => {
    const { npm } = await publish([LIB, APP], fakeNpm({ published: ['@fixture/lib@1.0.0'] }));
    expect(npm.publishes().map((c) => path.basename(c.args[1]))).toEqual([APP.file]);
  });

  it('hands npm the generated config and the tokens only through env', async () => {
    const npm = fakeNpm();
    await publish([LIB], npm, { npmjsFallbackToken: 'np-secret' });
    expect(npm.configs).toEqual(['//registry.npmjs.org/:_authToken=${NPMJS_FALLBACK_TOKEN}\n']);
    expect(npm.publishes()[0].options.env!.NPMJS_FALLBACK_TOKEN).toBe('np-secret');
  });

  it('fails before uploading on a registry without credentials', async () => {
    const npm = fakeNpm();
    await expect(publish([LIB, entry('@x/private', { registry: 'https://npm.example.test/' })], npm)).rejects.toThrow(
      'no credentials for this registry',
    );
    expect(npm.run.calls).toEqual([]);
  });

  it('stops at the first failed upload', async () => {
    const npm = fakeNpm({ failingPublish: [LIB.file] });
    await expect(publish([LIB, APP], npm)).rejects.toThrow('E403');
    expect(npm.publishes().map((c) => path.basename(c.args[1]))).toEqual([LIB.file]);
  });

  it('fails before uploading when a tarball holds another package', async () => {
    const dir = tarballDir([LIB, APP]);
    makeTarball(dir, APP.file, { name: '@fixture/other', version: '2.0.0' });
    const npm = fakeNpm();
    await expect(publishTarballs({ dir, userconfig: `${dir}.npmrc`, accessPublic: false }, { ...quiet, run: npm.run })).rejects.toThrow(
      `@fixture/app@2.0.0: ${APP.file} contains @fixture/other@2.0.0`,
    );
    expect(npm.run.calls).toEqual([]);
  });

  it('treats a duplicate-version refusal as already published', async () => {
    const npm = fakeNpm({ duplicate: [LIB.file] });
    const { published } = await publish([LIB, APP], npm);
    expect(npm.publishes().map((c) => path.basename(c.args[1]))).toEqual([LIB.file, APP.file]);
    expect(published).toEqual([APP]);
  });

  it('fails before uploading when a packed publishConfig could redirect the upload', async () => {
    const dir = tarballDir([LIB, APP]);
    makeTarball(dir, APP.file, { name: APP.name, version: APP.version, publishConfig: { '@fixture:registry': 'https://evil.test/' } });
    const npm = fakeNpm();
    await expect(publishTarballs({ dir, userconfig: `${dir}.npmrc`, accessPublic: false }, { ...quiet, run: npm.run })).rejects.toThrow(
      "sets '@fixture:registry'",
    );
    expect(npm.run.calls).toEqual([]);
  });

  it('fails when a tarball named in the manifest is missing', async () => {
    const dir = tarballDir([LIB]);
    fs.rmSync(path.join(dir, LIB.file));
    await expect(publishTarballs({ dir, userconfig: `${dir}.npmrc`, accessPublic: false }, { ...quiet, run: fakeNpm().run })).rejects.toThrow(
      `${LIB.file} is missing`,
    );
  });

  it('runs npm outside the tarball directory, so a planted .npmrc is not read', async () => {
    const dir = tarballDir([LIB]);
    fs.writeFileSync(path.join(dir, '.npmrc'), 'registry=https://evil.test/\n');
    const npm = fakeNpm();
    await publishTarballs({ dir, userconfig: `${dir}.npmrc`, accessPublic: false }, { ...quiet, run: npm.run });
    for (const call of npm.run.calls) {
      expect(call.options.cwd).not.toBe(dir);
      expect(fs.readdirSync(call.options.cwd)).toEqual([]);
    }
    expect(npm.publishes()[0].args[1]).toBe(path.join(dir, LIB.file));
  });

  it('does nothing on an empty or missing manifest', async () => {
    const npm = fakeNpm();
    expect(await publishTarballs({ dir: tempDir('empty-'), userconfig: '/dev/null', accessPublic: false }, { ...quiet, run: npm.run })).toEqual([]);
    expect(npm.run.calls).toEqual([]);
  });
});

// Real npm, no upload (--dry-run): npm 11 refuses a prerelease without an
// explicit tag. Our arguments must get past that, as npm 10 did on the old
// path. Needs npm 11 on PATH (CI installs it) and registry access.
const npmMajor = (() => {
  try {
    return Number(execFileSync('npm', ['--version'], { encoding: 'utf8' }).split('.')[0]);
  } catch {
    return 0;
  }
})();

describe.skipIf(npmMajor < 11)('publishArgs with real npm 11', () => {
  const prerelease = entry('@milaboratories/npm-split-publish-test-does-not-exist', { version: '1.0.0-next.0' });

  function dryRun(args: string[]) {
    const cwd = tempDir('npm-dry-run-');
    return spawnSync('npm', [...args, '--dry-run'], { cwd, encoding: 'utf8' });
  }

  it('npm itself refuses a prerelease with the default tag', () => {
    const dir = tarballDir([prerelease]);
    const result = dryRun(['publish', path.join(dir, prerelease.file), '--ignore-scripts', `--registry=${NPMJS}`]);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('You must specify a tag');
  });

  it('accepts a prerelease with our arguments', () => {
    const dir = tarballDir([prerelease]);
    const result = dryRun(publishArgs(prerelease, dir, true));
    expect(result.stderr).not.toContain('You must specify a tag');
    expect(result.status).toBe(0);
  });
});

describe('own registry (npm.platforma.bio)', () => {
  const OWN = 'https://npm.platforma.bio/';
  const BLOCK = entry('@platforma-open/milaboratories.some-block', { registry: OWN });
  const BLOCK2 = entry('@platforma-open/milaboratories.some-block.model', { registry: OWN });

  it('npmrcFor refers to the OIDC token only through an env var', () => {
    expect(npmrcFor([BLOCK], {})).toBe('//npm.platforma.bio/:_authToken=${NPM_PLATFORMA_OIDC_TOKEN}\n');
  });

  it('mints a fresh token with the registry audience before every upload there, and none for npmjs', async () => {
    const audiences: string[] = [];
    let n = 0;
    const oidcToken = async (audience: string) => { audiences.push(audience); return `jwt-${++n}`; };
    const npm = fakeNpm();
    const dir = tarballDir([LIB, BLOCK, BLOCK2]);
    await publishTarballs({ dir, userconfig: `${dir}.npmrc`, accessPublic: false }, { ...quiet, run: npm.run, oidcToken });
    expect(audiences).toEqual(['https://npm.platforma.bio', 'https://npm.platforma.bio']);
    const tokens = npm.publishes().map((c) => c.options.env!.NPM_PLATFORMA_OIDC_TOKEN);
    expect(tokens).toEqual(['', 'jwt-1', 'jwt-2']);
    expect(npm.configs.every((c) => !c.includes('jwt-'))).toBe(true);
  });

  it('fails without an OIDC token source', async () => {
    const npm = fakeNpm();
    await expect(publish([BLOCK], npm)).rejects.toThrow('no OIDC token source for npm.platforma.bio');
    expect(npm.publishes()).toEqual([]);
  });

  it("treats Verdaccio's E409 duplicate as already published", async () => {
    const npm = fakeNpm();
    const run = fakeRunner((call: Call) =>
      call.args[0] === 'publish'
        ? { code: 1, stdout: '', stderr: 'npm error code E409\nnpm error 409 Conflict - PUT https://npm.platforma.bio/x - this package is already present' }
        : undefined,
      npm.run,
    );
    const dir = tarballDir([BLOCK]);
    const published = await publishTarballs({ dir, userconfig: `${dir}.npmrc`, accessPublic: false }, { ...quiet, run, oidcToken: async () => 'jwt' });
    expect(published).toEqual([]);
  });

  const notYet = { code: 1, stdout: '', stderr: 'npm error code E403\nnpm error 403 Forbidden - package @platforma-open/x is not registered to any repository yet (the owner map ...; retry in a few minutes)' };

  it('waits and retries a package the owner map does not list yet, with a fresh token each time', async () => {
    let calls = 0;
    const npm = fakeNpm();
    const run = fakeRunner((call: Call) => (call.args[0] === 'publish' && ++calls <= 2 ? notYet : undefined), npm.run);
    const waits: number[] = [];
    let n = 0;
    const dir = tarballDir([BLOCK]);
    const published = await publishTarballs(
      { dir, userconfig: `${dir}.npmrc`, accessPublic: false },
      { ...quiet, run, oidcToken: async () => `jwt-${++n}`, sleep: async (ms) => { waits.push(ms); } },
    );
    expect(published).toEqual([BLOCK]);
    expect(waits).toEqual([45000, 45000]);
    const tokens = run.calls.filter((c) => c.args[0] === 'publish').map((c) => c.options.env!.NPM_PLATFORMA_OIDC_TOKEN);
    expect(tokens).toEqual(['jwt-1', 'jwt-2', 'jwt-3']);
  });

  it('gives up after the retries and fails the release', async () => {
    const run = fakeRunner((call: Call) => (call.args[0] === 'publish' ? notYet : undefined), fakeNpm().run);
    const dir = tarballDir([BLOCK]);
    let waits = 0;
    await expect(
      publishTarballs({ dir, userconfig: `${dir}.npmrc`, accessPublic: false }, { ...quiet, run, oidcToken: async () => 'jwt', sleep: async () => { waits++; } }),
    ).rejects.toThrow('not registered to any repository yet');
    expect(waits).toBe(NOT_REGISTERED_RETRIES);
  });

  it('does not retry other refusals (e.g. another repository owns the package)', async () => {
    const run = fakeRunner((call: Call) => (call.args[0] === 'publish' ? { code: 1, stdout: '', stderr: 'npm error 403 Forbidden - package belongs to another repository' } : undefined), fakeNpm().run);
    const dir = tarballDir([BLOCK]);
    let waits = 0;
    await expect(
      publishTarballs({ dir, userconfig: `${dir}.npmrc`, accessPublic: false }, { ...quiet, run, oidcToken: async () => 'jwt', sleep: async () => { waits++; } }),
    ).rejects.toThrow('belongs to another repository');
    expect(waits).toBe(0);
  });
});
