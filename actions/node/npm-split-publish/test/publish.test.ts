import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';

import { ManifestEntry, writeManifest } from '../src/manifest';
import { npmrcFor, publishArgs, publishTarballs } from '../src/publish';
import { Call, fakeRunner, notFound, ok, quiet, tempDir } from './helpers';

const NPMJS = 'https://registry.npmjs.org/';
const GITHUB = 'https://npm.pkg.github.com/';

function entry(name: string, overrides: Partial<ManifestEntry> = {}): ManifestEntry {
  const version = overrides.version ?? '1.0.0';
  const file = `${name.replace('@', '').replace('/', '-')}-${version}.tgz`;
  return { name, version, file, registry: NPMJS, tag: '', access: '', ...overrides };
}

const LIB = entry('@fixture/lib', { access: 'restricted' });
const APP = entry('@fixture/app', { version: '2.0.0', tag: 'next' });

/** A tarball dir with placeholder tarballs; the fake npm never reads them. */
function tarballDir(entries: ManifestEntry[]): string {
  const dir = tempDir('publish-test-');
  for (const e of entries) fs.writeFileSync(path.join(dir, e.file), 'placeholder');
  writeManifest(dir, entries);
  return dir;
}

interface NpmState {
  published?: string[];
  failingPublish?: string[];
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
    expect(publishArgs(APP, '/t', false)).toEqual(['publish', `/t/${APP.file}`, '--ignore-scripts', '--registry', NPMJS, '--tag', 'next']);
    expect(publishArgs(LIB, '/t', false)).toEqual(['publish', `/t/${LIB.file}`, '--ignore-scripts', '--registry', NPMJS, '--access', 'restricted']);
  });

  it('accessPublic overrides the manifest access', () => {
    expect(publishArgs(LIB, '/t', true).slice(-2)).toEqual(['--access', 'public']);
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

  it('fails when a tarball named in the manifest is missing', async () => {
    const dir = tarballDir([LIB]);
    fs.rmSync(path.join(dir, LIB.file));
    await expect(publishTarballs({ dir, userconfig: `${dir}.npmrc`, accessPublic: false }, { ...quiet, run: fakeNpm().run })).rejects.toThrow(
      `${LIB.file} is missing`,
    );
  });

  it('does nothing on an empty or missing manifest', async () => {
    const npm = fakeNpm();
    expect(await publishTarballs({ dir: tempDir('empty-'), userconfig: '/dev/null', accessPublic: false }, { ...quiet, run: npm.run })).toEqual([]);
    expect(npm.run.calls).toEqual([]);
  });
});
