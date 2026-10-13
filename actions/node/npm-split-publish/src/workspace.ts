import * as fs from 'fs';
import * as path from 'path';

import { PackageJson } from './registry';
import { Runner, runChecked } from './run';

export interface WorkspacePackage {
  dir: string;
  manifest: PackageJson & { name: string; version: string };
}

const DEPENDENCY_FIELDS = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'] as const;

/**
 * The packages `pnpm -r publish` would consider: every workspace package
 * except the root, or the root itself when there is no pnpm-workspace.yaml.
 */
export async function listPackages(root: string, run: Runner): Promise<WorkspacePackage[]> {
  const { stdout } = await runChecked(run, 'pnpm', ['ls', '-r', '--depth', '-1', '--json'], { cwd: root });
  const listed = JSON.parse(stdout) as { path: string }[];

  const isWorkspace = fs.existsSync(path.join(root, 'pnpm-workspace.yaml'));
  const rootDir = fs.realpathSync(root);
  const dirs = listed
    .map((p) => fs.realpathSync(p.path))
    .filter((dir) => (isWorkspace ? dir !== rootDir : dir === rootDir));

  return dirs.map((dir) => {
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')) as PackageJson;
    if (!manifest.name || !manifest.version) {
      throw new Error(`${path.join(dir, 'package.json')}: name and version are required`);
    }
    return { dir, manifest: manifest as WorkspacePackage['manifest'] };
  });
}

/**
 * Orders packages so every package comes after the workspace packages it
 * depends on (all dependency fields, as pnpm does). Ties are broken by name.
 * A cycle is reported through `warn` and broken at its first package by name.
 */
export function sortTopologically(packages: WorkspacePackage[], warn: (message: string) => void = () => {}): WorkspacePackage[] {
  const byName = new Map(packages.map((p) => [p.manifest.name, p]));
  const pending = new Map(
    packages.map((p) => {
      const deps = new Set<string>();
      for (const field of DEPENDENCY_FIELDS) {
        for (const dep of Object.keys(p.manifest[field] ?? {})) {
          if (byName.has(dep) && dep !== p.manifest.name) deps.add(dep);
        }
      }
      return [p.manifest.name, deps];
    }),
  );

  const sorted: WorkspacePackage[] = [];
  while (pending.size > 0) {
    const ready = [...pending.entries()].filter(([, deps]) => deps.size === 0).map(([name]) => name);
    let next: string[];
    if (ready.length > 0) {
      next = ready.sort();
    } else {
      // Every remaining package waits on another: a cycle. Release the first
      // by name and keep ordering the rest.
      const stuck = [...pending.keys()].sort();
      warn(`dependency cycle among ${stuck.join(', ')}; publishing ${stuck[0]} first`);
      next = [stuck[0]];
    }
    for (const name of next) {
      sorted.push(byName.get(name)!);
      pending.delete(name);
    }
    for (const deps of pending.values()) {
      for (const name of next) deps.delete(name);
    }
  }
  return sorted;
}
