import { describe, expect, it } from 'vitest';

import { ManifestEntry, formatManifest, parseManifest } from '../src/manifest';

const ENTRY: ManifestEntry = {
  name: '@fixture/lib',
  version: '1.0.0',
  file: 'fixture-lib-1.0.0.tgz',
  registry: 'https://registry.npmjs.org/',
  tag: '',
  access: 'public',
};

describe('manifest', () => {
  it('round-trips entries, one JSON object per line', () => {
    const text = formatManifest([ENTRY, { ...ENTRY, name: '@fixture/app', tag: 'next' }]);
    expect(text.trim().split('\n')).toHaveLength(2);
    expect(parseManifest(text)).toEqual([ENTRY, { ...ENTRY, name: '@fixture/app', tag: 'next' }]);
  });

  it('ignores blank lines and unknown fields', () => {
    expect(parseManifest(`\n${JSON.stringify({ ...ENTRY, extra: 1 })}\n\n`)).toEqual([ENTRY]);
  });

  it.each([
    ['not JSON', 'not json', 'not JSON'],
    ['a non-object', '"text"', 'not an object'],
    ['a missing field', JSON.stringify({ ...ENTRY, tag: undefined }), "'tag' must be a string"],
    ['a non-string field', JSON.stringify({ ...ENTRY, version: 1 }), "'version' must be a string"],
    ['an empty name', JSON.stringify({ ...ENTRY, name: '' }), "'name' is not a valid npm package name"],
    ['a name that reads as an option', JSON.stringify({ ...ENTRY, name: '--registry=https://evil.test' }), "'name' is not a valid npm package name"],
    ['a version that is not semver', JSON.stringify({ ...ENTRY, version: 'latest' }), "'version' is not a semver version"],
    ['a path as file', JSON.stringify({ ...ENTRY, file: '../evil.tgz' }), "'file' must be a .tgz basename"],
    ['a file that reads as an option', JSON.stringify({ ...ENTRY, file: '--evil.tgz' }), "'file' must be a .tgz basename"],
    ['a non-https registry', JSON.stringify({ ...ENTRY, registry: 'http://registry.npmjs.org/' }), "'registry' must be an https URL"],
    ['a tag that reads as an option', JSON.stringify({ ...ENTRY, tag: '--registry=https://evil.test' }), "'tag' is not a valid dist-tag"],
    ['an unknown access', JSON.stringify({ ...ENTRY, access: '--dry-run' }), "'access' must be"],
  ])('rejects %s with the line number', (_case, line, message) => {
    expect(() => parseManifest(`${JSON.stringify(ENTRY)}\n${line}\n`)).toThrow(`manifest.jsonl:2: ${message}`);
  });

  it('refuses to write an invalid entry', () => {
    expect(() => formatManifest([{ ...ENTRY, tag: '-x' }])).toThrow("'tag' is not a valid dist-tag");
  });
});
