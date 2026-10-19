import { execFileSync } from 'child_process';
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
export const notFound = (): RunResult => ({ code: 1, stdout: '', stderr: 'npm error code E404\nnpm error 404 Not Found' });

/**
 * Answers `npm view <name>@<version> version` from a fake registry state and
 * runs everything else for real (pnpm, npm config).
 */
export function registryRunner(state: { published?: string[]; existing?: string[]; failing?: string[] }) {
  return fakeRunner((call) => {
    if (call.command !== 'npm' || call.args[0] !== 'view') return undefined;
    const spec = call.args[1];
    const name = spec.slice(0, spec.lastIndexOf('@'));
    if (state.failing?.includes(name)) return { code: 1, stdout: '', stderr: 'npm error code E500' };
    if (state.published?.includes(spec)) return ok(spec.slice(spec.lastIndexOf('@') + 1) + '\n');
    if (state.existing?.includes(name)) return ok('');
    return notFound();
  }, spawnRunner);
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
