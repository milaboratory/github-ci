import * as core from "@actions/core";
import * as glob from "@actions/glob";
import * as artifact from "@actions/artifact";
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

export async function createTarArchive(
  workdir: string,
  files: string[],
  archivePath: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const tar = spawn("tar", ["-C", workdir, "-c", "-f", archivePath, ...files], {
      stdio: "inherit",
    });
    tar.on("error", (err) => reject(err));
    tar.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`tar command exited with code ${code}`));
    });
  });
}

export async function expandGlob(pattern: string): Promise<string[]> {
  if (!pattern) {
    return [];
  }
  const globber = await glob.create(pattern);
  const files = await globber.glob();
  if (files.length === 0) {
    core.warning(`No files found matching pattern: ${pattern}`);
    return [];
  }

  return files;
}

export async function expandPaths(pathList: string[]): Promise<string[]> {
  core.debug(`Expanding paths: ${pathList.join(", ")}`);
  core.debug(`CWD: ${process.cwd()}`);
  const filesList: string[] = [];

  for (const pathItem of pathList) {
    if (!pathItem) continue;

    try {
      core.debug(`Checking path: '${pathItem}'`);

      const stats = await fs.promises.stat(pathItem);
      if (stats.isFile()) {
        core.debug(`Adding file: ${pathItem}`);
        filesList.push(pathItem);
      } else if (stats.isDirectory()) {
        core.debug(`Traversing directory: ${pathItem}`);

        const entries = await fs.promises.readdir(pathItem, {
          withFileTypes: true,
        });
        const files = await expandPaths(
          entries.map((entry) => path.join(pathItem, entry.name)),
        );
        filesList.push(...files);
      }
    } catch (error) {
      core.warning(`Path not found or inaccessible: ${pathItem}`);
      core.debug("error: " + error);
    }
  }

  if (filesList.length === 0) {
    core.warning(`No files found in the provided paths`);
  }

  return filesList;
}

export async function uploadArtifact(
  name: string,
  toUpload: string[],
  createArchive: boolean,
  retentionDays: number,
): Promise<void> {
  try {
    const workspace = process.env.RUNNER_WORKSPACE || process.cwd();
    const workspaceToCWD = path.relative(workspace, process.cwd());

    toUpload = toUpload.map((file) => path.relative(process.cwd(), file)); // abs paths -> relative to current wd.
    toUpload = toUpload.map((file) => path.join(workspaceToCWD, file)); // relative to wd -> relative to workspace.

    core.info(`Uploading ${toUpload.length} workspace files:`);
    toUpload.forEach((file) => core.info(`  ${file}`));

    const archiveName = `artifact-${name}.tar`;
    const archivePath = path.join(workspace, archiveName);

    if (createArchive) {
      core.info(`Creating tar archive: ${archivePath}`);
      await createTarArchive(workspace, toUpload, archivePath);
      toUpload = [archivePath];
    }

    // Upload artifact
    core.info(`Uploading artifact: ${name}`);
    const artifactClient = new artifact.DefaultArtifactClient();
    const uploadResult = await artifactClient.uploadArtifact(
      name,
      toUpload,
      workspace,
      {
        retentionDays: retentionDays,
      },
    );

    core.info(`Artifact uploaded successfully. ID: ${uploadResult.id}`);

    if (createArchive) {
      // Clean up tar file
      try {
        await fs.promises.unlink(archivePath);
        core.info("Cleaned up temporary tar file");
      } catch (cleanupError) {
        core.warning(`Failed to clean up tar file: ${cleanupError}`);
      }
    }
  } catch (error) {
    if (error instanceof Error) {
      core.setFailed(`Failed to upload artifact: ${error.message}`);
    } else {
      core.setFailed("An unknown error occurred while uploading artifact");
    }
    throw error;
  }
}
