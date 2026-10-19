import { describe, expect, it, vi } from 'vitest';

import { WorkspacePackage, sortTopologically } from '../src/workspace';

function pkg(name: string, deps: Partial<Record<'dependencies' | 'devDependencies' | 'peerDependencies' | 'optionalDependencies', string[]>> = {}): WorkspacePackage {
  const manifest: WorkspacePackage['manifest'] = { name, version: '1.0.0' };
  for (const [field, names] of Object.entries(deps)) {
    (manifest as Record<string, unknown>)[field] = Object.fromEntries(names!.map((n) => [n, 'workspace:*']));
  }
  return { dir: `/ws/${name}`, manifest };
}

const names = (packages: WorkspacePackage[]) => packages.map((p) => p.manifest.name);

describe('sortTopologically', () => {
  it('puts dependencies before dependents', () => {
    const sorted = sortTopologically([pkg('a', { dependencies: ['b'] }), pkg('b', { dependencies: ['c'] }), pkg('c')]);
    expect(names(sorted)).toEqual(['c', 'b', 'a']);
  });

  it('counts every dependency field, as pnpm does', () => {
    const sorted = sortTopologically([
      pkg('a', { devDependencies: ['d'] }),
      pkg('b', { peerDependencies: ['a'] }),
      pkg('c', { optionalDependencies: ['b'] }),
      pkg('d'),
    ]);
    expect(names(sorted)).toEqual(['d', 'a', 'b', 'c']);
  });

  it('ignores external dependencies and breaks ties by name', () => {
    const sorted = sortTopologically([pkg('z', { dependencies: ['react'] }), pkg('m'), pkg('a')]);
    expect(names(sorted)).toEqual(['a', 'm', 'z']);
  });

  it('breaks a cycle at its first package by name and warns', () => {
    const warn = vi.fn();
    const sorted = sortTopologically(
      [pkg('x', { dependencies: ['y'] }), pkg('y', { devDependencies: ['x'] }), pkg('z', { dependencies: ['y'] })],
      warn,
    );
    expect(names(sorted)).toEqual(['x', 'y', 'z']);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('dependency cycle'));
  });
});
