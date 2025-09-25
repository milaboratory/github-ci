"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const core = __importStar(require("@actions/core"));
const glob = __importStar(require("@actions/glob"));
const artifact = __importStar(require("@actions/artifact"));
const node_child_process_1 = require("node:child_process");
const fs = __importStar(require("node:fs"));
const path = __importStar(require("node:path"));
const STATE_ARTIFACT_STATE = 'post_artifact_state';
async function runMain() {
    const name = core.getInput('name', { required: true });
    const path = core.getInput('path', { required: true });
    const retentionDays = Number(core.getInput('retention-days', { required: false })) ?? 5;
    core.saveState(STATE_ARTIFACT_STATE, { name, path, retentionDays });
    core.info('Registered post-step artifact upload to be executed after the job.');
}
async function createTarArchive(files, archivePath) {
    return new Promise((resolve, reject) => {
        const tar = (0, node_child_process_1.spawn)('tar', ['-c', '-f', archivePath, ...files], { stdio: 'inherit' });
        tar.on('error', err => reject(err));
        tar.on('close', code => {
            if (code === 0)
                resolve();
            else
                reject(new Error(`tar command exited with code ${code}`));
        });
    });
}
async function uploadArtifact(name, pathPattern, retentionDays) {
    try {
        const globber = await glob.create(pathPattern);
        const files = await globber.glob();
        if (files.length === 0) {
            core.warning(`No files found matching pattern: ${pathPattern}`);
            return;
        }
        core.info(`Found ${files.length} files to upload:`);
        files.forEach((file) => core.info(`  ${file}`));
        // Create tar archive
        const archiveName = `artifact-${name}.tar`;
        const archivePath = path.join(process.cwd(), archiveName);
        core.info(`Creating tar archive: ${archivePath}`);
        await createTarArchive(files, archivePath);
        // Upload artifact
        core.info(`Uploading artifact: ${name}`);
        const artifactClient = new artifact.DefaultArtifactClient();
        const uploadResult = await artifactClient.uploadArtifact(name, [archivePath], process.cwd(), {
            retentionDays: retentionDays,
        });
        core.info(`Artifact uploaded successfully. ID: ${uploadResult.id}`);
        // Clean up tar file
        try {
            await fs.promises.unlink(archivePath);
            core.info('Cleaned up temporary tar file');
        }
        catch (cleanupError) {
            core.warning(`Failed to clean up tar file: ${cleanupError}`);
        }
    }
    catch (error) {
        if (error instanceof Error) {
            core.setFailed(`Failed to upload artifact: ${error.message}`);
        }
        else {
            core.setFailed('An unknown error occurred while uploading artifact');
        }
        throw error;
    }
}
async function runPost() {
    const { name, path, retentionDays } = JSON.parse(core.getState(STATE_ARTIFACT_STATE));
    if (!name) {
        core.info('Empty artifact name. Nowhere to upload');
        return;
    }
    if (!path) {
        core.info('Empty path. Nothing to upload.');
        return;
    }
    core.startGroup('Running post-step script');
    try {
        await uploadArtifact(name, path, retentionDays);
    }
    finally {
        core.endGroup();
    }
}
async function run() {
    try {
        // If state is available, we are in the post execution
        if (core.getState(STATE_ARTIFACT_STATE)) {
            await runPost();
        }
        else {
            await runMain();
        }
    }
    catch (error) {
        if (error instanceof Error)
            core.setFailed(error.message);
        else
            core.setFailed('An unknown error occurred');
    }
}
run();
//# sourceMappingURL=index.js.map