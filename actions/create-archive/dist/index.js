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
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const core = __importStar(require("@actions/core"));
const fs = __importStar(require("fs/promises"));
const os = __importStar(require("os"));
const path_1 = __importDefault(require("path"));
const jszip_1 = __importDefault(require("jszip"));
const zlib_1 = require("zlib");
const fs_1 = require("fs");
const tar_stream_1 = __importDefault(require("tar-stream"));
// Helpers
// Path Normalization
function sanitizePath(inputPath) {
    return path_1.default.normalize(inputPath).replace(/^(\.\.\\])+/, '');
}
// Pattern Sanitization
function sanitizePattern(pattern) {
    return pattern.replace(/[^a-zA-Z0-9*_.-]/g, '');
}
// Checks if a given filename matches any pattern in a list of patterns.
function matchFilename(filename, patterns) {
    for (const pattern of patterns) {
        const escapeRegex = (string) => string.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
        const regex = new RegExp('^' + pattern.split(/\*+/).map(escapeRegex).join('.*') + '$');
        if (regex.test(filename)) {
            return true;
        }
    }
    return false;
}
// Recursively retrieves all files from a directory.
function getAllFilesFromDir(dir) {
    return __awaiter(this, void 0, void 0, function* () {
        const entries = yield fs.readdir(dir, { withFileTypes: true });
        let files = entries
            .filter(file => !file.isDirectory())
            .map(file => {
            const filePath = path_1.default.join(dir, file.name);
            console.log(`Processing file: ${filePath}`);
            return filePath;
        });
        const directories = entries.filter(directory => directory.isDirectory());
        for (const directory of directories) {
            files = files.concat(yield getAllFilesFromDir(path_1.default.join(dir, directory.name)));
        }
        return files;
    });
}
// Verifies that required GitHub Action inputs are provided.
function checkRequiredInputs(requiredInputs) {
    for (const input of requiredInputs) {
        const value = core.getInput(input);
        if (!value) {
            console.error(`Error: Required input ${input} is missing.`);
            core.setFailed(`Error: Required input ${input} is missing.`);
            process.exit(1);
        }
    }
}
// Create zip archive of the provided files.
function createZipArchive(files, archiveName) {
    return __awaiter(this, void 0, void 0, function* () {
        const zip = new jszip_1.default();
        for (const file of files) {
            const relativePath = path_1.default.relative(process.cwd(), file);
            if ((yield fs.stat(file)).isDirectory()) {
                console.log(`Adding directory to zip archive: ${relativePath}`);
                zip.folder(relativePath);
            }
            else {
                console.log(`Adding file to zip archive: ${relativePath}`);
                const data = yield fs.readFile(file);
                zip.file(relativePath, data);
            }
        }
        const content = yield zip.generateAsync({ type: 'nodebuffer' });
        yield fs.writeFile(archiveName, content);
    });
}
// Creates a tar.gz archive of the provided files.
function createTarGzArchive(files, archiveName) {
    return __awaiter(this, void 0, void 0, function* () {
        const pack = tar_stream_1.default.pack();
        for (const file of files) {
            const relativePath = path_1.default.relative(process.cwd(), file);
            const linkStat = yield fs.lstat(file);
            const permissions = linkStat.mode & 0o777;
            if (linkStat.isDirectory()) {
                console.log(`Adding directory to tar.gz archive: ${relativePath}`);
                pack.entry({ name: relativePath, type: 'directory', mode: permissions });
            }
            else if (linkStat.isSymbolicLink()) {
                const target = yield fs.readlink(file);
                console.log(`Adding symlink to tar.gz archive: ${relativePath} -> ${target}`);
                pack.entry({
                    name: relativePath,
                    type: 'symlink',
                    mode: permissions,
                    linkname: target
                });
            }
            else {
                console.log(`Adding file to tar.gz archive: ${relativePath}`);
                pack.entry({ name: relativePath, mode: permissions }, yield fs.readFile(file));
            }
        }
        pack.finalize();
        const output = (0, fs_1.createWriteStream)(archiveName);
        const gzip = (0, zlib_1.createGzip)();
        pack.pipe(gzip).pipe(output);
    });
}
function main() {
    return __awaiter(this, void 0, void 0, function* () {
        checkRequiredInputs(['source-files']); // Adjust required fields as needed.
        const rawSourceFiles = core
            .getInput('source-files')
            .split('\n')
            .map(item => sanitizePath(item.trim()));
        const includePatterns = core
            .getInput('include-patterns')
            .split('\n')
            .map(item => sanitizePattern(item.trim()));
        const excludePatterns = core
            .getInput('exclude-patterns')
            .split('\n')
            .map(item => sanitizePattern(item.trim()));
        let allFiles = [];
        for (const entry of rawSourceFiles) {
            try {
                const stats = yield fs.stat(entry);
                if (stats.isFile()) {
                    allFiles.push(entry);
                }
                else if (stats.isDirectory()) {
                    const filesFromDir = yield getAllFilesFromDir(entry);
                    allFiles = allFiles.concat(filesFromDir);
                }
            }
            catch (error) {
                if (error instanceof Error) {
                    console.warn(`Warning: Couldn't process entry "${entry}": ${error.message}`);
                }
            }
        }
        const filteredFiles = allFiles.filter(file => matchFilename(path_1.default.basename(file), includePatterns) &&
            !matchFilename(path_1.default.basename(file), excludePatterns));
        const archiveName = core.getInput('archive-name') || 'archive.tgz';
        // OS-based archiving
        const platform = os.platform();
        if (platform === 'win32') {
            console.log('Detected OS: Windows');
            yield createZipArchive(filteredFiles, archiveName);
        }
        else if (platform === 'linux' || platform === 'darwin') {
            console.log('Detected OS: Linux/MacOS');
            yield createTarGzArchive(filteredFiles, archiveName);
        }
        else {
            console.error(`Unsupported platform: ${platform}`);
            core.setFailed(`Error: Unsupported platform ${platform}.`);
            process.exit(1);
        }
    });
}
main().catch(error => {
    core.setFailed(error.message);
});
