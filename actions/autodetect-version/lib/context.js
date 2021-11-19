"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Get version number from current Action Context
 */
function generateVersionFromCtx() {
    const refName = process.env.GITHUB_REF_NAME; // github.context does not support this data yet
    if (refName.startsWith('v')) {
        return refName.substring(1); // v1.0.1 -> 1.0.1
    }
    return refName;
}
exports.default = generateVersionFromCtx;
