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
Object.defineProperty(exports, "__esModule", { value: true });
const core = __importStar(require("@actions/core"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
// Get the package name and version from package.json located at the given path.
function getPackageJSON(packagePath) {
    const fullPath = path.join(packagePath, 'package.json');
    if (!fs.existsSync(fullPath)) {
        throw new Error(`package.json not found at path: ${fullPath}`);
    }
    const rawData = fs.readFileSync(fullPath, 'utf-8');
    const packageJson = JSON.parse(rawData);
    if (!packageJson.name || !packageJson.version) {
        throw new Error('package.json must contain both name and version properties.');
    }
    return {
        name: packageJson.name,
        version: packageJson.version
    };
}
function main() {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            // Get inputs
            const packagePath = core.getInput('package-json-path');
            const npmRegistryUrl = core.getInput('npm-registry-url');
            // Get name and version from package.json
            const { name: packageName, version: packageVersion } = getPackageJSON(packagePath);
            // Check if package exists in the registry
            const fetchUrl = `${npmRegistryUrl}/${packageName}/v/${packageVersion}`;
            console.log(`Fetching: ${fetchUrl}`);
            const response = yield fetch(fetchUrl);
            if (response.ok) {
                core.setOutput('exists', '1');
                console.log(`Package ${packageName}@${packageVersion} found in registry.`);
            }
            else if (response.status === 404) {
                core.setOutput('exists', '0');
                console.log(`Package ${packageName}@${packageVersion} not found in registry.`);
            }
            else {
                throw new Error(`Unexpected response: ${response.statusText}, status code: ${response.status}`);
            }
        }
        catch (error) {
            if (error instanceof Error) {
                core.setFailed(error.message);
            }
            else {
                core.setFailed('An unexpected error occurred.');
            }
        }
    });
}
main().catch(error => {
    core.setFailed(error.message);
});
