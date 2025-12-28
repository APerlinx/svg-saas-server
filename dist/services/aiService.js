"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateSvg = generateSvg;
const openai_1 = require("../lib/openai");
const env_1 = require("../config/env");
const ALLOWED_TAGS = new Set([
    'svg',
    'g',
    'path',
    'rect',
    'circle',
    'line',
    'polygon',
]);
function extractSingleSvg(content) {
    const trimmed = content.trim();
    const svgStart = trimmed.indexOf('<svg');
    const svgEnd = trimmed.lastIndexOf('</svg>');
    if (svgStart === -1 || svgEnd === -1) {
        throw new Error('Generated content is not a valid SVG element');
    }
    return trimmed.slice(svgStart, svgEnd + 6);
}
function validateSvg(svg) {
    const errors = [];
    if (!svg.includes('viewBox="0 0 256 256"')) {
        errors.push('Missing required viewBox="0 0 256 256"');
    }
    // Disallow obviously unsafe/unwanted tags (defense in depth)
    const forbidden = [
        'script',
        'style',
        'foreignObject',
        'image',
        'text',
        'iframe',
        'object',
        'embed',
    ];
    for (const tag of forbidden) {
        const re = new RegExp(`<\\s*${tag}\\b`, 'i');
        if (re.test(svg))
            errors.push(`Forbidden tag <${tag}> found`);
    }
    // Ensure only allowed tags appear
    // Captures tag names from "<tag" and "</tag"
    const tagRegex = /<\s*\/?\s*([a-zA-Z0-9:_-]+)\b/g;
    const seen = new Set();
    let match;
    while ((match = tagRegex.exec(svg))) {
        const rawName = match[1];
        const name = rawName.toLowerCase();
        // ignore xml declarations / doctype if any slip in
        if (name === '?xml' || name === '!doctype')
            continue;
        // treat namespaced tags as not allowed (shouldn’t happen)
        if (name.includes(':')) {
            errors.push(`Namespaced tag <${rawName}> is not allowed`);
            continue;
        }
        seen.add(name);
        if (!ALLOWED_TAGS.has(name)) {
            errors.push(`Tag <${rawName}> is not allowed`);
        }
    }
    // Must contain at least <svg>
    if (!seen.has('svg'))
        errors.push('Missing <svg> root element');
    return errors;
}
async function generateSvg(prompt, style, model) {
    if (env_1.IS_TEST) {
        return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256">
  <rect x="32" y="32" width="192" height="192" rx="16" fill="none" stroke="#111111" stroke-width="8"/>
  <circle cx="128" cy="128" r="32" fill="#111111"/>
  </svg>`;
    }
    const resolvedModel = model || 'gpt-4o';
    const baseMessages = [
        {
            role: 'system',
            content: `You are a deterministic SVG icon generator for a professional design tool.

You MUST respond with ONLY A SINGLE <svg>...</svg> ELEMENT.
- No explanations.
- No markdown.
- No backticks.
- No surrounding text.

STRICT REQUIREMENTS:
1. Always include: viewBox="0 0 256 256".
2. Use only these elements:
   <svg>, <g>, <path>, <rect>, <circle>, <line>, <polygon>.
   Do NOT use <text>, <foreignObject>, <image>, <style>, <script>, or any other tag.
3. The SVG must be valid XML. Close all tags and use double quotes for attributes.
4. Keep the design clean and minimal, suitable as an icon or simple illustration.
5. Use simple, consistent coordinates (0–256 range) so shapes are well-balanced.
6. Avoid randomness between calls: similar prompts should produce similar structure.
7. Never include comments or CDATA.
8. Do NOT inline CSS or use <style>. Use basic attributes like fill, stroke, stroke-width, etc.`,
        },
        // --- FEW-SHOT EXAMPLE 1 ---
        {
            role: 'user',
            content: `Generate a minimal SVG for: "code window with angle brackets" in "outline" style.`,
        },
        {
            role: 'assistant',
            content: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256">
  <g fill="none" stroke="#111111" stroke-width="10" stroke-linecap="round" stroke-linejoin="round">
    <rect x="32" y="40" width="192" height="176" rx="16" ry="16" />
    <line x1="32" y1="80" x2="224" y2="80" />
    <circle cx="64" cy="60" r="6" />
    <circle cx="88" cy="60" r="6" />
    <circle cx="112" cy="60" r="6" />
    <path d="M108 128 L88 144 L108 160" />
    <path d="M148 128 L168 144 L148 160" />
    <line x1="124" y1="120" x2="132" y2="168" />
  </g>
</svg>`,
        },
        // --- FEW-SHOT EXAMPLE 2 ---
        {
            role: 'user',
            content: `Generate a minimal SVG for: "lightbulb idea icon" in "flat filled" style.`,
        },
        {
            role: 'assistant',
            content: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256">
  <g fill="#111111">
    <path d="M128 32c-40 0-72 29.4-72 68 0 21.6 9.2 38.5 25 52.6 7.2 6.4 11 14.9 11 24v4h72v-4c0-9.1 3.8-17.6 11-24 15.8-14.1 25-31 25-52.6 0-38.6-32-68-72-68z"/>
    <rect x="100" y="188" width="56" height="20" rx="6" ry="6" />
    <rect x="96" y="212" width="64" height="16" rx="6" ry="6" />
  </g>
  <g fill="none" stroke="#111111" stroke-width="8" stroke-linecap="round">
    <line x1="64" y1="80" x2="40" y2="64" />
    <line x1="192" y1="80" x2="216" y2="64" />
    <line x1="128" y1="32" x2="128" y2="16" />
  </g>
</svg>`,
        },
        // --- FEW-SHOT EXAMPLE 3 ---
        {
            role: 'user',
            content: `Generate a minimal SVG for: "isometric cube logo" in "geometric" style.`,
        },
        {
            role: 'assistant',
            content: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256">
  <g fill="none" stroke="#111111" stroke-width="10" stroke-linejoin="round">
    <polygon points="128 32 56 72 56 152 128 192 200 152 200 72" />
    <polygon points="128 32 56 72 128 112 200 72" />
    <polygon points="56 72 56 152 128 192 128 112" />
    <polygon points="200 72 200 152 128 192 128 112" />
  </g>
</svg>`,
        },
        // --- REAL USER REQUEST ---
        {
            role: 'user',
            content: `Generate a professional, well-balanced SVG icon for:

Prompt: "${prompt}"
Style: "${style}"

Focus on clear shapes, good visual hierarchy, and clean geometry.
Use a neutral color palette (black/white/gray) unless explicit colors are requested.`,
        },
    ];
    const callModel = async (messages) => {
        var _a;
        const response = await openai_1.openai.chat.completions.create({
            model: resolvedModel,
            messages,
        });
        const content = (_a = response.choices[0].message) === null || _a === void 0 ? void 0 : _a.content;
        if (!content)
            throw new Error('No SVG code generated');
        return extractSingleSvg(content);
    };
    // Attempt 1
    let svg = await callModel(baseMessages);
    let errors = validateSvg(svg);
    if (errors.length === 0)
        return svg;
    // Attempt 2: repair once
    const repairMessage = {
        role: 'user',
        content: `Your previous SVG did not pass validation:

${errors.map((e) => `- ${e}`).join('\n')}

Return a corrected SINGLE <svg>...</svg> only, following the tag allowlist and required viewBox.

Previous SVG:
${svg}`,
    };
    svg = await callModel([...baseMessages, repairMessage]);
    errors = validateSvg(svg);
    if (errors.length > 0) {
        throw new Error(`Generated SVG failed validation: ${errors.join('; ')}`);
    }
    return svg;
}
