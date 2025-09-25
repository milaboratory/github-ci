import * as core from '@actions/core';
import * as glob from '@actions/glob';
import * as artifact from '@actions/artifact';
import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

const STATE_ARTIFACT_STATE = 'post_artifact_state';

async function runMain(): Promise<void> {
  const name = core.getInput('name', { required: true });
  const path = core.getInput('path', { required: false });
  const glob = core.getInput('glob', { required: false });

  const createArchive = core.getInput('archive', { required: false }) === 'true';
  const retentionDays = Number(core.getInput('retention-days', { required: false })) ?? 5;

  if (!path && !glob) {
    core.setFailed(`'path' or 'glob' inputs are required`);
    return;
  }
  if (path && glob) {
    core.setFailed(`'path' and 'glob' inputs cannot be used together`);
    return;
  }

  core.saveState(STATE_ARTIFACT_STATE, 
    {name, path, glob, createArchive, retentionDays}
  );

  core.info('Registered post-step artifact upload to be executed after the job.');
}

async function createTarArchive(files: string[], archivePath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const tar = spawn('tar', ['-c', '-f', archivePath, ...files], { stdio: 'inherit' });
    tar.on('error', err => reject(err));
    tar.on('close', code => {
      if (code === 0) resolve();
      else reject(new Error(`tar command exited with code ${code}`));
    });
  });
}

async function expandGlob(pattern: string): Promise<string[]> {
  if (!pattern) {
    return [];
  }
  const globber = await glob.create(pattern)
  const files = await globber.glob()
  if (files.length === 0) {
    core.warning(`No files found matching pattern: ${pattern}`);
    return [];
  }

  return files;
}

async function expandPaths(...pathList: string[]): Promise<string[]> {
  const filesList: string[] = [];

  for (const pathItem of pathList) {
    if (!pathItem) continue;

    try {
      const stats = await fs.promises.stat(pathItem);

      if (stats.isFile()) {
        // If it's a file, add it directly
        filesList.push(pathItem);
      } else if (stats.isDirectory()) {
        // If it's a directory, recursively process all entries inside
        const entries = await fs.promises.readdir(pathItem, { withFileTypes: true });
        const files = await expandPaths(...entries.map(entry => path.join(pathItem, entry.name)));
        filesList.push(...files);
      }
    } catch (error) {
      core.warning(`Path not found or inaccessible: ${pathItem}`);
    }
  }

  if (filesList.length === 0) {
    core.warning(`No files found in the provided paths`);
  }

  return filesList;
}

async function uploadArtifact(
  name: string,
  toUpload: string[],
  createArchive: boolean,
  retentionDays: number,
): Promise<void> {
  try {
    core.info(`Uploading ${toUpload.length} files:`);
    toUpload.forEach((file) => core.info(`  ${file}`));

    const archiveName = `artifact-${name}.tar`;
    const archivePath = path.join(process.cwd(), archiveName);

    if (createArchive) {
      core.info(`Creating tar archive: ${archivePath}`);
      await createTarArchive(toUpload, archivePath);
      toUpload = [archivePath];
    }

    // Upload artifact
    core.info(`Uploading artifact: ${name}`);
    const artifactClient = new artifact.DefaultArtifactClient()
    const uploadResult = await artifactClient.uploadArtifact(
      name, toUpload, process.cwd(), {
        retentionDays: retentionDays,
      }
    );
    
    core.info(`Artifact uploaded successfully. ID: ${uploadResult.id}`);
    
    if (createArchive) {
      // Clean up tar file
      try {
        await fs.promises.unlink(archivePath);
        core.info('Cleaned up temporary tar file');
      } catch (cleanupError) {
        core.warning(`Failed to clean up tar file: ${cleanupError}`);
      }
    }
  } catch (error) {
    if (error instanceof Error) {
      core.setFailed(`Failed to upload artifact: ${error.message}`);
    } else {
      core.setFailed('An unknown error occurred while uploading artifact');
    }
    throw error;
  }
}

async function runPost(): Promise<void> {
  const {name, path, glob, createArchive, retentionDays} = JSON.parse(core.getState(STATE_ARTIFACT_STATE));
  if (!name) {
    core.info('Empty artifact name. Nowhere to upload');
    return;
  }
  if (!path && !glob) {
    core.info('Empty path. Nothing to upload.');
    return;
  }

  let toUpload: string[]
  if (path) {
    toUpload = await expandPaths(
      path.split('\n').
        map((p: string) => p.trim()).
        filter((p: string) => p !== '')
    );
  } else {
    toUpload = await expandGlob(glob);
  }

  if (toUpload.length === 0) {
    core.info('No files to upload. Nothing to do.');
    return;
  }

  core.startGroup(`Running post-step artifact upload: name=${name}`);
  try {
    await uploadArtifact(name, toUpload, createArchive, retentionDays);
  } finally {
    core.endGroup();
  }
}

async function run(): Promise<void> {
  try {
    // If state is available, we are in the post execution
    if (core.getState(STATE_ARTIFACT_STATE)) {
      await runPost();
    } else {
      await runMain();
    }
  } catch (error) {
    if (error instanceof Error) core.setFailed(error.message);
    else core.setFailed('An unknown error occurred');
  }
}

run();
