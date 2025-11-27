import { openai } from '../lib/openai'

export async function generateSvg(
  prompt: string,
  style: string
): Promise<string> {
  try {
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

    // Validate SVG structure
    if (!trimmed.startsWith('<svg') || !trimmed.endsWith('</svg>')) {
      throw new Error('Generated content is not a valid SVG element')
    }

    // Extract clean SVG (already validated, so we know it exists)
    const svgStart = trimmed.indexOf('<svg')
    const svgEnd = trimmed.lastIndexOf('</svg>') + 6
    const svg = trimmed.slice(svgStart, svgEnd)

    return svg
  } catch (error) {
    console.error('Error generating SVG:', error)
    throw new Error('Failed to generate SVG')
  }
}
