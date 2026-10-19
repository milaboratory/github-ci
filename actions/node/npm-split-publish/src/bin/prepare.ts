// Entry point of actions/node/prepare-trusted-publishing, for workflows that
// run `npm publish` themselves on a GitHub-hosted runner.
//
// Env: PACKAGE_DIR (default: the current directory), GITHUB_WORKSPACE (the
// repository root, for `repository.directory`), GITHUB_SERVER_URL,
// GITHUB_REPOSITORY, GITHUB_EVENT_PATH.

import * as core from '@actions/core';
import * as path from 'path';

import { publicSourceRepository } from '../github';
import { ensureRepository } from '../repository';

function main(): void {
  const pkgDir = path.resolve(process.env.PACKAGE_DIR || '.');
  const root = process.env.GITHUB_WORKSPACE || process.cwd();
  const sourceRepository = publicSourceRepository();
  if (!sourceRepository) {
    core.info('Private repository: npm adds no provenance, package.json left as is.');
    return;
  }
  const result = ensureRepository(pkgDir, root, sourceRepository);
  core.info(
    result === 'added'
      ? `Added repository ${sourceRepository} to ${path.join(pkgDir, 'package.json')} for npm provenance.`
      : `package.json already names ${sourceRepository}.`,
  );
}

try {
  main();
} catch (error) {
  core.setFailed((error as Error).message);
}
