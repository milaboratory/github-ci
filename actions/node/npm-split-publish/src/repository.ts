// package.json `repository` vs the repository that builds the package.
//
// Under trusted publishing npm turns provenance on by itself for a public
// package from a public repository, and the registry then rejects the upload
// (E422) unless the package's repository.url names the repository in the
// provenance. Most of our package.json files have no `repository` at all.

import * as fs from 'fs';
import * as path from 'path';

import { PackageJson } from './registry';

type Repository = PackageJson['repository'];

/**
 * A repository reference in comparable form: https://github.com/owner/repo,
 * lowercased. Undefined for an absent or unrecognised value.
 */
export function normalizeRepository(value: Repository): string | undefined {
  const raw = (typeof value === 'string' ? value : value?.url)?.trim();
  if (!raw) return undefined;

  let url = raw;
  const shorthand = /^(?:github:)?([\w.-]+\/[\w.-]+)$/.exec(url);
  if (shorthand) {
    url = `https://github.com/${shorthand[1]}`;
  }
  url = url
    .replace(/^git\+/, '')
    .replace(/^git@github\.com:/, 'https://github.com/')
    .replace(/^(?:ssh:\/\/git@|git:\/\/|http:\/\/)github\.com\//, 'https://github.com/')
    .replace(/\.git$/, '')
    .replace(/\/+$/, '');
  return /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+$/.test(url) ? url.toLowerCase() : undefined;
}

export type RepositoryState = 'missing' | 'matches' | 'mismatch';

export function repositoryState(manifest: PackageJson, sourceRepository: string): RepositoryState {
  if (manifest.repository === undefined || manifest.repository === '') return 'missing';
  return normalizeRepository(manifest.repository) === normalizeRepository(sourceRepository) ? 'matches' : 'mismatch';
}

/** The `repository` value pack and prepare write for a package. */
export function repositoryField(pkgDir: string, workspaceRoot: string, sourceRepository: string) {
  const directory = path.relative(fs.realpathSync(workspaceRoot), fs.realpathSync(pkgDir)).split(path.sep).join('/');
  return {
    type: 'git',
    url: `git+${sourceRepository.replace(/\/+$/, '')}.git`,
    ...(directory ? { directory } : {}),
  };
}

/**
 * Runs `fn` with `repository` set to `sourceRepository` in pkgDir/package.json
 * when the field is missing, and restores the file afterwards. The packed
 * tarball carries the field; the checkout is left as it was.
 */
export async function withRepository<T>(
  pkgDir: string,
  workspaceRoot: string,
  sourceRepository: string,
  fn: () => Promise<T>,
): Promise<T> {
  const file = path.join(pkgDir, 'package.json');
  const original = fs.readFileSync(file, 'utf8');
  const manifest = JSON.parse(original) as PackageJson;
  if (repositoryState(manifest, sourceRepository) !== 'missing') {
    return fn();
  }
  const repository = repositoryField(pkgDir, workspaceRoot, sourceRepository);
  fs.writeFileSync(file, JSON.stringify({ ...manifest, repository }, null, 2) + '\n');
  try {
    return await fn();
  } finally {
    fs.writeFileSync(file, original);
  }
}

/**
 * For workflows that run `npm publish` in the package directory: writes a
 * missing `repository` into pkgDir/package.json for good (the CI checkout is
 * thrown away) and throws when it names a different repository.
 */
export function ensureRepository(pkgDir: string, workspaceRoot: string, sourceRepository: string): 'added' | 'present' {
  const file = path.join(pkgDir, 'package.json');
  const manifest = JSON.parse(fs.readFileSync(file, 'utf8')) as PackageJson & { name?: string };
  switch (repositoryState(manifest, sourceRepository)) {
    case 'matches':
      return 'present';
    case 'mismatch':
      throw new Error(
        `${manifest.name ?? file}: package.json repository ${JSON.stringify(manifest.repository)} is not ${sourceRepository}; npm rejects provenance for a different repository`,
      );
    case 'missing': {
      const repository = repositoryField(pkgDir, workspaceRoot, sourceRepository);
      fs.writeFileSync(file, JSON.stringify({ ...manifest, repository }, null, 2) + '\n');
      return 'added';
    }
  }
}

export type PrepareResult = 'other-registry' | 'private-repository' | 'added' | 'present';

/**
 * What prepare-trusted-publishing does for one package: leaves it alone for
 * a registry other than npmjs (publishConfig.registry wins over `registry`)
 * or a private repository (no provenance), otherwise ensureRepository.
 */
export function prepareRepository(options: {
  pkgDir: string;
  workspaceRoot: string;
  registry?: string;
  sourceRepository?: string;
}): PrepareResult {
  const manifest = JSON.parse(fs.readFileSync(path.join(options.pkgDir, 'package.json'), 'utf8')) as PackageJson;
  const registry = manifest.publishConfig?.registry || options.registry || 'https://registry.npmjs.org/';
  let host = '';
  try {
    host = new URL(registry).hostname;
  } catch {
    /* not a URL: treated as another registry */
  }
  if (host !== 'registry.npmjs.org') return 'other-registry';
  if (!options.sourceRepository) return 'private-repository';
  return ensureRepository(options.pkgDir, options.workspaceRoot, options.sourceRepository);
}
