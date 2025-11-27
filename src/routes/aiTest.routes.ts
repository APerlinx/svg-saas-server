import { Router, Request, Response } from 'express'
import { generateSvg } from '../services/aiService'
const router = Router()

router.post('/ai-test', async (req: Request, res: Response) => {
  try {
    const { prompt, style } = req.body
    if (!prompt || !style) {
      return res.status(400).json({ error: 'Prompt and style are required' })
    }
    const response = await generateSvg(prompt, style)

    res.json({ svg: response })
  } catch (error) {
    console.error('AI Test error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

export default router
