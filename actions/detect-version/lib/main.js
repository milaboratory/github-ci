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
Object.defineProperty(exports, "__esModule", { value: true });
const core = __importStar(require("@actions/core"));
const utils_1 = require("./utils");
const milib_1 = require("milib");
function prepareRepository(depth) {
    return __awaiter(this, void 0, void 0, function* () {
        yield milib_1.git.fetchTags();
        return milib_1.git.ensureHistorySize(depth);
    });
}
function currentTag() {
    return __awaiter(this, void 0, void 0, function* () {
        return milib_1.git.describe({
            tags: true,
            abbrev: 0,
            exactMatch: true
        });
    });
}
function previousTag() {
    return __awaiter(this, void 0, void 0, function* () {
        return yield milib_1.git.describe({
            tags: true,
            abbrev: 0,
            ref: 'HEAD^'
        });
    });
}
function commitsCount(startRef, endRef) {
    return __awaiter(this, void 0, void 0, function* () {
        const commits = yield milib_1.git.revList({ ref: `${startRef}..${endRef}` });
        return commits.length;
    });
}
function genDevVersion(baseVersion, baseRef) {
    return __awaiter(this, void 0, void 0, function* () {
        const currentRefName = process.env.GITHUB_REF_NAME;
        const count = yield commitsCount(baseRef, 'HEAD');
        return `${baseVersion}-${count}-${currentRefName}`;
    });
}
function detectVersions() {
    return __awaiter(this, void 0, void 0, function* () {
        // Read inputs
        const fetchDepth = parseInt(core.getInput('fetch-depth'));
        const canonize = core.getBooleanInput('canonize');
        yield prepareRepository(fetchDepth);
        const prevTag = yield previousTag();
        const prevSha = yield milib_1.git.resolveRef(prevTag);
        let prevVersion = (0, utils_1.sanitizeVersion)(prevTag);
        const curSha = yield milib_1.git.resolveRef('HEAD');
        let curTag = '';
        let curVersion = '';
        try {
            curTag = yield currentTag();
            curVersion = (0, utils_1.sanitizeVersion)(curTag);
        }
        catch (error) {
            if (!(error instanceof Error)) {
                throw error;
            }
            core.notice(`Current commit seems to have no tag. Version number will be generated.\n${error.message}`);
            curVersion = yield genDevVersion(prevVersion, prevTag);
        }
        // Canonize version number so it always has <major>.<minor>.<patch> format
        if (canonize) {
            if (curTag) {
                curVersion = (0, utils_1.canonizeVersion)(curVersion);
            }
            if (prevTag) {
                prevVersion = (0, utils_1.canonizeVersion)(prevVersion);
            }
        }
        core.debug(`current version: '${curVersion}'
current tag: '${curTag}'
previous version: '${prevVersion}'
previous tag: '${prevTag}'`);
        core.setOutput('version', curVersion);
        core.setOutput('tag', curTag);
        core.setOutput('sha', curSha);
        core.setOutput('prev-version', prevVersion);
        core.setOutput('prev-tag', prevTag);
        core.setOutput('prev-sha', prevSha);
    });
}
function run() {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            yield detectVersions();
        }
        catch (error) {
            if (error instanceof Error) {
                core.setFailed(error.message);
                return;
            }
            throw error;
        }
    });
}
run();
