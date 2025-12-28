"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.sanitizeSvg = sanitizeSvg;
const dompurify_1 = __importDefault(require("dompurify"));
const jsdom_1 = require("jsdom");
const fast_xml_parser_1 = require("fast-xml-parser");
function sanitizeSvg(svgString) {
    var _a;
    //  STEP 1: Validate XML structure first (fail fast)
    const validationResult = fast_xml_parser_1.XMLValidator.validate(svgString);
    if (validationResult !== true) {
        throw new Error(`Invalid SVG structure: ${((_a = validationResult.err) === null || _a === void 0 ? void 0 : _a.msg) || 'malformed XML'}`);
    }
    //  STEP 2: Validate required attributes
    if (!svgString.includes('viewBox')) {
        throw new Error('SVG missing required viewBox attribute');
    }
    // STEP 3: Then sanitize (remove dangerous content)
    const window = new jsdom_1.JSDOM('').window;
    const purify = (0, dompurify_1.default)(window);
    const clean = purify.sanitize(svgString, {
        USE_PROFILES: { svg: true, svgFilters: true },
        ADD_TAGS: ['use'],
        FORBID_TAGS: [
            'script',
            'iframe',
            'object',
            'embed',
            'style',
            'foreignObject',
        ],
        FORBID_ATTR: [
            'onerror',
            'onload',
            'onclick',
            'onmouseover',
            'onmouseenter',
            'onmouseleave',
        ],
    });
    //  STEP 4: Ensure something was returned
    if (!clean || clean.trim().length === 0) {
        throw new Error('SVG sanitization resulted in empty output');
    }
    return clean;
}
