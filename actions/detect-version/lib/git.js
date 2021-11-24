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
exports.describe = exports.ensureHistorySize = exports.fetchTags = exports.resolveRef = exports.revList = exports.fetch = exports.git = void 0;
const exec = __importStar(require("@actions/exec"));
function git(...args) {
    return __awaiter(this, void 0, void 0, function* () {
        const execResult = yield exec.getExecOutput('git', args, {
            ignoreReturnCode: true
        });
        if (execResult.exitCode !== 0) {
            const cmd = `git '${args.join("' '")}'`;
            const exitCode = execResult.exitCode.toString();
            const stderr = execResult.stderr;
            throw Error(`command "${cmd}" failed with code '${exitCode}':\n\n${stderr}`);
        }
        return execResult;
    });
}
exports.git = git;
function fetch(opts) {
    return __awaiter(this, void 0, void 0, function* () {
        const cmd = ['fetch'];
        if (opts && opts.depth != null)
            cmd.push(`--depth=${opts.depth}`);
        if (opts && opts.deepen != null)
            cmd.push(`--deepen=${opts.deepen}`);
        if (opts && opts.remote)
            cmd.push(opts.remote);
        if (opts && opts.refSpec)
            cmd.push(opts.refSpec);
        yield git(...cmd);
    });
}
exports.fetch = fetch;
function revList(opts) {
    return __awaiter(this, void 0, void 0, function* () {
        const cmd = ['rev-list'];
        if (opts && opts.maxCount != null)
            cmd.push(`--max-count=${opts.maxCount}`);
        if (opts && opts.ref)
            cmd.push(opts.ref);
        const revListResult = yield git(...cmd);
        const revListStr = revListResult.stdout.trim();
        if (revListStr === '') {
            return [];
        }
        return revListStr.split('\n');
    });
}
exports.revList = revList;
function resolveRef(ref = 'HEAD') {
    return __awaiter(this, void 0, void 0, function* () {
        const shaList = yield revList({ maxCount: 1, ref });
        return shaList[0];
    });
}
exports.resolveRef = resolveRef;
/**
 * Fetch all tags from remote repository without their history (only single commit)
 * and without breaking local history of already fetched refs
 */
function fetchTags(remote = 'origin') {
    return __awaiter(this, void 0, void 0, function* () {
        yield fetch({
            remote,
            refSpec: 'refs/tags/*:refs/tags/*',
            deepen: 1
        });
    });
}
exports.fetchTags = fetchTags;
/**
 * Ensure git repository has history of at least <minCommits> size from <ref>.
 * If not, fetch at most <minCommits> of <ref> from <remote>.
 */
function ensureHistorySize(minCommits, remote = 'origin', ref = 'HEAD') {
    return __awaiter(this, void 0, void 0, function* () {
        const commits = yield revList({
            maxCount: minCommits,
            ref
        });
        if (commits.length >= minCommits) {
            return;
        }
        yield fetch({
            deepen: minCommits,
            remote,
            refSpec: ref
        });
    });
}
exports.ensureHistorySize = ensureHistorySize;
function describe(opts) {
    return __awaiter(this, void 0, void 0, function* () {
        const cmd = ['describe'];
        if (opts && opts.tags)
            cmd.push('--tags');
        if (opts && opts.abbrev != null)
            cmd.push(`--abbrev=${opts.abbrev}`);
        if (opts && opts.exactMatch)
            cmd.push('--exact-match');
        if (opts && opts.ref)
            cmd.push(opts.ref);
        const describeResult = yield git(...cmd);
        const versionString = describeResult.stdout;
        return versionString.trim();
    });
}
exports.describe = describe;
