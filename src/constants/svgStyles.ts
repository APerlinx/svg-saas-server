// IMPORTANT: Keep this in sync with the frontend version!
// Last updated: 2025-11-30
export const VALID_SVG_STYLES = [
  'outline',
  'filled',
  'minimal',
  'modern',
  'flat',
  'gradient',
  'line-art',
  '3d',
  'cartoon',
] as const

export type SvgStyle = (typeof VALID_SVG_STYLES)[number]
