// IMPORTANT: Keep this in sync with the frontend version!
// Last updated: 2025-12-9
export const VALID_MODELS = ['gpt-4o', 'gpt-5-mini-2025-08-07'] as const

export type AiModel = (typeof VALID_MODELS)[number]

export const DEFAULT_MODEL: AiModel = 'gpt-4o'
