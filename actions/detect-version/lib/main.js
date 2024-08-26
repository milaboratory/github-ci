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
        const sanitizedRefName = utils.sanitizeVersionInput(currentRefName);
        const count = yield milib_1.git.countCommits(baseRef, 'HEAD');
        return {
            major: baseVersion.major,
            minor: baseVersion.minor,
            patch: baseVersion.patch,
            suffix: `${count}-${sanitizedRefName}`,
            original: `${baseVersion.original}-${count}-${sanitizedRefName}`,
            semver: true
        };
    });
}
function loadBranchVersions(targetBranch) {
    return __awaiter(this, void 0, void 0, function* () {
        const refType = process.env.GITHUB_REF_TYPE;
        const refName = process.env.GITHUB_REF_NAME;
        const runNumber = process.env.GITHUB_RUN_NUMBER;
        const currentSha = yield milib_1.git.resolveRef('HEAD');
        const currentVersionStr = `${runNumber}-${currentSha.substring(0, 8)}`;
        const sanitizedRefName = utils.sanitizeVersionInput(currentVersionStr);
        const currentVersion = milib_1.version.parse(sanitizedRefName);
        const isRelease = refType === 'branch' && refName === targetBranch;
        const isBranchHead = yield utils.isBranchHead();
        setOutputs({
            current: {
                v: currentVersion,
                tag: '',
                sha: currentSha
            },
            previous: {
                v: milib_1.version.parse('unknown'),
                tag: '',
                sha: 'unknown'
            },
            latest: {
                v: milib_1.version.parse('unknown'),
                tag: '',
                sha: 'unknown'
            },
            isRelease,
            isBranchHead,
            isLatestVersion: isBranchHead && isRelease,
            isLatestMajor: isBranchHead && isRelease
        });
    });
}
function loadTagVersions(depth) {
    return __awaiter(this, void 0, void 0, function* () {
        yield prepareRepository(depth);
        const knownVersions = yield utils.getVersions();
        let latestTag = utils.latestVersionTag(knownVersions);
        const latestSha = yield milib_1.git.resolveRef(latestTag);
        let latestVersion = knownVersions[latestTag];
        if (latestVersion && latestVersion.original) {
            latestVersion.original = utils.sanitizeVersionInput(latestVersion.original);
            latestVersion = milib_1.version.parse(latestVersion.original);
        }
        if (latestTag.toLowerCase() === 'nightly') {
            const sortedTags = utils.sortTagsBySemver(Object.keys(knownVersions));
            const previousValidTag = sortedTags.find(tag => tag.toLowerCase() !== 'nightly');
            if (previousValidTag) {
                latestTag = previousValidTag;
                latestVersion = knownVersions[previousValidTag];
            }
        }
        let prevTag = yield milib_1.git.previousTag();
        const prevSha = yield milib_1.git.resolveRef(prevTag);
        let prevVersion = knownVersions[prevTag];
        if (prevTag.toLowerCase() === 'nightly') {
            // Adjust to use the latest valid semver version if previous tag is 'nightly'
            prevVersion = latestVersion;
            prevTag = latestTag;
        }
        const curSha = yield milib_1.git.resolveRef('HEAD');
        let curTag = '';
        let curVersion;
        try {
            curTag = yield milib_1.git.currentTag();
            curVersion = knownVersions[curTag];
            // Sanitize the current version and handle 'nightly'
            if (curVersion && curVersion.original) {
                curVersion.original = utils.sanitizeVersionInput(curVersion.original);
                curVersion = milib_1.version.parse(curVersion.original);
                if (curTag.toLowerCase() === 'nightly' && prevVersion) {
                    curVersion = yield genDevVersion(prevVersion, prevTag);
                }
            }
        }
        catch (error) {
            if (!(error instanceof Error)) {
                throw error;
            }
            core.notice(`Current commit seems to have no tag. Version number will be generated.\n${error.message}`);
            curVersion = yield genDevVersion(prevVersion, prevTag);
        }
        setOutputs({
            current: {
                v: curVersion,
                tag: curTag,
                sha: curSha
            },
            previous: {
                v: prevVersion,
                tag: prevTag,
                sha: prevSha
            },
            latest: {
                v: latestVersion,
                tag: latestTag,
                sha: latestSha
            },
            isRelease: curTag !== '',
            isBranchHead: yield utils.isBranchHead(),
            isLatestVersion: milib_1.version.compare(latestVersion, curVersion) === 0,
            isLatestMajor: utils.isLatestMajor(knownVersions, curVersion)
        });
    });
}
function setOutputs(p) {
    core.debug(`current version: '${p.current.v.original}'
current tag: '${p.current.tag}'

previous version: '${p.previous.v.original}'
previous tag: '${p.previous.tag}'

latest version: '${p.latest.v.original}'
latest tag: '${p.latest.tag}'
`);
    core.setOutput('current-version', milib_1.version.toString(p.current.v));
    core.setOutput('current-tag', p.current.tag);
    core.setOutput('current-sha', p.current.sha);
    core.setOutput('previous-version', milib_1.version.toString(p.previous.v));
    core.setOutput('previous-tag', p.previous.tag);
    core.setOutput('previous-sha', p.previous.sha);
    core.setOutput('latest-version', milib_1.version.toString(p.latest.v));
    core.setOutput('latest-tag', p.latest.tag);
    core.setOutput('latest-sha', p.latest.sha);
    core.setOutput('is-release', p.isRelease);
    core.setOutput('is-branch-head', p.isBranchHead);
    core.setOutput('is-latest-version', p.isLatestVersion);
    core.setOutput('is-latest-major', p.isLatestMajor);
}
function detectVersions() {
    return __awaiter(this, void 0, void 0, function* () {
        // Read inputs
        const fetchDepth = parseInt(core.getInput('fetch-depth'));
        const branchVersioning = core.getInput('branch-versioning');
        if (branchVersioning !== '') {
            yield loadBranchVersions(branchVersioning);
            return;
        }
        yield loadTagVersions(fetchDepth);
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
