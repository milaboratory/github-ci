// Second half of the split publish: uploads what `pack` produced, in manifest
// order. Run it on a GitHub-hosted runner in a job with `id-token: write`:
// npm trusted publishing (OIDC) does not accept self-hosted runners.

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { ManifestEntry, readManifest } from './manifest';
import { isPublished } from './registry';
import { CommandError, Runner, runChecked } from './run';
import { readPackedManifest } from './tarball';

export const NPMJS_HOST = 'registry.npmjs.org';
export const GITHUB_PACKAGES_HOST = 'npm.pkg.github.com';

export interface Credentials {
  /** Token for npm.pkg.github.com (the job's GITHUB_TOKEN). Sent nowhere else. */
  npmAuthToken?: string;
  /**
   * Legacy registry.npmjs.org token. pnpm tries OIDC first and uses it only
   * if the exchange fails. Leave empty to require trusted publishing.
   */
  npmjsFallbackToken?: string;
}

export interface PublishOptions extends Credentials {
  /** Directory with the tarballs and manifest.jsonl. */
  dir: string;
  /** Adds `--access public` to every upload, as `pnpm -r publish --access public` did. */
  accessPublic: boolean;
  /** Auth file (.npmrc format) written for the uploads; nothing else is read. */
  userconfig: string;
}

export interface PublishDeps {
  run: Runner;
  log: (message: string) => void;
  group: <T>(title: string, fn: () => Promise<T>) => Promise<T>;
}

// The tarball check reads the manifest the way pnpm 12 does.
const MIN_PNPM_MAJOR = 12;

// Env var names the generated auth file refers to; pnpm expands them when it
// reads the file, so the file itself holds no secret.
const NPM_AUTH_TOKEN_VAR = 'NPM_AUTH_TOKEN';
const NPMJS_FALLBACK_TOKEN_VAR = 'NPMJS_FALLBACK_TOKEN';

/**
 * Auth file for uploading `entries`. Every registry must be https on a
 * supported host: pnpm attaches a token by host whatever the scheme, and the
 * GitHub token must reach GitHub Packages only. Throws before anything is
 * uploaded otherwise.
 */
export function npmrcFor(entries: ManifestEntry[], credentials: Credentials): string {
  const lines = new Set<string>();
  for (const registry of new Set(entries.map((e) => e.registry))) {
    let url: URL;
    try {
      url = new URL(registry);
    } catch {
      throw new Error(`${registry}: not a URL`);
    }
    if (url.protocol !== 'https:') {
      throw new Error(`${registry}: only https registries are supported`);
    }
    if (url.username || url.password || url.port) {
      throw new Error(`${registry}: registry URLs with credentials or a port are not supported`);
    }
    switch (url.hostname) {
      case NPMJS_HOST:
        if (credentials.npmjsFallbackToken) {
          lines.add(`//${NPMJS_HOST}/:_authToken=\${${NPMJS_FALLBACK_TOKEN_VAR}}`);
        }
        break;
      case GITHUB_PACKAGES_HOST:
        if (!credentials.npmAuthToken) {
          throw new Error(`${registry}: npm-auth-token is empty`);
        }
        lines.add(`//${GITHUB_PACKAGES_HOST}/:_authToken=\${${NPM_AUTH_TOKEN_VAR}}`);
        break;
      default:
        throw new Error(`${registry}: no credentials for this registry (supported: ${NPMJS_HOST}, ${GITHUB_PACKAGES_HOST})`);
    }
  }
  return [...lines].map((l) => l + '\n').join('');
}

/** Refuses packed manifest keys that pnpm 12 prefers to our flags: `tag`, `publishConfig` registries. */
export function checkPackedManifest(label: string, packed: { tag?: unknown; publishConfig?: unknown }, entry: ManifestEntry): void {
  if (packed.tag !== undefined && packed.tag !== (entry.tag || 'latest')) {
    throw new Error(`${label}: packed package.json sets tag ${JSON.stringify(packed.tag)}, not '${entry.tag || 'latest'}'`);
  }
  checkPackedPublishConfig(label, packed.publishConfig, entry.registry);
}

function checkPackedPublishConfig(label: string, publishConfig: unknown, registry: string): void {
  if (publishConfig === undefined) return;
  if (typeof publishConfig !== 'object' || publishConfig === null) {
    throw new Error(`${label}: packed publishConfig is not an object`);
  }
  for (const [key, value] of Object.entries(publishConfig)) {
    if (/^@[^/]+:registry$/i.test(key)) {
      throw new Error(`${label}: packed publishConfig sets '${key}', which the split publish does not allow`);
    }
    if (key.toLowerCase() === 'registry' && String(value).replace(/\/+$/, '') !== registry.replace(/\/+$/, '')) {
      throw new Error(`${label}: packed publishConfig.registry ${String(value)} is not ${registry}`);
    }
  }
}

/** `pnpm publish` arguments for one entry. */
export function publishArgs(entry: ManifestEntry, dir: string, accessPublic: boolean): string[] {
  // `--flag=value` keeps a value from being read as an option, on top of the
  // manifest validation.
  const args = ['publish', path.resolve(dir, entry.file), `--registry=${entry.registry}`, '--json'];
  if (entry.tag) {
    args.push(`--tag=${entry.tag}`);
  }
  if (accessPublic) {
    args.push('--access=public');
  } else if (entry.access) {
    args.push(`--access=${entry.access}`);
  }
  return args;
}

/**
 * Uploads every entry not yet in its registry, in manifest order, stopping at
 * the first failure. Re-runnable: published versions are skipped.
 */
export async function publishTarballs(options: PublishOptions, deps: PublishDeps): Promise<ManifestEntry[]> {
  const { dir, accessPublic, userconfig } = options;
  const { run, log, group } = deps;

  const entries = readManifest(dir);
  if (entries.length === 0) {
    log('Nothing to publish.');
    return [];
  }
  // pnpm publishes whatever name/version the tarball holds, so the manifest
  // alone is not enough: check every tarball before the first upload.
  for (const entry of entries) {
    const label = `${entry.name}@${entry.version}`;
    const tarball = path.join(dir, entry.file);
    if (!fs.existsSync(tarball)) {
      throw new Error(`${label}: ${entry.file} is missing from ${dir}`);
    }
    const packed = readPackedManifest(tarball) as { name?: unknown; version?: unknown; tag?: unknown; publishConfig?: unknown };
    if (packed.name !== entry.name || packed.version !== entry.version) {
      throw new Error(`${label}: ${entry.file} contains ${String(packed.name)}@${String(packed.version)}`);
    }
    checkPackedManifest(label, packed, entry);
  }

  fs.writeFileSync(userconfig, npmrcFor(entries, options));
  // An empty directory, so pnpm reads no .npmrc or pnpm-workspace.yaml from the artifact.
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'pnpm-publish-'));
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PNPM_CONFIG_NPMRC_AUTH_FILE: userconfig,
    [NPM_AUTH_TOKEN_VAR]: options.npmAuthToken ?? '',
    [NPMJS_FALLBACK_TOKEN_VAR]: options.npmjsFallbackToken ?? '',
  };
  const envRun: Runner = (command, args, runOptions) => run(command, args, { ...runOptions, env });

  const pnpmVersion = (await runChecked(envRun, 'pnpm', ['--version'], { cwd })).stdout.trim();
  if (Number(pnpmVersion.split('.')[0]) < MIN_PNPM_MAJOR) {
    throw new Error(`pnpm ${pnpmVersion} is on PATH; the split publish needs pnpm ${MIN_PNPM_MAJOR} or later`);
  }

  const published: ManifestEntry[] = [];
  for (const entry of entries) {
    const label = `${entry.name}@${entry.version}`;
    if (await isPublished(entry.name, entry.version, entry.registry, cwd, envRun)) {
      log(`${label}: already in ${entry.registry}, skipping`);
      continue;
    }
    const result = await group(`${label} -> ${entry.registry}`, () =>
      envRun('pnpm', publishArgs(entry, dir, accessPublic), { cwd, echo: true }),
    );
    if (result.code !== 0) {
      // A version the lookup could not see, e.g. a restricted package queried
      // without a token on a re-run: the registry refuses it as a duplicate.
      if (/You cannot publish over the previously published versions/.test(result.stderr + result.stdout)) {
        log(`${label}: already in ${entry.registry} (refused as a duplicate), skipping`);
        continue;
      }
      throw new CommandError(['pnpm', ...publishArgs(entry, dir, accessPublic)].join(' '), result);
    }
    published.push(entry);
  }
  return published;
}
