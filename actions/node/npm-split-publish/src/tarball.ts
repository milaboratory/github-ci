// The package.json npm will publish from a tarball.
//
// npm (pacote) reads a tarball's manifest by extracting it with node-tar into
// a temporary directory, top directory stripped, and reading package.json
// from there. Doing exactly that, with the same library and options, leaves
// no room for this check and npm to read different manifests: duplicate
// entries, odd path spellings and special entries resolve the same way.
// Options mirror pacote's #tarxOptions (npm 11.21: pacote 21.5.1, tar 7.5.22).

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as tar from 'tar';

export function readPackedManifest(file: string): Record<string, unknown> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'packed-manifest-'));
  try {
    tar.x({
      file,
      cwd: dir,
      sync: true,
      strip: 1,
      noChmod: true,
      noMtime: true,
      preserveOwner: false,
      // pacote extracts files only, never links.
      filter: (_path, entry) => !('type' in entry && /Link$/.test(String(entry.type))),
    });
    const manifest = path.join(dir, 'package.json');
    if (!fs.existsSync(manifest)) {
      throw new Error(`${file}: no package.json`);
    }
    return JSON.parse(fs.readFileSync(manifest, 'utf8')) as Record<string, unknown>;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
