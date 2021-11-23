"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    Object.defineProperty(o, k2, { enumerable: true, get: function() { return m[k]; } });
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
const utils_1 = require("./utils");
const context_1 = __importDefault(require("./context"));
const git_1 = __importDefault(require("./git"));
function generateVersion() {
    return __awaiter(this, void 0, void 0, function* () {
        // Read inputs
        const exactMatch = core.getBooleanInput('exact-match');
        const fetchDepth = parseInt(core.getInput('fetch-depth'));
        const canonize = core.getBooleanInput('canonize');
        const appendHash = core.getBooleanInput('append-hash');
        const appendBuildID = core.getBooleanInput('append-build-id');
        // Initialize storage for evaluated version
        let version = '';
        const refType = process.env.GITHUB_REF_TYPE; // github.context does not support this data yet
        if (refType === 'tag') {
            version = (0, context_1.default)();
        }
        if (version === '') {
            // We failed to get version number from Action Context here.
            // Generate version number from current git repository state.
            version = yield (0, git_1.default)(fetchDepth, exactMatch);
        }
        // Canonize version number to always have <major>.<minor>.<bugfix> format
        if (canonize) {
            version = (0, utils_1.canonizeVersion)(version);
        }
        // Append either build ID or commit hash if requested.
        // Never do both to keep version length short.
        // We can identify exact commit by any of this strings.
        if (appendBuildID) {
            const runID = process.env.GITHUB_RUN_ID;
            version = `${version}-${runID}`;
        }
        else if (appendHash) {
            const sha = process.env.GITHUB_SHA;
            version = `${version}-${sha.substring(0, 6)}`;
        }
        if (version !== '') {
            core.notice(`[autodetect-version]: detected version is ${version}`);
        }
        core.setOutput('version', version);
    });
}
function run() {
    return __awaiter(this, void 0, void 0, function* () {
        const required = core.getBooleanInput('required');
        try {
            yield generateVersion();
        }
        catch (error) {
            if (error instanceof Error) {
                if (required) {
                    core.setFailed(error.message);
                }
                else {
                    core.warning('Failed to detect application version from git history or action run info');
                }
            }
        }
    });
}
run();
