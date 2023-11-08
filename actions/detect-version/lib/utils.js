"use strict";
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
exports.isLatestMajor = exports.isBranchHead = exports.latestVersionTag = exports.getVersions = void 0;
const milib_1 = require("milib");
/**
 * Get map of version numbers in git repository:
 *  <tag name> -> <parsed version info>
 */
function getVersions() {
    return __awaiter(this, void 0, void 0, function* () {
        const tagsResult = yield milib_1.git.tag({ list: true });
        const tags = tagsResult.split('\n');
        const result = {};
        for (const tag of tags) {
            let v = tag;
            if (tag.startsWith('v')) {
                v = tag.slice(1); // cut 'v' prefix
            }
            result[tag] = milib_1.version.parse(v);
        }
        return result;
    });
}
exports.getVersions = getVersions;
function latestVersionTag(v) {
    const versionsList = Object.entries(v);
    // Sort the list by values
    versionsList.sort((a, b) => milib_1.version.compare(a[1], b[1]));
    // Get the tag name of the latest version
    return versionsList[versionsList.length - 1][0];
}
exports.latestVersionTag = latestVersionTag;
/**
 * Check if action was started from branch AND current commit is
 * repository's branch head.
 */
function isBranchHead() {
    return __awaiter(this, void 0, void 0, function* () {
        const refType = process.env.GITHUB_REF_TYPE;
        const currentSha = process.env.GITHUB_SHA;
        const eventName = process.env.GITHUB_EVENT_NAME;
        let refName;
        if (refType !== 'branch') {
            return false;
        }
        if (eventName === 'pull_request') {
            // For pull requests get refName form the head ref or source branch
            refName = process.env.GITHUB_HEAD_REF;
        }
        else {
            refName = process.env.GITHUB_REF_NAME;
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
exports.isBranchHead = isBranchHead;
/**
 * Check if current version is the latest known modification of the major verison.
 * Returns 'true' when 1.3.12 is the latest known modification of v1 even if
 * 2.12.1, 3.0.0 and other higher versions exist in list.
 */
function isLatestMajor(knownVersions, current) {
    const allVersions = Object.values(knownVersions);
    allVersions.sort(milib_1.version.compare);
    for (let i = allVersions.length - 1; i >= 0; i--) {
        const v = allVersions[i];
        if (v.major === current.major) {
            return milib_1.version.compare(v, current) === 0;
        }
    }
    return false;
}
exports.isLatestMajor = isLatestMajor;
