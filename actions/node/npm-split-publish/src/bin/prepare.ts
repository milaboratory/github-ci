// Entry point of actions/node/prepare-trusted-publishing, for workflows that
// run `npm publish` themselves on a GitHub-hosted runner.
//
// Env: PACKAGE_DIR (default: the current directory), REGISTRY (the registry
// the job publishes to; package.json publishConfig.registry wins; default
// npmjs), GITHUB_WORKSPACE (the repository root, for `repository.directory`),
// GITHUB_SERVER_URL, GITHUB_REPOSITORY, GITHUB_EVENT_PATH.

import * as core from '@actions/core';
import * as path from 'path';

import { publicSourceRepository } from '../github';
import { prepareRepository } from '../repository';

const MESSAGES = {
  'other-registry': 'Not publishing to registry.npmjs.org: npm adds no provenance there, package.json left as is.',
  'private-repository': 'Private repository: npm adds no provenance, package.json left as is.',
  added: 'Added `repository` to package.json for npm provenance.',
  present: 'package.json `repository` already names this repository.',
};

try {
  const pkgDir = path.resolve(process.env.PACKAGE_DIR || '.');
  const result = prepareRepository({
    pkgDir,
    workspaceRoot: process.env.GITHUB_WORKSPACE || process.cwd(),
    registry: process.env.REGISTRY,
    sourceRepository: publicSourceRepository(),
  });
  core.info(`${path.join(pkgDir, 'package.json')}: ${MESSAGES[result]}`);
} catch (error) {
  core.setFailed((error as Error).message);
}
