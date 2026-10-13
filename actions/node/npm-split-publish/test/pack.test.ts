// Integration tests: real pnpm and `npm config` on a copy of
// fixtures/workspace; only `npm view` (the registry) is faked.
// CI runs this file with pnpm 9.12 (what block repos pin) and pnpm 10.

import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';

import { readManifest } from '../src/manifest';
import { packWorkspace } from '../src/pack';
import { FIXTURES, quiet, registryRunner, tempDir } from './helpers';

/** `@fixture/old` is published at its current version; the rest are new. */
const DEFAULT_STATE = { published: ['@fixture/old@3.0.0'] };

function workspace(extra: string[] = []): { root: string; outDir: string } {
  const base = tempDir('pack-test-');
  const root = path.join(base, 'ws');
  fs.cpSync(path.join(FIXTURES, 'workspace'), root, { recursive: true });
  for (const pkg of extra) {
    fs.cpSync(path.join(FIXTURES, pkg), path.join(root, 'packages', pkg), { recursive: true });
  }
  // pnpm 9 resolves `workspace:` at pack time only after an install, as CI
  // does before packing. No external dependencies, so this stays offline.
  execFileSync('pnpm', ['install', '--silent'], { cwd: root, stdio: 'ignore' });
  return { root, outDir: path.join(base, 'out') };
}

async function pack(state: Parameters<typeof registryRunner>[0] = DEFAULT_STATE, extra: string[] = []) {
  const { root, outDir } = workspace(extra);
  const run = registryRunner(state);
  const entries = await packWorkspace({ root, outDir, npmrcDir: root }, { ...quiet, run });
  return { root, outDir, entries, run };
}

function tarballFile(outDir: string, tarball: string, file: string): string {
  return execFileSync('tar', ['-xOzf', path.join(outDir, tarball), `package/${file}`], { encoding: 'utf8' });
}

describe('packWorkspace', () => {
  it('packs every unpublished non-private package, dependencies first', async () => {
    const { entries } = await pack();
    const names = entries.map((e) => e.name);
    expect([...names].sort()).toEqual(['@fixture/app', '@fixture/lib', 'unscoped-custom']);
    // Name order would put app before lib; app depends on lib.
    expect(names.indexOf('@fixture/lib')).toBeLessThan(names.indexOf('@fixture/app'));
  });

  it('writes the same entries to manifest.jsonl', async () => {
    const { entries, outDir } = await pack();
    expect(readManifest(outDir)).toEqual(entries);
    for (const e of entries) expect(fs.existsSync(path.join(outDir, e.file))).toBe(true);
  });

  it('resolves the registry from publishConfig, then the scope, then the default', async () => {
    const { entries } = await pack();
    const registry = Object.fromEntries(entries.map((e) => [e.name, e.registry]));
    expect(registry['@fixture/lib']).toBe('https://registry.fixture.test/');
    expect(registry['unscoped-custom']).toBe('https://custom.fixture.test/');
  });

  it('carries publishConfig tag and access into the manifest', async () => {
    const { entries } = await pack();
    const byName = Object.fromEntries(entries.map((e) => [e.name, e]));
    expect([byName['@fixture/app'].tag, byName['@fixture/app'].access]).toEqual(['next', '']);
    expect([byName['@fixture/lib'].tag, byName['@fixture/lib'].access]).toEqual(['', 'public']);
  });

  it('runs prepublishOnly before packing', async () => {
    const { entries, outDir } = await pack();
    const lib = entries.find((e) => e.name === '@fixture/lib')!;
    expect(tarballFile(outDir, lib.file, 'prepublished.txt')).toBe('ran');
  });

  it('resolves workspace: dependencies in the tarball', async () => {
    const { entries, outDir } = await pack();
    const app = entries.find((e) => e.name === '@fixture/app')!;
    const manifest = JSON.parse(tarballFile(outDir, app.file, 'package.json'));
    expect(manifest.dependencies['@fixture/lib']).toBe('1.0.0');
  });

  it('packs a package that exists in the registry without this version', async () => {
    const { entries } = await pack({ existing: ['@fixture/old'] });
    expect(entries.map((e) => e.name)).toContain('@fixture/old');
  });

  it('skips private packages and published versions', async () => {
    const { entries } = await pack();
    expect(entries.map((e) => e.name)).not.toContain('@fixture/internal');
    expect(entries.map((e) => e.name)).not.toContain('@fixture/old');
  });

  it('asks each package registry, with the workspace .npmrc', async () => {
    const { run, root } = await pack();
    const view = run.calls.find((c) => c.command === 'npm' && c.args[1] === '@fixture/lib@1.0.0')!;
    expect(view.args).toEqual(['view', '@fixture/lib@1.0.0', 'version', '--registry=https://registry.fixture.test/']);
    expect(view.options.cwd).toBe(root);
  });

  it('returns an empty manifest when everything is published', async () => {
    const { entries, outDir } = await pack({
      published: ['@fixture/old@3.0.0', '@fixture/lib@1.0.0', '@fixture/app@2.0.0', 'unscoped-custom@1.0.0'],
    });
    expect(entries).toEqual([]);
    expect(fs.readFileSync(path.join(outDir, 'manifest.jsonl'), 'utf8')).toBe('');
  });

  it('empties a non-empty output directory first', async () => {
    const { root, outDir } = workspace();
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, 'stale.tgz'), 'stale');
    await packWorkspace({ root, outDir, npmrcDir: root }, { ...quiet, run: registryRunner(DEFAULT_STATE) });
    expect(fs.existsSync(path.join(outDir, 'stale.tgz'))).toBe(false);
  });

  it('fails on a postpublish script before running any prepublishOnly', async () => {
    const { root, outDir } = workspace(['hooks']);
    const run = registryRunner(DEFAULT_STATE);
    await expect(packWorkspace({ root, outDir, npmrcDir: root }, { ...quiet, run })).rejects.toThrow(
      "@fixture/hooks: 'postpublish' script is not supported",
    );
    // lib sorts before hooks and is publishable; its prepublishOnly must not have run.
    expect(fs.existsSync(path.join(root, 'packages', 'lib', 'prepublished.txt'))).toBe(false);
  });

  it('fails when a registry lookup errors with anything but 404', async () => {
    await expect(pack({ ...DEFAULT_STATE, failing: ['@fixture/lib'] })).rejects.toThrow(
      'npm view @fixture/lib@1.0.0 version --registry=https://registry.fixture.test/',
    );
  });
});
