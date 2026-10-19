// Entry point of actions/node/pack-unpublished.
//
// Env: OUT_DIR (default $RUNNER_TEMP/npm-tarballs), NPMRC_DIR (default
// $GITHUB_WORKSPACE, else the current directory), GITHUB_SERVER_URL,
// GITHUB_REPOSITORY and GITHUB_EVENT_PATH (whether and how package.json
// `repository` is checked; see PackOptions.sourceRepository). The workspace
// root is the current directory. Outputs: dir, count.

import * as core from '@actions/core';
import * as fs from 'fs';
import * as path from 'path';

import { packWorkspace } from '../pack';
import { spawnRunner } from '../run';

async function main(): Promise<void> {
  const root = process.cwd();
  const outDir = path.resolve(process.env.OUT_DIR || path.join(requireEnv('RUNNER_TEMP'), 'npm-tarballs'));
  const npmrcDir = process.env.NPMRC_DIR || process.env.GITHUB_WORKSPACE || root;

  const sourceRepository = publicSourceRepository();

  const entries = await packWorkspace(
    { root, outDir, npmrcDir, sourceRepository },
    { run: spawnRunner, log: core.info, warn: core.warning, group: core.group },
  );

  core.info(`Packed ${entries.length} package(s):`);
  for (const e of entries) core.info(`  ${e.name}@${e.version} -> ${e.registry}`);
  core.setOutput('dir', outDir);
  core.setOutput('count', String(entries.length));
}

/**
 * https://github.com/<owner>/<repo> when the repository being built is public
 * on github.com, the only case where npm adds provenance on its own. The
 * event payload says whether the repository is private.
 */
function publicSourceRepository(): string | undefined {
  const { GITHUB_SERVER_URL: server, GITHUB_REPOSITORY: repository, GITHUB_EVENT_PATH: eventPath } = process.env;
  if (server !== 'https://github.com' || !repository || !eventPath || !fs.existsSync(eventPath)) {
    return undefined;
  }
  const event = JSON.parse(fs.readFileSync(eventPath, 'utf8')) as { repository?: { private?: boolean } };
  return event.repository?.private === false ? `${server}/${repository}` : undefined;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} must be set`);
  return value;
}

main().catch((error: Error) => core.setFailed(error.message));
