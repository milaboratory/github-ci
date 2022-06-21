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
Object.defineProperty(exports, "__esModule", { value: true });
exports.StringReplacer = exports.Rule = void 0;
const core = __importStar(require("@actions/core"));
class Rule {
    constructor(src, target) {
        this.re = src;
        this.replace = target;
    }
    static parse(ruleStr) {
        const rule = ruleStr.split(' -> ', 2);
        if (rule.length < 2) {
            throw Error('wrong replace rule format');
        }
        const rePart = rule[0].replace('\\-\\>', '->');
        const match = new RegExp(rePart);
        const replacement = rule[1];
        return new Rule(match, replacement);
    }
    apply(str) {
        const match = str.match(this.re) != null;
        if (match) {
            str = str.replace(this.re, this.replace);
        }
        return [str, match];
    }
}
exports.Rule = Rule;
class StringReplacer {
    constructor(rulesStr) {
        this.rules = [];
        for (const ruleLine of rulesStr.split('\n')) {
            this.rules.push(Rule.parse(ruleLine));
        }
    }
    apply(line) {
        for (const rule of this.rules) {
            let match;
            [line, match] = rule.apply(line);
            if (match) {
                break;
            }
        }
        return line;
    }
}
exports.StringReplacer = StringReplacer;
function replace() {
    // Read inputs
    const inputStr = core.getInput('input');
    const rulesStr = core.getInput('rules');
    const rules = new StringReplacer(rulesStr);
    const result = [];
    for (const line of inputStr.split('\n')) {
        result.push(rules.apply(line));
    }
    core.setOutput('result', result.join('\n'));
}
function run() {
    try {
        replace();
    }
    catch (error) {
        if (error instanceof Error) {
            core.setFailed(error.message);
            return;
        }
        throw error;
    }
}
run();
