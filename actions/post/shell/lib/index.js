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
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const core = __importStar(require("@actions/core"));
const node_child_process_1 = require("node:child_process");
const STATE_KEY = 'post_run_command';
async function runMain() {
    const script = core.getInput('run', { required: true });
    core.saveState(STATE_KEY, script);
    core.info('Registered post-step script to be executed after the job.');
}
function execBash(script) {
    return new Promise((resolve, reject) => {
        const child = (0, node_child_process_1.spawn)('bash', ['-c', script], { stdio: 'inherit' });
        child.on('error', err => reject(err));
        child.on('close', code => {
            if (code === 0)
                resolve();
            else
                reject(new Error(`Post-step command exited with code ${code}`));
        });
    });
}
async function runPost() {
    const script = core.getState(STATE_KEY);
    if (!script) {
        core.info('No post-step script found. Nothing to do.');
        return;
    }
    core.startGroup('Running post-step script');
    try {
        await execBash(script);
    }
    finally {
        core.endGroup();
    }
}
async function run() {
    try {
        // If state is available, we are in the post execution
        if (core.getState(STATE_KEY)) {
            await runPost();
        }
        else {
            await runMain();
        }
    }
    catch (error) {
        if (error instanceof Error)
            core.setFailed(error.message);
        else
            core.setFailed('An unknown error occurred');
    }
}
run();
//# sourceMappingURL=index.js.map