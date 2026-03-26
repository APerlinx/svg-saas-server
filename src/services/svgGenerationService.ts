/**
 * SVG Generation Service
 * Shared business logic for SVG generation used by both web app and API routes.
 */

import { Prisma, GenerationSource } from '@prisma/client'
import prisma from '../lib/prisma'
import { VALID_SVG_STYLES, SvgStyle } from '../constants/svgStyles'
import { VALID_MODELS, DEFAULT_MODEL, AiModel } from '../constants/models'
import { sanitizeInput } from '../utils/sanitizeInput'
import { computeRequestHash } from '../utils/computeRequestHash'
import { logger } from '../lib/logger'
import { enqueueSvgGenerationJob } from '../jobs/svgGenerationQueue'

export const generationJobSelect =
  Prisma.validator<Prisma.GenerationJobSelect>()({
    id: true,
    userId: true,
    prompt: true,
    style: true,
    model: true,
    privacy: true,
    status: true,
    createdAt: true,
    startedAt: true,
    finishedAt: true,
    errorCode: true,
    errorMessage: true,
    generationId: true,
    requestHash: true,
    generation: {
      select: {
        id: true,
        prompt: true,
        style: true,
        model: true,
        privacy: true,
        svg: true,
        createdAt: true,
      },
    },
  })

export type GenerationJobWithGeneration = Prisma.GenerationJobGetPayload<{
  select: typeof generationJobSelect
}>

export interface CreateGenerationJobParams {
  userId: string
  prompt: string
  style: SvgStyle
  model?: AiModel
  privacy?: boolean
  idempotencyKey: string
  requestId?: string
  source?: GenerationSource
  apiKeyId?: string
}

export interface CreateGenerationJobResult {
  job: GenerationJobWithGeneration
  duplicate: boolean
  status: 'created' | 'duplicate'
  creditsCharged: boolean
}

export class ValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ValidationError'
  }
}

export class ConflictError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConflictError'
  }
}

export class NotFoundError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'NotFoundError'
  }
}

export function validateAndSanitizePrompt(prompt: string): string {
  if (!prompt) {
    throw new ValidationError('Prompt is required')
  }

  if (prompt.length < 10 || prompt.length > 500) {
    throw new ValidationError(
      'Prompt length must be between 10 and 500 characters',
    )
  }

  const sanitizedPrompt = sanitizeInput(prompt)

  // Check for forbidden patterns (XSS, prompt injection, etc.)
  const forbiddenPatterns = [
    /\<script/i,
    /javascript:/i,
    /onerror=/i,
    /onload=/i,
    /<iframe/i,
    /eval\(/i,
    /system.*prompt/i,
    /ignore.*instruction/i,
    /you are now/i,
  ]

  for (const pattern of forbiddenPatterns) {
    if (pattern.test(sanitizedPrompt)) {
      throw new ValidationError(
        'Prompt contains forbidden content. Please rephrase your request.',
      )
    }
  }

  return sanitizedPrompt
}

export function validateStyle(style: string): SvgStyle {
  if (!style || !VALID_SVG_STYLES.includes(style as SvgStyle)) {
    throw new ValidationError(
      `Invalid style. Must be one of: ${VALID_SVG_STYLES.join(', ')}`,
    )
  }
  return style as SvgStyle
}

export function validateModel(model?: string): AiModel {
  if (model && !VALID_MODELS.includes(model as AiModel)) {
    throw new ValidationError(
      `Invalid model. Must be one of: ${VALID_MODELS.join(', ')}`,
    )
  }
  return (model as AiModel) || DEFAULT_MODEL
}

export function validateIdempotencyKey(
  idempotencyKey: string | undefined,
  userId: string,
  requestHash: string,
): string {
  // If no key provided, auto-generate one based on user + request hash
  if (!idempotencyKey) {
    return `auto-${userId}-${requestHash}`.substring(0, 128)
  }

  if (idempotencyKey.length > 128) {
    throw new ValidationError('Idempotency key must be 128 characters or fewer')
  }

  return idempotencyKey.trim()
}

/**
 * Create a new generation job with idempotency support.
 * Handles validation, sanitization, and job creation.
 * Credit charging and enqueuing must be done by the caller.
 */
export async function createGenerationJob(
  params: CreateGenerationJobParams,
): Promise<CreateGenerationJobResult> {
  const {
    userId,
    prompt,
    style,
    model,
    privacy,
    idempotencyKey,
    requestId,
    source,
    apiKeyId,
  } = params

  const sanitizedPrompt = validateAndSanitizePrompt(prompt)
  const validatedStyle = validateStyle(style)
  const selectedModel = validateModel(model)
  const isPrivate = privacy ?? false

  const requestHash = computeRequestHash({
    prompt: sanitizedPrompt,
    style: validatedStyle,
    model: selectedModel,
    privacy: isPrivate,
  })

  const validatedIdempotencyKey = validateIdempotencyKey(
    idempotencyKey,
    userId,
    requestHash,
  )

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true },
  })

  if (!user) {
    throw new NotFoundError('User not found')
  }

  const existingJob = await prisma.generationJob.findFirst({
    where: {
      userId,
      idempotencyKey: validatedIdempotencyKey,
    },
    select: generationJobSelect,
  })

  if (existingJob) {
    if (existingJob.requestHash === requestHash) {
      return {
        job: existingJob,
        duplicate: true,
        status: 'duplicate',
        creditsCharged: false,
      }
    }

    throw new ConflictError(
      'Idempotency key already used with different request parameters',
    )
  }

  let generationJob: GenerationJobWithGeneration

  try {
    generationJob = await prisma.generationJob.create({
      data: {
        userId,
        prompt: sanitizedPrompt,
        style: validatedStyle,
        model: selectedModel,
        privacy: isPrivate,
        idempotencyKey: validatedIdempotencyKey,
        requestHash,
        source: source || 'WEB_APP',
        apiKeyId,
      },
      select: generationJobSelect,
    })

    logger.info(
      {
        jobId: generationJob.id,
        userId,
        requestId,
        prompt: sanitizedPrompt.substring(0, 50),
        style: validatedStyle,
        model: selectedModel,
      },
      'Generation job created',
    )

    return {
      job: generationJob,
      duplicate: false,
      status: 'created',
      creditsCharged: true,
    }
  } catch (createError) {
    const isUniqueConstraintViolation =
      createError instanceof Prisma.PrismaClientKnownRequestError &&
      createError.code === 'P2002'

    if (isUniqueConstraintViolation) {
      const conflictingJob = await prisma.generationJob.findFirst({
        where: {
          userId,
          idempotencyKey: validatedIdempotencyKey,
        },
        select: generationJobSelect,
      })

      if (conflictingJob) {
        if (conflictingJob.requestHash === requestHash) {
          return {
            job: conflictingJob,
            duplicate: true,
            status: 'duplicate',
            creditsCharged: false,
          }
        }

        throw new ConflictError(
          'Idempotency key already used with different request parameters',
        )
      }
    }

    throw createError
  }
}

/**
 * Enqueue a generation job for processing.
 * Should be called after credits have been charged.
 */
export async function enqueueGenerationJob(
  jobId: string,
  userId: string,
): Promise<void> {
  await enqueueSvgGenerationJob(jobId, userId)

  logger.info({ jobId, userId }, 'Generation job enqueued')
}

export function getDuplicateStatus(job: GenerationJobWithGeneration): number {
  return job.status === 'SUCCEEDED' || job.status === 'FAILED' ? 200 : 202
}

export function formatGenerationJobResponse(job: GenerationJobWithGeneration) {
  return {
    id: job.id,
    status: job.status,
    prompt: job.prompt,
    style: job.style,
    model: job.model,
    privacy: job.privacy,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    errorCode: job.errorCode,
    errorMessage: job.errorMessage,
    generationId: job.generationId,
    generation: job.generation
      ? {
          id: job.generation.id,
          prompt: job.generation.prompt,
          style: job.generation.style,
          model: job.generation.model,
          privacy: job.generation.privacy,
          svg: job.generation.svg,
          createdAt: job.generation.createdAt,
        }
      : null,
  }
}
