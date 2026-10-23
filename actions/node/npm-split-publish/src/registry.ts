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
 * The registry the package is published to: publishConfig.registry, then the
 * scope mapping, then the default registry. `npmrcDir` is where the workspace
 * .npmrc lives; pnpm reads the .npmrc of the project it runs in.
 */
export async function resolveRegistry(pkg: PackageJson & { name: string }, npmrcDir: string, run: Runner): Promise<string> {
  if (pkg.publishConfig?.registry) {
    return pkg.publishConfig.registry;
  }
  const configGet = async (key: string) => {
    const { stdout, stderr } = await runChecked(run, 'pnpm', ['config', 'get', key], { cwd: npmrcDir });
    // pnpm 9 and 10 drop the whole .npmrc, scope mappings included, when a ${VAR} in it is unset.
    if (stderr.includes('Failed to replace env in config')) {
      throw new Error(`${npmrcDir}: pnpm could not read .npmrc, set its env vars:\n${stderr.trim()}`);
    }
    return stdout.trim();
  };

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
  // npm (under pnpm 9 and 10) gives E404 for a missing version and a missing package alike.
  const view = async (args: string[]) => {
    const fullArgs = ['view', ...args, `--registry=${registry}`, '--json'];
    const result = await run('pnpm', fullArgs, { cwd });
    if (result.code === 0) return result.stdout.trim() !== '';
    if (isNotFound(result.stdout)) return false;
    throw new CommandError(['pnpm', ...fullArgs].join(' '), result);
  };
  if (await view([`${name}@${version}`, 'version'])) return 'published';
  return (await view([name, 'name'])) ? 'new-version' : 'new-package';
}

const NOT_FOUND = ['ERR_PNPM_PACKAGE_NOT_FOUND', 'ERR_PNPM_FETCH_404', 'E404'];

function isNotFound(stdout: string): boolean {
  try {
    const code = (JSON.parse(stdout) as { error?: { code?: string } }).error?.code;
    return code !== undefined && NOT_FOUND.includes(code);
  } catch {
    return false;
  }
}

/** Whether name@version is in the registry (see versionState). */
export async function isPublished(name: string, version: string, registry: string, cwd: string, run: Runner): Promise<boolean> {
  return (await versionState(name, version, registry, cwd, run)) === 'published';
}
