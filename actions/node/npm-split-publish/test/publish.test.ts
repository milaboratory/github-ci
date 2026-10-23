import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';

import { ManifestEntry, writeManifest } from '../src/manifest';
import { checkPackedManifest, npmrcFor, publishArgs, publishTarballs } from '../src/publish';
import { Call, fakeRunner, hasRealPnpm, makeTarball, ok, quiet, tempDir, viewError } from './helpers';

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

interface PnpmState {
  published?: string[];
  failingPublish?: string[];
  /** Tarballs whose upload the registry refuses as already published. */
  duplicate?: string[];
  version?: string;
}

/** Fake pnpm; records the auth file in effect at each publish. */
function fakePnpm(state: PnpmState = {}) {
  const configs: string[] = [];
  const run = fakeRunner((call: Call) => {
    if (call.command !== 'pnpm') return undefined;
    if (call.args[0] === '--version') return ok(`${state.version ?? '12.14.0'}\n`);
    if (call.args[0] === 'view') {
      return state.published?.includes(call.args[1]) ? ok(JSON.stringify(call.args[1].split('@').pop())) : viewError('ERR_PNPM_FETCH_404');
    }
    if (call.args[0] === 'publish') {
      configs.push(fs.readFileSync(call.options.env!.PNPM_CONFIG_NPMRC_AUTH_FILE!, 'utf8'));
      const file = path.basename(call.args[1]);
      if (state.duplicate?.includes(file)) {
        const message = 'Failed to publish package x@1.0.0 (status 403 Forbidden): {"error":"You cannot publish over the previously published versions: 1.0.0."}';
        return { code: 1, stdout: JSON.stringify({ error: { code: 'ERR_PNPM_FAILED_TO_PUBLISH', message } }), stderr: 'Error: ERR_PNPM_FAILED_TO_PUBLISH\n  │ You cannot publish over the previously published\n  │ versions: 1.0.0.' };
      }
      return state.failingPublish?.includes(file) ? viewError('ERR_PNPM_FAILED_TO_PUBLISH') : ok(JSON.stringify({ name: file }));
    }
    return undefined;
  });
  return { run, configs, publishes: () => run.calls.filter((c) => c.args[0] === 'publish') };
}

async function publish(entries: ManifestEntry[], pnpm = fakePnpm(), options: { accessPublic?: boolean; npmAuthToken?: string; npmjsFallbackToken?: string } = {}) {
  const dir = tarballDir(entries);
  const userconfig = path.join(dir, '..', `${path.basename(dir)}.npmrc`);
  const published = await publishTarballs({ dir, userconfig, accessPublic: false, ...options }, { ...quiet, run: pnpm.run });
  return { dir, published, pnpm };
}

describe('publishArgs', () => {
  it('passes the registry, tag and access', () => {
    expect(publishArgs(APP, '/t', false)).toEqual(['publish', `/t/${APP.file}`, `--registry=${NPMJS}`, '--json', '--tag=next']);
    expect(publishArgs(LIB, '/t', false)).toEqual(['publish', `/t/${LIB.file}`, `--registry=${NPMJS}`, '--json', '--access=restricted']);
  });

  it('accessPublic overrides the manifest access', () => {
    expect(publishArgs(LIB, '/t', true).slice(-1)).toEqual(['--access=public']);
  });
});

describe('checkPackedManifest', () => {
  const check = (publishConfig: unknown) => () => checkPackedManifest('x', { publishConfig }, LIB);

  it('allows ordinary publishConfig keys and the entry registry', () => {
    expect(check({ access: 'public', tag: 'next', registry: 'https://registry.npmjs.org', main: 'dist/index.js', 'umd:main': 'x.js' })).not.toThrow();
    expect(check(undefined)).not.toThrow();
  });

  it('allows a top-level tag only when it is the one the upload uses', () => {
    expect(() => checkPackedManifest('x', { tag: 'latest' }, LIB)).not.toThrow();
    expect(() => checkPackedManifest('x', { tag: 'next' }, APP)).not.toThrow();
    expect(() => checkPackedManifest('x', { tag: 'evil' }, LIB)).toThrow(`sets tag "evil", not 'latest'`);
    expect(() => checkPackedManifest('x', { tag: 'latest' }, APP)).toThrow(`sets tag "latest", not 'next'`);
  });

  it.each([
    [{ '@scope:registry': 'https://evil.test/' }, "sets '@scope:registry'"],
    [{ '@Scope:Registry': 'https://evil.test/' }, "sets '@Scope:Registry'"],
    [{ registry: 'https://evil.test/' }, 'publishConfig.registry https://evil.test/ is not'],
    ['text', 'is not an object'],
  ])('refuses %j', (config, message) => {
    expect(check(config)).toThrow(message);
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
    const { pnpm, published } = await publish([LIB, APP]);
    expect(pnpm.publishes().map((c) => path.basename(c.args[1]))).toEqual([LIB.file, APP.file]);
    expect(published).toEqual([LIB, APP]);
  });

  it('skips versions that are already published', async () => {
    const { pnpm } = await publish([LIB, APP], fakePnpm({ published: ['@fixture/lib@1.0.0'] }));
    expect(pnpm.publishes().map((c) => path.basename(c.args[1]))).toEqual([APP.file]);
  });

  it('hands pnpm the generated auth file and the tokens only through env', async () => {
    const pnpm = fakePnpm();
    await publish([LIB], pnpm, { npmjsFallbackToken: 'np-secret' });
    expect(pnpm.configs).toEqual(['//registry.npmjs.org/:_authToken=${NPMJS_FALLBACK_TOKEN}\n']);
    expect(pnpm.publishes()[0].options.env!.NPMJS_FALLBACK_TOKEN).toBe('np-secret');
  });

  it('fails before uploading on a registry without credentials', async () => {
    const pnpm = fakePnpm();
    await expect(publish([LIB, entry('@x/private', { registry: 'https://npm.example.test/' })], pnpm)).rejects.toThrow(
      'no credentials for this registry',
    );
    expect(pnpm.run.calls).toEqual([]);
  });

  it('stops at the first failed upload', async () => {
    const pnpm = fakePnpm({ failingPublish: [LIB.file] });
    await expect(publish([LIB, APP], pnpm)).rejects.toThrow('ERR_PNPM_FAILED_TO_PUBLISH');
    expect(pnpm.publishes().map((c) => path.basename(c.args[1]))).toEqual([LIB.file]);
  });

  it('fails before uploading when a tarball holds another package', async () => {
    const dir = tarballDir([LIB, APP]);
    makeTarball(dir, APP.file, { name: '@fixture/other', version: '2.0.0' });
    const pnpm = fakePnpm();
    await expect(publishTarballs({ dir, userconfig: `${dir}.npmrc`, accessPublic: false }, { ...quiet, run: pnpm.run })).rejects.toThrow(
      `@fixture/app@2.0.0: ${APP.file} contains @fixture/other@2.0.0`,
    );
    expect(pnpm.run.calls).toEqual([]);
  });

  it('treats a duplicate-version refusal as already published', async () => {
    const pnpm = fakePnpm({ duplicate: [LIB.file] });
    const { published } = await publish([LIB, APP], pnpm);
    expect(pnpm.publishes().map((c) => path.basename(c.args[1]))).toEqual([LIB.file, APP.file]);
    expect(published).toEqual([APP]);
  });

  it('fails before uploading when a packed publishConfig could redirect the upload', async () => {
    const dir = tarballDir([LIB, APP]);
    makeTarball(dir, APP.file, { name: APP.name, version: APP.version, publishConfig: { '@fixture:registry': 'https://evil.test/' } });
    const pnpm = fakePnpm();
    await expect(publishTarballs({ dir, userconfig: `${dir}.npmrc`, accessPublic: false }, { ...quiet, run: pnpm.run })).rejects.toThrow(
      "sets '@fixture:registry'",
    );
    expect(pnpm.run.calls).toEqual([]);
  });

  it('fails when a tarball named in the manifest is missing', async () => {
    const dir = tarballDir([LIB]);
    fs.rmSync(path.join(dir, LIB.file));
    await expect(publishTarballs({ dir, userconfig: `${dir}.npmrc`, accessPublic: false }, { ...quiet, run: fakePnpm().run })).rejects.toThrow(
      `${LIB.file} is missing`,
    );
  });

  it('runs pnpm outside the tarball directory, so a planted .npmrc is not read', async () => {
    const dir = tarballDir([LIB]);
    fs.writeFileSync(path.join(dir, '.npmrc'), 'registry=https://evil.test/\n');
    const pnpm = fakePnpm();
    await publishTarballs({ dir, userconfig: `${dir}.npmrc`, accessPublic: false }, { ...quiet, run: pnpm.run });
    for (const call of pnpm.run.calls) {
      expect(call.options.cwd).not.toBe(dir);
      expect(fs.readdirSync(call.options.cwd)).toEqual([]);
    }
    expect(pnpm.publishes()[0].args[1]).toBe(path.join(dir, LIB.file));
  });

  it('fails before uploading with pnpm older than 12', async () => {
    const pnpm = fakePnpm({ version: '11.9.0' });
    await expect(publish([LIB], pnpm)).rejects.toThrow('pnpm 11.9.0 is on PATH; the split publish needs pnpm 12 or later');
    expect(pnpm.publishes()).toEqual([]);
  });

  it('does nothing on an empty or missing manifest', async () => {
    const pnpm = fakePnpm();
    expect(await publishTarballs({ dir: tempDir('empty-'), userconfig: '/dev/null', accessPublic: false }, { ...quiet, run: pnpm.run })).toEqual([]);
    expect(pnpm.run.calls).toEqual([]);
  });
});

// Real pnpm, dry run; needs pnpm 12+ on PATH (see hasRealPnpm).
describe.skipIf(!hasRealPnpm())('publishArgs with real pnpm', () => {
  it.each(['next', ''])('pnpm accepts our arguments for a prerelease with tag %j', (tag) => {
    const prerelease = entry('@milaboratories/npm-split-publish-test-does-not-exist', { version: '1.0.0-next.0', tag });
    const dir = tarballDir([prerelease]);
    const result = spawnSync('pnpm', [...publishArgs(prerelease, dir, true), '--dry-run'], { cwd: tempDir('pnpm-dry-run-'), encoding: 'utf8' });
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ name: prerelease.name, version: prerelease.version });
  });
});
