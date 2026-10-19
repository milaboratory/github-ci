// Entry point of actions/node/publish-tarballs.
//
// Env: TARBALL_DIR (required), ACCESS_PUBLIC ('true'), NPM_AUTH_TOKEN,
// NPMJS_FALLBACK_TOKEN, NPM_PUBLISH_USERCONFIG (default
// $RUNNER_TEMP/publish.npmrc).

import * as core from '@actions/core';
import * as path from 'path';

import { publishTarballs } from '../publish';
import { spawnRunner } from '../run';

async function main(): Promise<void> {
  const dir = requireEnv('TARBALL_DIR');
  const userconfig = process.env.NPM_PUBLISH_USERCONFIG || path.join(requireEnv('RUNNER_TEMP'), 'publish.npmrc');

  const published = await publishTarballs(
    {
      dir,
      accessPublic: process.env.ACCESS_PUBLIC === 'true',
      npmAuthToken: process.env.NPM_AUTH_TOKEN,
      npmjsFallbackToken: process.env.NPMJS_FALLBACK_TOKEN,
      userconfig,
    },
    { run: spawnRunner, log: core.info, group: core.group },
  );
  core.info(`Published ${published.length} package(s).`);
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} must be set`);
  return value;
}

main().catch((error: Error) => core.setFailed(error.message));
