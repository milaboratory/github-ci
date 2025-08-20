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
exports.run = run;
const core = __importStar(require("@actions/core"));
const nunjucks = __importStar(require("nunjucks"));
// Export for testing
function run() {
    try {
        const dataInput = core.getInput('data', { required: true });
        const template = core.getInput('template', { required: true });
        const githubContext = core.getInput('githubContext');
        const data = JSON.parse(dataInput);
        if (githubContext) {
            data.github = JSON.parse(githubContext);
        }
        const env = new nunjucks.Environment(null, {
            autoescape: false,
            throwOnUndefined: true,
            trimBlocks: true,
            lstripBlocks: true,
        });
        // Add a custom filter to convert objects to JSON strings
        env.addFilter('json', function (value) {
            return JSON.stringify(value, null, 2);
        });
        const result = env.renderString(template, data);
        core.setOutput('result', result);
    }
    catch (error) {
        if (error instanceof Error) {
            core.setFailed(error.message);
        }
        else {
            core.setFailed('An unknown error occurred.');
        }
    }
}
// Run the action if not in a test environment
if (process.env.JEST_WORKER_ID === undefined) {
    run();
}
