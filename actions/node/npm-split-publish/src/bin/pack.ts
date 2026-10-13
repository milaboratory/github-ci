// Entry point of actions/node/pack-unpublished.
//
// Env: OUT_DIR (default $RUNNER_TEMP/npm-tarballs), NPMRC_DIR (default
// $GITHUB_WORKSPACE, else the current directory), GITHUB_SERVER_URL +
// GITHUB_REPOSITORY (the repository name for package.json `repository`). The
// workspace root is the current directory. Outputs: dir, count.

import * as core from '@actions/core';
import * as path from 'path';

import { packWorkspace } from '../pack';
import { spawnRunner } from '../run';

async function main(): Promise<void> {
  const root = process.cwd();
  const outDir = path.resolve(process.env.OUT_DIR || path.join(requireEnv('RUNNER_TEMP'), 'npm-tarballs'));
  const npmrcDir = process.env.NPMRC_DIR || process.env.GITHUB_WORKSPACE || root;

  // github.com only: provenance names https://github.com/<owner>/<repo>.
  const server = process.env.GITHUB_SERVER_URL;
  const sourceRepository =
    server === 'https://github.com' && process.env.GITHUB_REPOSITORY ? `${server}/${process.env.GITHUB_REPOSITORY}` : undefined;

  const entries = await packWorkspace(
    { root, outDir, npmrcDir, sourceRepository },
    { run: spawnRunner, log: core.info, warn: core.warning, group: core.group },
  );

  core.info(`Packed ${entries.length} package(s):`);
  for (const e of entries) core.info(`  ${e.name}@${e.version} -> ${e.registry}`);
  core.setOutput('dir', outDir);
  core.setOutput('count', String(entries.length));
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} must be set`);
  return value;
}

main().catch((error: Error) => core.setFailed(error.message));
