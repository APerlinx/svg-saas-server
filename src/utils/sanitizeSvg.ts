import DOMPurify from 'dompurify'
import { JSDOM } from 'jsdom'

export function sanitizeSvg(svgString: string): string {
  const window = new JSDOM('').window
  const purify = DOMPurify(window)

  // Configure DOMPurify for SVG
  const clean = purify.sanitize(svgString, {
    USE_PROFILES: { svg: true, svgFilters: true },
    ADD_TAGS: ['use'], // Allow SVG use tag
    FORBID_TAGS: ['script', 'iframe', 'object', 'embed'],
    FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover'],
  })

  return clean
}
