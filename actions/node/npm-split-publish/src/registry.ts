import { CommandError, Runner, runChecked } from './run';

/** The fields of a package.json that the split publish reads. */
export interface PackageJson {
  name?: string;
  version?: string;
  private?: boolean;
  scripts?: Record<string, string>;
  publishConfig?: { registry?: string; tag?: string; access?: string };
  repository?: string | { type?: string; url?: string; directory?: string };
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

/**
 * The registry pnpm publishes the package to: publishConfig.registry, then the
 * scope mapping, then the default registry. `npmrcDir` is where the workspace
 * .npmrc lives; npm only reads the .npmrc of the project it runs in.
 */
export async function resolveRegistry(pkg: PackageJson & { name: string }, npmrcDir: string, run: Runner): Promise<string> {
  if (pkg.publishConfig?.registry) {
    return pkg.publishConfig.registry;
  }
  const configGet = async (key: string) =>
    (await runChecked(run, 'npm', ['config', 'get', key], { cwd: npmrcDir })).stdout.trim();

  if (pkg.name.startsWith('@') && pkg.name.includes('/')) {
    const scoped = await configGet(`${pkg.name.split('/')[0]}:registry`);
    if (scoped !== '' && scoped !== 'undefined') {
      return scoped;
    }
  }
  return configGet('registry');
}

export type VersionState = 'published' | 'new-version' | 'new-package';

/**
 * Where name@version stands in the registry: published, a new version of an
 * existing package, or a package the registry does not have at all. Throws on
 * any lookup failure other than "not found".
 */
export async function versionState(
  name: string,
  version: string,
  registry: string,
  cwd: string,
  run: Runner,
): Promise<VersionState> {
  // npm view name@version: exit 0 + the version when it exists. When it does
  // not, npm < 10 exits 0 with no output, while npm 10+ fails with E404 ("No
  // match found for version"), the same code as for a package that does not
  // exist at all. So on E404, ask for the package itself.
  const args = ['view', `${name}@${version}`, 'version', `--registry=${registry}`];
  const result = await run('npm', args, { cwd });
  if (result.code === 0) {
    return result.stdout.trim() !== '' ? 'published' : 'new-version';
  }
  if (!isNotFound(result)) {
    throw new CommandError(['npm', ...args].join(' '), result);
  }
  const packageArgs = ['view', name, 'name', `--registry=${registry}`];
  const pkg = await run('npm', packageArgs, { cwd });
  if (pkg.code === 0 && pkg.stdout.trim() !== '') {
    return 'new-version';
  }
  if (pkg.code === 0 || isNotFound(pkg)) {
    return 'new-package';
  }
  throw new CommandError(['npm', ...packageArgs].join(' '), pkg);
}

function isNotFound(result: { stdout: string; stderr: string }): boolean {
  return /\bE404\b/.test(result.stderr + result.stdout);
}

/** Whether name@version is in the registry (see versionState). */
export async function isPublished(name: string, version: string, registry: string, cwd: string, run: Runner): Promise<boolean> {
  return (await versionState(name, version, registry, cwd, run)) === 'published';
}
