import { openai } from '../lib/openai'

/**
 * Generates SVG content using OpenAI based on user prompt and style
 * @param prompt - User's description of the desired SVG
 * @param style - Visual style (minimalist, cartoon, etc.)
 * @param model - AI model to use for generation
 * @returns Clean SVG string
 * @throws Error if generation fails or content is invalid
 */
export async function generateSvg(
  prompt: string,
  style: string,
  model: string
): Promise<string> {
  // TODO: Use model parameter to select different AI models if needed
  // Call OpenAI API to generate SVG
  const response = await openai.chat.completions.create({
    model: 'gpt-5-mini',
    messages: [
      {
        role: 'system',
        content: `You are an SVG generator. The user will describe an icon or simple vector illustration.
          
You MUST respond with ONLY A SINGLE <svg>...</svg> ELEMENT, no explanations, no markdown, no backticks.

Requirements:
1. viewBox="0 0 256 256"
2. Use only <path>, <rect>, <circle>, <line>, <polygon>, <g>
3. Keep the SVG minimal and valid XML
4. No comments, no extra text`,
      },
      {
        role: 'user',
        content: `Generate a minimal SVG for: "${prompt}" in "${style}" style.`,
      },
    ],
  })

  // Extract SVG from response
  const content = response.choices[0].message?.content
  if (!content) {
    throw new Error('No SVG code generated')
  }

  const trimmed = content.trim()

  // Validate and extract SVG //TODO: Improve validation to protect against malformed SVGs
  const svgStart = trimmed.indexOf('<svg')
  const svgEnd = trimmed.lastIndexOf('</svg>')

  if (svgStart === -1 || svgEnd === -1) {
    throw new Error('Generated content is not a valid SVG element')
  }

  return trimmed.slice(svgStart, svgEnd + 6)
}
