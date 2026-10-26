import { execFileSync, spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { RunOptions, RunResult, Runner, spawnRunner } from '../src/run';

export const FIXTURES = path.join(__dirname, 'fixtures');

export interface Call {
  command: string;
  args: string[];
  options: RunOptions;
}

export type Handler = (call: Call) => RunResult | undefined;

/**
 * A Runner that records every call and answers through `handler`. A handler
 * returning undefined passes the call on to `fallback` (default: fail).
 */
export function fakeRunner(handler: Handler, fallback?: Runner): Runner & { calls: Call[] } {
  const calls: Call[] = [];
  const runner = (async (command: string, args: string[], options: RunOptions) => {
    const call = { command, args, options };
    calls.push(call);
    const answer = handler(call);
    if (answer) return answer;
    if (fallback) return fallback(command, args, options);
    throw new Error(`unexpected command: ${command} ${args.join(' ')}`);
  }) as Runner & { calls: Call[] };
  runner.calls = calls;
  return runner;
}

export const ok = (stdout = ''): RunResult => ({ code: 0, stdout, stderr: '' });

/** A failed `pnpm view --json` or `npm view --json`. */
export const viewError = (code: string): RunResult => ({ code: 1, stdout: JSON.stringify({ error: { code } }), stderr: `Error: ${code}` });

/** Fakes `pnpm view` as pnpm 11+, or as npm 10+ / npm < 10 under pnpm 9 and 10; runs other commands for real. */
export function registryRunner(state: { published?: string[]; existing?: string[]; failing?: string[]; npm10?: boolean; legacyNpm?: boolean }) {
  return fakeRunner((call) => {
    if (call.command !== 'pnpm' || call.args[0] !== 'view') return undefined;
    const spec = call.args[1];
    const packageLookup = call.args[2] === 'name';
    const name = packageLookup ? spec : spec.slice(0, spec.lastIndexOf('@'));
    const missingPackage = viewError(state.npm10 || state.legacyNpm ? 'E404' : 'ERR_PNPM_FETCH_404');
    if (state.failing?.includes(name)) return viewError('ERR_PNPM_FETCH_500');
    const known = state.existing?.includes(name) || state.published?.some((p) => p.startsWith(`${name}@`));
    if (packageLookup) return known ? ok(JSON.stringify(name)) : missingPackage;
    if (state.published?.includes(spec)) return ok(JSON.stringify(spec.slice(spec.lastIndexOf('@') + 1)));
    if (!known) return missingPackage;
    if (state.legacyNpm) return ok('');
    return viewError(state.npm10 ? 'E404' : 'ERR_PNPM_PACKAGE_NOT_FOUND');
  }, spawnRunner);
}

/** Whether pnpm 12+ runs from a temp directory; with REQUIRE_REAL_PNPM=1 its absence is an error. */
export function hasRealPnpm(): boolean {
  const { stdout } = spawnSync('pnpm', ['--version'], { cwd: tempDir('pnpm-version-'), encoding: 'utf8' });
  const major = Number((stdout ?? '').split('.')[0]) || 0;
  if (major < 12 && process.env.REQUIRE_REAL_PNPM === '1') {
    throw new Error(`REQUIRE_REAL_PNPM=1, but pnpm ${major || 'is missing'} is not 12+`);
  }
  return major >= 12;
}

export function tempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

export const quiet = {
  log: () => {},
  warn: () => {},
  group: <T>(_title: string, fn: () => Promise<T>) => fn(),
};

/** macOS tar adds ._* AppleDouble entries unless told not to; pnpm pack never does. */
export const TAR_ENV = { ...process.env, COPYFILE_DISABLE: '1' };

/** Writes an npm-style tarball (package/package.json) to dir/file. */
export function makeTarball(dir: string, file: string, manifest: object): void {
  const staging = tempDir('tarball-');
  fs.mkdirSync(path.join(staging, 'package'));
  fs.writeFileSync(path.join(staging, 'package', 'package.json'), JSON.stringify(manifest));
  fs.writeFileSync(path.join(staging, 'package', 'index.js'), 'module.exports = 1;\n');
  execFileSync('tar', ['-czf', path.join(dir, file), '-C', staging, 'package'], { env: TAR_ENV });
}
