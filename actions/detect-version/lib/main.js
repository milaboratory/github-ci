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
const utils = __importStar(require("./utils"));
const milib_1 = require("milib");
function prepareRepository(depth) {
    return __awaiter(this, void 0, void 0, function* () {
        // We have to do black magic here because of
        // https://github.com/milaboratory/github-ci/issues/13
        const refType = process.env.GITHUB_REF_TYPE;
        const refName = process.env.GITHUB_REF_NAME;
        if (refType === 'tag') {
            // force-fetch current tag from origin
            yield milib_1.git.fetch({
                remote: 'origin',
                refSpec: `refs/tags/${refName}:refs/tags/${refName}`,
                deepen: 1,
                forceFlag: true
            });
        }
        yield milib_1.git.fetchTags();
        return milib_1.git.ensureHistorySize(depth);
    });
}
function genDevVersion(baseVersion, baseRef) {
    return __awaiter(this, void 0, void 0, function* () {
        const currentRefName = process.env.GITHUB_REF_NAME;
        const count = yield milib_1.git.countCommits(baseRef, 'HEAD');
        return {
            major: baseVersion.major,
            minor: baseVersion.minor,
            patch: baseVersion.patch,
            suffix: `${count}-${currentRefName}`,
            original: `${baseVersion.original}-${count}-${currentRefName}`,
            semver: true
        };
    });
}
function detectVersions() {
    return __awaiter(this, void 0, void 0, function* () {
        // Read inputs
        const fetchDepth = parseInt(core.getInput('fetch-depth'));
        yield prepareRepository(fetchDepth);
        const isRemoteLatestCommit = yield utils.isBranchHead();
        const knownVersions = yield utils.getVersions();
        const latestTag = utils.latestVersionTag(knownVersions);
        const latestSha = yield milib_1.git.resolveRef(latestTag);
        const latestVersion = knownVersions[latestTag];
        const prevTag = yield milib_1.git.previousTag();
        const prevSha = yield milib_1.git.resolveRef(prevTag);
        const prevVersion = knownVersions[prevTag];
        const curSha = yield milib_1.git.resolveRef('HEAD');
        let curTag = '';
        let curVersion;
        try {
            curTag = yield milib_1.git.currentTag();
            curVersion = knownVersions[curTag];
        }
        catch (error) {
            if (!(error instanceof Error)) {
                throw error;
            }
            core.notice(`Current commit seems to have no tag. Version number will be generated.\n${error.message}`);
            curVersion = yield genDevVersion(prevVersion, prevTag);
        }
        core.debug(`current version: '${curVersion.original}'
current tag: '${curTag}'

previous version: '${prevVersion.original}'
previous tag: '${prevTag}'

latest version: '${latestVersion.original}'
latest tag: '${latestTag}'
`);
        core.setOutput('current-version', milib_1.version.toString(curVersion));
        core.setOutput('current-tag', curTag);
        core.setOutput('current-sha', curSha);
        core.setOutput('previous-version', milib_1.version.toString(prevVersion));
        core.setOutput('previous-tag', prevTag);
        core.setOutput('previous-sha', prevSha);
        core.setOutput('latest-version', milib_1.version.toString(latestVersion));
        core.setOutput('latest-tag', latestTag);
        core.setOutput('latest-sha', latestSha);
        core.setOutput('is-release', curTag !== '');
        core.setOutput('is-branch-head', isRemoteLatestCommit);
        core.setOutput('is-latest-version', milib_1.version.compare(latestVersion, curVersion) === 0);
        core.setOutput('is-latest-major', utils.isLatestMajor(knownVersions, curVersion));
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
