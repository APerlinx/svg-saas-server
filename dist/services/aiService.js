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
        // treat namespaced tags as not allowed (shouldn't happen)
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
// ─── Style-specific constraints injected into every user request ──────────────
const STYLE_CONSTRAINTS = {
    outline: [
        '- STROKE ONLY: set fill="none" on every shape. No filled shapes.',
        '- stroke-width between 10 and 14. stroke-linecap="round". stroke-linejoin="round".',
        '- Outlines must read clearly at small sizes — keep bold and uncluttered.',
    ].join('\n'),
    filled: [
        '- FILL ONLY: every shape is solid-filled. No visible stroke (omit stroke or set stroke="none").',
        '- Silhouette-style — overlapping shapes carve out the icon form.',
        '- No borders, no outlines around shapes.',
    ].join('\n'),
    minimal: [
        '- MAXIMUM 5 shapes total — fewer is always better.',
        '- Keep all geometry within 64–192 on both axes (large margins, high whitespace).',
        '- Single color only. No secondary tones, no gradients.',
        '- Strip the concept to its absolute essential form.',
    ].join('\n'),
    modern: [
        '- Geometric precision: straight lines, exact circles, clean angles.',
        '- Mix fill and stroke where it aids clarity. stroke-width 8–12 when used.',
        '- Max 2 tones — primary color plus one optional lighter/darker shade.',
        '- Bold and refined — no decorative flourishes, no rough edges.',
    ].join('\n'),
    flat: [
        '- FLAT SOLID FILLS: every shape uses fill with a solid color.',
        '- No gradients, no depth cues, no shadows, no 3D effects.',
        '- Strict max 2 colors — primary plus one optional secondary.',
        '- Clean silhouettes with at most slight rounding (rx up to 12).',
    ].join('\n'),
    gradient: [
        '- SIMULATE gradient depth using layered concentric shapes at different opacities.',
        '- NEVER use <defs>, <linearGradient>, or <radialGradient> — they are forbidden tags.',
        '- Stack 3–4 shapes: outermost opacity="1", progressively lighter/smaller toward center.',
        '- Use the requested color as the base; inner layers use lighter tints of that same color.',
    ].join('\n'),
    'line-art': [
        '- THIN STROKES ONLY: stroke-width 2–6. Set fill="none" on every element.',
        '- Use <path> with smooth d= curves for intricate, organic linework.',
        '- stroke-linecap="round". Up to 12 paths for detail.',
        '- Prefer flowing curves (C, S, Q beziers) over harsh straight lines.',
    ].join('\n'),
    '3d': [
        '- ISOMETRIC PERSPECTIVE: use <polygon> for each visible face of the object.',
        '- Three-face depth rule: top face is lightest, left face is darkest, right face is mid-tone.',
        '- Derive all three face colors as lighter/darker shades of the requested color.',
        '- Optional hairline edge: stroke-width="2" stroke-linejoin="round".',
        '- Depth comes purely from face color contrast — no text or extra decoration.',
    ].join('\n'),
    cartoon: [
        '- BOLD OUTLINES: stroke-width 14–18. stroke-linecap="round". stroke-linejoin="round".',
        '- Every shape has BOTH fill and stroke using the requested color.',
        '- Max 8 shapes — chunky, simple, exaggerated proportions.',
        '- Prefer round and friendly geometry (large rx/ry, circles over sharp polygons).',
    ].join('\n'),
};
// ─── One style-matched few-shot example per style ────────────────────────────
// Examples use deliberately abstract/neutral geometry — no real-world objects
// that could be confused with a user's actual prompt.
const STYLE_EXAMPLES = {
    outline: {
        user: 'STYLE REFERENCE: show me the "outline" style using simple abstract shapes.',
        assistant: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256">
  <g fill="none" stroke="#111111" stroke-width="12" stroke-linecap="round" stroke-linejoin="round">
    <rect x="32" y="32" width="192" height="192" rx="20" />
    <rect x="72" y="72" width="112" height="112" rx="12" />
    <rect x="108" y="108" width="40" height="40" rx="6" />
  </g>
</svg>`,
    },
    filled: {
        user: 'STYLE REFERENCE: show me the "filled" style using simple abstract shapes.',
        assistant: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256">
  <g fill="#111111">
    <circle cx="128" cy="96" r="64" />
    <rect x="80" y="148" width="96" height="72" rx="8" />
  </g>
</svg>`,
    },
    minimal: {
        user: 'STYLE REFERENCE: show me the "minimal" style using simple abstract shapes.',
        assistant: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256">
  <polygon fill="#111111" points="128 72 184 128 128 184 72 128" />
</svg>`,
    },
    modern: {
        user: 'STYLE REFERENCE: show me the "modern" style using simple abstract shapes.',
        assistant: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256">
  <rect x="44" y="44" width="128" height="128" rx="8" fill="#111111" />
  <rect x="84" y="84" width="128" height="128" rx="8" fill="none" stroke="#111111" stroke-width="10" />
</svg>`,
    },
    flat: {
        user: 'STYLE REFERENCE: show me the "flat" style using simple abstract shapes.',
        assistant: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256">
  <rect x="32" y="72" width="88" height="112" rx="10" fill="#111111" />
  <rect x="136" y="72" width="88" height="112" rx="10" fill="#666666" />
</svg>`,
    },
    gradient: {
        user: 'STYLE REFERENCE: show me the "gradient" style using simple abstract shapes.',
        assistant: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256">
  <circle cx="128" cy="128" r="104" fill="#111111" />
  <circle cx="128" cy="128" r="72" fill="#555555" opacity="0.6" />
  <circle cx="128" cy="128" r="44" fill="#999999" opacity="0.45" />
  <circle cx="128" cy="128" r="20" fill="#ffffff" opacity="0.35" />
</svg>`,
    },
    'line-art': {
        user: 'STYLE REFERENCE: show me the "line-art" style using simple abstract shapes.',
        assistant: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256">
  <g fill="none" stroke="#111111" stroke-width="4" stroke-linecap="round">
    <path d="M64 64 C64 128 192 128 192 192" />
    <path d="M192 64 C192 128 64 128 64 192" />
    <circle cx="64" cy="64" r="10" />
    <circle cx="192" cy="64" r="10" />
    <circle cx="64" cy="192" r="10" />
    <circle cx="192" cy="192" r="10" />
  </g>
</svg>`,
    },
    '3d': {
        user: 'STYLE REFERENCE: show me the "3d" style using simple abstract shapes.',
        assistant: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256">
  <polygon points="128 72 212 116 128 160 44 116" fill="#888888" stroke="#111111" stroke-width="2" stroke-linejoin="round" />
  <polygon points="44 116 44 184 128 228 128 160" fill="#333333" stroke="#111111" stroke-width="2" stroke-linejoin="round" />
  <polygon points="212 116 212 184 128 228 128 160" fill="#666666" stroke="#111111" stroke-width="2" stroke-linejoin="round" />
</svg>`,
    },
    cartoon: {
        user: 'STYLE REFERENCE: show me the "cartoon" style using simple abstract shapes.',
        assistant: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256">
  <circle cx="80" cy="168" r="52" fill="#111111" stroke="#111111" stroke-width="16" stroke-linejoin="round" />
  <circle cx="156" cy="108" r="36" fill="#111111" stroke="#111111" stroke-width="16" stroke-linejoin="round" />
  <circle cx="212" cy="64" r="22" fill="#111111" stroke="#111111" stroke-width="16" stroke-linejoin="round" />
</svg>`,
    },
};
// ─── System prompt ────────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `You are a precise SVG icon generator for a professional design tool. Your only output is a single valid <svg> element.

OUTPUT FORMAT:
- Respond with EXACTLY ONE <svg>...</svg> element — nothing before or after.
- No explanations, no markdown, no backticks, no surrounding text.
- No XML declarations, no comments, no CDATA sections.

ALLOWED ELEMENTS (strictly enforced):
  <svg>  <g>  <path>  <rect>  <circle>  <line>  <polygon>
  Any other tag (<text>, <defs>, <style>, <script>, <image>, <linearGradient>, etc.) is FORBIDDEN.

GEOMETRY RULES:
- Root <svg> MUST have: xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256"
- Safe drawing zone: all coordinates must be between 16 and 240 (inclusive).
- Visual center: the icon must feel balanced and centered around (128, 128).
- Maximum 12 shapes total. Prefer fewer — clarity beats complexity.

ATTRIBUTE RULES:
- Use ONLY these attributes: fill, stroke, stroke-width, stroke-linecap, stroke-linejoin,
  rx, ry, points, d, cx, cy, r, x, y, width, height, opacity, xmlns, viewBox.
- Valid XML only: close every tag, use double quotes on all attributes.
- Do NOT use <style> or inline CSS. Use SVG presentation attributes only.

COLOR:
- If the user's prompt specifies a color, use it. Honor explicit color requests above all else.
- If no color is specified, default to #111111.
- Use #ffffff only for intentional contrast on top of a dark shape (e.g. a white detail inside a filled icon).

CONSISTENCY:
- Produce stable output: similar prompts should yield structurally similar icons.`;
// ─── Message builder ──────────────────────────────────────────────────────────
function buildMessages(prompt, style) {
    var _a, _b;
    const example = (_a = STYLE_EXAMPLES[style]) !== null && _a !== void 0 ? _a : STYLE_EXAMPLES['outline'];
    const constraints = (_b = STYLE_CONSTRAINTS[style]) !== null && _b !== void 0 ? _b : STYLE_CONSTRAINTS['outline'];
    return [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: example.user },
        { role: 'assistant', content: example.assistant },
        {
            role: 'user',
            content: `[STYLE REFERENCE COMPLETE — the example above demonstrated formatting and technique only. Do NOT copy or approximate its shape, subject, or structure.]

Now generate a completely original SVG icon for: "${prompt}"

STYLE: ${style}
STYLE RULES:
${constraints}

Center the design at (128, 128). Keep all coordinates within 16–240. Max 12 shapes.`,
        },
    ];
}
// ─── Public API ───────────────────────────────────────────────────────────────
async function generateSvg(prompt, style, model) {
    if (env_1.IS_TEST) {
        return {
            svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256">
  <rect x="32" y="32" width="192" height="192" rx="16" fill="none" stroke="#111111" stroke-width="8"/>
  <circle cx="128" cy="128" r="32" fill="#111111"/>
  </svg>`,
            metrics: {
                model: 'test',
                promptTokens: 0,
                completionTokens: 0,
                totalTokens: 0,
                latencyMs: 0,
                attempts: 0,
            },
        };
    }
    const resolvedModel = model || 'gpt-5.2-2025-12-11';
    const messages = buildMessages(prompt, style);
    let totalPromptTokens = 0;
    let totalCompletionTokens = 0;
    let totalTokens = 0;
    let totalLatencyMs = 0;
    let attempts = 0;
    const callModel = async (msgs) => {
        var _a, _b, _c, _d;
        const startTime = Date.now();
        attempts++;
        const response = await openai_1.openai.chat.completions.create({
            model: resolvedModel,
            messages: msgs,
            temperature: 0.2,
        });
        const latencyMs = Date.now() - startTime;
        totalLatencyMs += latencyMs;
        // Accumulate token counts
        totalPromptTokens += ((_a = response.usage) === null || _a === void 0 ? void 0 : _a.prompt_tokens) || 0;
        totalCompletionTokens += ((_b = response.usage) === null || _b === void 0 ? void 0 : _b.completion_tokens) || 0;
        totalTokens += ((_c = response.usage) === null || _c === void 0 ? void 0 : _c.total_tokens) || 0;
        const content = (_d = response.choices[0].message) === null || _d === void 0 ? void 0 : _d.content;
        if (!content)
            throw new Error('No SVG code generated');
        return extractSingleSvg(content);
    };
    // Attempt 1
    let svg = await callModel(messages);
    let errors = validateSvg(svg);
    if (errors.length === 0) {
        return {
            svg,
            metrics: {
                model: resolvedModel,
                promptTokens: totalPromptTokens,
                completionTokens: totalCompletionTokens,
                totalTokens,
                latencyMs: totalLatencyMs,
                attempts,
            },
        };
    }
    // Attempt 2: targeted repair — preserve intent, fix only validation errors
    const repairMessage = {
        role: 'user',
        content: `Preserve semantic intent; only minimal edits to satisfy the validator.

Your previous SVG failed these validation checks:
${errors.map((e) => `- ${e}`).join('\n')}

Return a corrected SINGLE <svg>...</svg> only. Keep the same design and subject — fix ONLY the issues listed above. Do not redesign or simplify unnecessarily.

Previous SVG:
${svg}`,
    };
    svg = await callModel([...messages, repairMessage]);
    errors = validateSvg(svg);
    if (errors.length > 0) {
        throw new Error(`Generated SVG failed validation: ${errors.join('; ')}`);
    }
    return {
        svg,
        metrics: {
            model: resolvedModel,
            promptTokens: totalPromptTokens,
            completionTokens: totalCompletionTokens,
            totalTokens,
            latencyMs: totalLatencyMs,
            attempts,
        },
    };
}
