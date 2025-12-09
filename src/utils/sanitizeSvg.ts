import DOMPurify from 'dompurify'
import { JSDOM } from 'jsdom'
import { XMLValidator } from 'fast-xml-parser'

export function sanitizeSvg(svgString: string): string {
  //  STEP 1: Validate XML structure first (fail fast)
  const validationResult = XMLValidator.validate(svgString)
  if (validationResult !== true) {
    throw new Error(
      `Invalid SVG structure: ${validationResult.err?.msg || 'malformed XML'}`
    )
  }

  //  STEP 2: Validate required attributes
  if (!svgString.includes('viewBox')) {
    throw new Error('SVG missing required viewBox attribute')
  }

  // STEP 3: Then sanitize (remove dangerous content)
  const window = new JSDOM('').window
  const purify = DOMPurify(window)

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
  })

  //  STEP 4: Ensure something was returned
  if (!clean || clean.trim().length === 0) {
    throw new Error('SVG sanitization resulted in empty output')
  }

  return clean
}
