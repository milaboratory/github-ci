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
const exec = __importStar(require("@actions/exec"));
const github = __importStar(require("@actions/github"));
const utils_1 = require("./utils");
function git(...args) {
    return __awaiter(this, void 0, void 0, function* () {
        const execResult = yield exec.getExecOutput('git', args);
        if (execResult.exitCode !== 0) {
            const cmd = `git '${args.join("' '")}'`;
            const exitCode = execResult.exitCode.toString();
            const stderr = execResult.stderr;
            throw Error(`Command "${cmd}" failed with code '${exitCode}': ${stderr}`);
        }
        return execResult;
    });
}
function fetchHistory(depth) {
    return __awaiter(this, void 0, void 0, function* () {
        // Fetch all tags without their history.
        // We don't need almost the full repo to be fetched.
        yield git('fetch', '--depth=1', 'origin', 'refs/tags/*:refs/tags/*');
        // Check the size of already fetched history from current commit.
        // We need to fetch more only if the current history is shorter than we want.
        const revListResult = yield git('rev-list', `--max-count=${depth}`, 'HEAD');
        const revList = revListResult.stdout.trim();
        const fetchedLength = (0, utils_1.countOccurrences)(revList, '\n') + 1;
        if (fetchedLength < depth) {
            yield git('fetch', `--depth=${depth}`, 'origin', github.context.sha);
        }
    });
}
function getVersion(exactMatch) {
    return __awaiter(this, void 0, void 0, function* () {
        const cmd = ['describe', '--tags'];
        if (exactMatch) {
            cmd.push('--exact-match');
        }
        const describeResult = yield git(...cmd);
        let versionString = describeResult.stdout;
        versionString = versionString.replace('-', '.'); // v1.0-2-g<hash> -> v1.0.2-g<hash>
        versionString = versionString.split('-', 2)[0]; // v1.0.2-g<hash> -> v1.0.2
        if (versionString.startsWith('v')) {
            versionString = versionString.substring(1); // v1.0.2 -> 1.0.2
        }
        return versionString.trim();
    });
}
function generateVersionFromGit(depth, exactMatch) {
    return __awaiter(this, void 0, void 0, function* () {
        if (exactMatch) {
            // We don't need history at all to find exact match. Single commit is enough.
            depth = 1;
        }
        yield fetchHistory(depth);
        return getVersion(exactMatch);
    });
}
exports.default = generateVersionFromGit;
