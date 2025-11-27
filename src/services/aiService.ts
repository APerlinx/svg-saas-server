import { openai } from '../lib/openai'

export async function generateSvg(prompt: string, style: string) {
  try {
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
    const svgCode = response.choices[0].message.content as string | null
    if (!svgCode) {
      throw new Error('No SVG code generated')
    }
    return svgCode
  } catch (error) {
    console.error('Error generating SVG:', error)
    return null
  }
}
