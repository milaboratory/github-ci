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
/**
 * Check if action was started from branch AND current commit is
 * repository's branch head.
 */
function isBranchHead() {
    return __awaiter(this, void 0, void 0, function* () {
        const refType = process.env.GITHUB_REF_TYPE;
        const refName = process.env.GITHUB_REF_NAME;
        const currentSha = process.env.GITHUB_SHA;
        if (refType !== 'branch') {
            return false;
        }
        yield milib_1.git.fetch({
            deepen: 1,
            remote: 'origin',
            refSpec: refName
        });
        const remoteRefSha = yield milib_1.git.resolveRef(`origin/${refName}`);
        return remoteRefSha === currentSha;
    });
}
function detectVersions() {
    return __awaiter(this, void 0, void 0, function* () {
        // Read inputs
        const fetchDepth = parseInt(core.getInput('fetch-depth'));
        const canonize = core.getBooleanInput('canonize');
        yield prepareRepository(fetchDepth);
        const latestTag = yield milib_1.git.latestVersionTag();
        const latestSha = yield milib_1.git.resolveRef(latestTag);
        let latestVersion = (0, utils_1.sanitizeVersion)(latestTag);
        const prevTag = yield milib_1.git.previousTag();
        const prevSha = yield milib_1.git.resolveRef(prevTag);
        let prevVersion = (0, utils_1.sanitizeVersion)(prevTag);
        const curSha = yield milib_1.git.resolveRef('HEAD');
        let curTag = '';
        let curVersion = '';
        try {
            curTag = yield milib_1.git.currentTag();
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
            if (latestTag) {
                latestVersion = (0, utils_1.canonizeVersion)(latestVersion);
            }
        }
        core.debug(`current version: '${curVersion}'
current tag: '${curTag}'

previous version: '${prevVersion}'
previous tag: '${prevTag}'

latest version: '${latestVersion}'
latest tag: '${latestTag}'
`);
        core.setOutput('current-version', curVersion);
        core.setOutput('current-tag', curTag);
        core.setOutput('current-sha', curSha);
        core.setOutput('previous-version', prevVersion);
        core.setOutput('previous-tag', prevTag);
        core.setOutput('previous-sha', prevSha);
        core.setOutput('latest-tag', latestTag);
        core.setOutput('latest-sha', latestSha);
        core.setOutput('latest-version', latestVersion);
        core.setOutput('is-branch-head', yield isBranchHead());
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
