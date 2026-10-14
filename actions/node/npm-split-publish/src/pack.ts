// First half of the split publish: everything `pnpm -r publish` does except
// the registry upload, which `publish` performs on a GitHub-hosted runner (npm
// trusted publishing rejects self-hosted runners).

import * as fs from 'fs';
import * as path from 'path';

import { ManifestEntry, writeManifest } from './manifest';
import { PackageJson, isPublished, resolveRegistry } from './registry';
import { repositoryState, withRepository } from './repository';
import { Runner, runChecked } from './run';
import { readPackedManifest } from './tarball';
import { WorkspacePackage, listPackages, sortTopologically } from './workspace';

export interface PackOptions {
  /** Workspace root (where pnpm-workspace.yaml is). */
  root: string;
  /** Emptied, then receives the tarballs and manifest.jsonl. */
  outDir: string;
  /** Directory of the .npmrc with scope mappings and auth; usually `root`. */
  npmrcDir: string;
  /**
   * https://github.com/<owner>/<repo>, set when the repository being built is
   * public. npm turns provenance on by itself for npmjs uploads from a public
   * repository under trusted publishing, and then requires the package's
   * repository.url to name it: for npmjs targets a missing field is filled in
   * for the pack and a different repository fails the run. Unset (private
   * repository): nothing is checked or added, so no private URL is published.
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

/**
 * What `pnpm publish` runs before packing, in its order. `pnpm pack` runs
 * neither; blocks rely on prepublishOnly (`block-tools publish`,
 * `pl-pkg prepublish`).
 */
const PRE_PACK_SCRIPTS = ['prepublishOnly', 'prepublish'];

interface Planned {
  pkg: WorkspacePackage;
  registry: string;
  /** Repository npm provenance will name, when it applies to this upload. */
  provenanceFrom?: string;
}

/**
 * For every non-private package whose version is not in its registry yet, in
 * dependency order: runs prepublishOnly and prepublish (PRE_PACK_SCRIPTS),
 * then `pnpm pack`, which resolves `workspace:` and `catalog:`. Every package
 * being uploaded is checked before the first script runs, so a bad package
 * fails the run without side effects. See `sourceRepository` for the
 * package.json `repository` handling (repository.ts).
 */
export async function packWorkspace(options: PackOptions, deps: PackDeps): Promise<ManifestEntry[]> {
  const { root, outDir, npmrcDir, sourceRepository } = options;
  const { run, log, warn, group } = deps;

  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });

  const packages = sortTopologically(await listPackages(root, run), warn);

  // What this release uploads: non-private packages whose version is not in
  // their registry yet. Only these are checked; already-published packages
  // keep releasing as before.
  const planned: Planned[] = [];
  for (const pkg of packages) {
    const { name, version } = pkg.manifest;
    if (pkg.manifest.private) {
      continue;
    }
    const registry = await resolveRegistry(pkg.manifest, npmrcDir, run);
    if (await isPublished(name, version, registry, npmrcDir, run)) {
      log(`${name}@${version}: already in ${registry}, skipping`);
      continue;
    }
    // Provenance applies to npmjs uploads from a public repository only.
    const provenanceFrom = sourceRepository && isNpmjs(registry) ? sourceRepository : undefined;
    planned.push({ pkg, registry, provenanceFrom });
  }

  // Every check before the first prepublishOnly, so a bad package fails the
  // run without side effects.
  for (const { pkg, provenanceFrom } of planned) {
    const { name } = pkg.manifest;
    for (const script of UNSUPPORTED_SCRIPTS) {
      if (pkg.manifest.scripts?.[script]) {
        throw new Error(`${name}: '${script}' script is not supported by the split publish (it would run after the upload, on another runner)`);
      }
    }
    if (provenanceFrom && repositoryState(pkg.manifest, provenanceFrom) === 'mismatch') {
      const declared = JSON.stringify(pkg.manifest.repository);
      throw new Error(`${name}: package.json repository ${declared} is not ${provenanceFrom}; npm rejects provenance for a different repository`);
    }
  }

  const entries: ManifestEntry[] = [];
  for (const { pkg, registry, provenanceFrom } of planned) {
    const { name, version } = pkg.manifest;
    const file = await group(`${name}@${version} -> ${registry}`, async () => {
      for (const script of PRE_PACK_SCRIPTS) {
        await runChecked(run, 'pnpm', ['run', '--if-present', script], { cwd: pkg.dir, echo: true });
      }
      const pack = () => packOne(pkg, outDir, run);
      const packed = provenanceFrom ? await withRepository(pkg.dir, root, provenanceFrom, pack) : await pack();
      if (provenanceFrom) {
        // publishConfig.directory and the like pack another package.json;
        // check the field really is in the tarball.
        const inTarball = readPackedManifest(path.join(outDir, packed)) as PackageJson;
        if (repositoryState(inTarball, provenanceFrom) !== 'matches') {
          throw new Error(`${name}: the packed package.json has no repository ${provenanceFrom}; npm would reject its provenance`);
        }
      }
      return packed;
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

function isNpmjs(registry: string): boolean {
  try {
    return new URL(registry).hostname === 'registry.npmjs.org';
  } catch {
    return false;
  }
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
