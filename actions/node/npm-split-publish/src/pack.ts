// First half of the split publish: everything `pnpm -r publish` does except
// the registry upload, which `publish` performs on a GitHub-hosted runner (npm
// trusted publishing rejects self-hosted runners).

import * as fs from 'fs';
import * as path from 'path';

import { ManifestEntry, writeManifest } from './manifest';
import { isPublished, resolveRegistry } from './registry';
import { repositoryState, withRepository } from './repository';
import { Runner, runChecked } from './run';
import { WorkspacePackage, listPackages, sortTopologically } from './workspace';

export interface PackOptions {
  /** Workspace root (where pnpm-workspace.yaml is). */
  root: string;
  /** Emptied, then receives the tarballs and manifest.jsonl. */
  outDir: string;
  /** Directory of the .npmrc with scope mappings and auth; usually `root`. */
  npmrcDir: string;
  /**
   * https://github.com/<owner>/<repo> of the repository being built. npm
   * provenance (on by default under trusted publishing) requires the
   * package's repository.url to name it: a missing field is filled in for the
   * pack, a different repository fails the run. Unset: no check.
   */
  sourceRepository?: string;
}

export interface PackDeps {
  run: Runner;
  log: (message: string) => void;
  warn: (message: string) => void;
  /** Wraps one package's output (a log group in Actions). */
  group: <T>(title: string, fn: () => Promise<T>) => Promise<T>;
}

/**
 * Scripts `pnpm publish` runs after the upload. The upload now happens on
 * another runner, so a package defining one cannot be published this way.
 */
const UNSUPPORTED_SCRIPTS = ['publish', 'postpublish'];

interface Planned {
  pkg: WorkspacePackage;
  registry: string;
}

/**
 * For every non-private package whose version is not in its registry yet, in
 * dependency order: runs prepublishOnly (pnpm pack does not; blocks rely on it
 * for `block-tools publish` / `pl-pkg prepublish`), then `pnpm pack`, which
 * resolves `workspace:` and `catalog:`. Every package is checked before the
 * first prepublishOnly runs, so a bad package fails the run without side
 * effects. With `sourceRepository`, a missing package.json `repository` is
 * filled in for the pack (see repository.ts).
 */
export async function packWorkspace(options: PackOptions, deps: PackDeps): Promise<ManifestEntry[]> {
  const { root, outDir, npmrcDir, sourceRepository } = options;
  const { run, log, warn, group } = deps;

  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });

  const packages = sortTopologically(await listPackages(root, run), warn);

  const planned: Planned[] = [];
  for (const pkg of packages) {
    const { name, version } = pkg.manifest;
    if (pkg.manifest.private) {
      continue;
    }
    for (const script of UNSUPPORTED_SCRIPTS) {
      if (pkg.manifest.scripts?.[script]) {
        throw new Error(`${name}: '${script}' script is not supported by the split publish (it would run after the upload, on another runner)`);
      }
    }
    if (sourceRepository && repositoryState(pkg.manifest, sourceRepository) === 'mismatch') {
      const declared = JSON.stringify(pkg.manifest.repository);
      throw new Error(`${name}: package.json repository ${declared} is not ${sourceRepository}; npm rejects provenance for a different repository`);
    }
    const registry = await resolveRegistry(pkg.manifest, npmrcDir, run);
    if (await isPublished(name, version, registry, npmrcDir, run)) {
      log(`${name}@${version}: already in ${registry}, skipping`);
      continue;
    }
    planned.push({ pkg, registry });
  }

  const entries: ManifestEntry[] = [];
  for (const { pkg, registry } of planned) {
    const { name, version } = pkg.manifest;
    const file = await group(`${name}@${version} -> ${registry}`, async () => {
      await runChecked(run, 'pnpm', ['run', '--if-present', 'prepublishOnly'], { cwd: pkg.dir, echo: true });
      const pack = () => packOne(pkg, outDir, run);
      return sourceRepository ? withRepository(pkg.dir, root, sourceRepository, pack) : pack();
    });
    entries.push({
      name,
      version,
      file,
      registry,
      tag: pkg.manifest.publishConfig?.tag ?? '',
      access: pkg.manifest.publishConfig?.access ?? '',
    });
  }

  writeManifest(outDir, entries);
  return entries;
}

/** Packs into outDir and returns the new tarball's basename. */
async function packOne(pkg: WorkspacePackage, outDir: string, run: Runner): Promise<string> {
  const before = new Set(tarballs(outDir));
  await runChecked(run, 'pnpm', ['pack', '--pack-destination', outDir], { cwd: pkg.dir, echo: true });
  const created = tarballs(outDir).filter((f) => !before.has(f));
  if (created.length !== 1) {
    throw new Error(`${pkg.manifest.name}: expected pnpm pack to create one tarball in ${outDir}, found ${created.length}`);
  }
  return created[0];
}

function tarballs(dir: string): string[] {
  return fs.readdirSync(dir).filter((f) => f.endsWith('.tgz') && fs.statSync(path.join(dir, f)).isFile());
}
