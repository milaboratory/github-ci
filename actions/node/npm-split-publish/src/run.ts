// External commands (pnpm) go through a Runner so tests can replace them.

import { spawn } from 'child_process';

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface RunOptions {
  cwd: string;
  env?: NodeJS.ProcessEnv;
  /** Also stream the command's output to this process's stdout/stderr. */
  echo?: boolean;
}

export type Runner = (command: string, args: string[], options: RunOptions) => Promise<RunResult>;

/** Runs a command; never rejects on a non-zero exit, only when it cannot start. */
export const spawnRunner: Runner = (command, args, { cwd, env, echo }) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env: env ?? process.env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
      if (echo) process.stdout.write(chunk);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
      if (echo) process.stderr.write(chunk);
    });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });

export class CommandError extends Error {
  constructor(
    readonly command: string,
    readonly result: RunResult,
  ) {
    super(`'${command}' exited with ${result.code}${result.stderr ? `:\n${result.stderr.trim()}` : ''}`);
  }
}

/** Like the runner, but throws CommandError on a non-zero exit. */
export async function runChecked(run: Runner, command: string, args: string[], options: RunOptions): Promise<RunResult> {
  const result = await run(command, args, options);
  if (result.code !== 0) {
    throw new CommandError([command, ...args].join(' '), result);
  }
  return result;
}
