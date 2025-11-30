// IMPORTANT: Keep this in sync with the frontend version!
// Last updated: 2025-11-30
export const VALID_MODELS = ['gpt-5-mini', 'gpt-4'] as const

export type AiModel = (typeof VALID_MODELS)[number]

export const DEFAULT_MODEL: AiModel = 'gpt-5-mini'
