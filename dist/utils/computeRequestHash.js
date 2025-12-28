"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.computeRequestHash = computeRequestHash;
const crypto_1 = __importDefault(require("crypto"));
/**
 * Compute a deterministic hash of request parameters for idempotency checking.
 * This prevents reusing an idempotency key with different request parameters.
 */
function computeRequestHash(params) {
    var _a, _b, _c;
    // Create canonical JSON (sorted keys, consistent formatting)
    const canonical = JSON.stringify({
        prompt: params.prompt,
        style: (_a = params.style) !== null && _a !== void 0 ? _a : null,
        model: (_b = params.model) !== null && _b !== void 0 ? _b : null,
        privacy: (_c = params.privacy) !== null && _c !== void 0 ? _c : false,
    }, Object.keys(params).sort());
    return crypto_1.default.createHash('sha256').update(canonical).digest('hex');
}
