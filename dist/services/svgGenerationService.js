"use strict";
/**
 * SVG Generation Service
 * Shared business logic for SVG generation used by both web app and API routes.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.NotFoundError = exports.ConflictError = exports.ValidationError = exports.generationJobSelect = void 0;
exports.validateAndSanitizePrompt = validateAndSanitizePrompt;
exports.validateStyle = validateStyle;
exports.validateModel = validateModel;
exports.validateIdempotencyKey = validateIdempotencyKey;
exports.createGenerationJob = createGenerationJob;
exports.enqueueGenerationJob = enqueueGenerationJob;
exports.getDuplicateStatus = getDuplicateStatus;
exports.formatGenerationJobResponse = formatGenerationJobResponse;
const client_1 = require("@prisma/client");
const prisma_1 = __importDefault(require("../lib/prisma"));
const svgStyles_1 = require("../constants/svgStyles");
const models_1 = require("../constants/models");
const sanitizeInput_1 = require("../utils/sanitizeInput");
const computeRequestHash_1 = require("../utils/computeRequestHash");
const logger_1 = require("../lib/logger");
const svgGenerationQueue_1 = require("../jobs/svgGenerationQueue");
exports.generationJobSelect = client_1.Prisma.validator()({
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
});
class ValidationError extends Error {
    constructor(message) {
        super(message);
        this.name = 'ValidationError';
    }
}
exports.ValidationError = ValidationError;
class ConflictError extends Error {
    constructor(message) {
        super(message);
        this.name = 'ConflictError';
    }
}
exports.ConflictError = ConflictError;
class NotFoundError extends Error {
    constructor(message) {
        super(message);
        this.name = 'NotFoundError';
    }
}
exports.NotFoundError = NotFoundError;
function validateAndSanitizePrompt(prompt) {
    if (!prompt) {
        throw new ValidationError('Prompt is required');
    }
    if (prompt.length < 10 || prompt.length > 500) {
        throw new ValidationError('Prompt length must be between 10 and 500 characters');
    }
    const sanitizedPrompt = (0, sanitizeInput_1.sanitizeInput)(prompt);
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
    ];
    for (const pattern of forbiddenPatterns) {
        if (pattern.test(sanitizedPrompt)) {
            throw new ValidationError('Prompt contains forbidden content. Please rephrase your request.');
        }
    }
    return sanitizedPrompt;
}
function validateStyle(style) {
    if (!style || !svgStyles_1.VALID_SVG_STYLES.includes(style)) {
        throw new ValidationError(`Invalid style. Must be one of: ${svgStyles_1.VALID_SVG_STYLES.join(', ')}`);
    }
    return style;
}
function validateModel(model) {
    if (model && !models_1.VALID_MODELS.includes(model)) {
        throw new ValidationError(`Invalid model. Must be one of: ${models_1.VALID_MODELS.join(', ')}`);
    }
    return model || models_1.DEFAULT_MODEL;
}
function validateIdempotencyKey(idempotencyKey, userId, requestHash) {
    // If no key provided, auto-generate one based on user + request hash
    if (!idempotencyKey) {
        return `auto-${userId}-${requestHash}`.substring(0, 128);
    }
    if (idempotencyKey.length > 128) {
        throw new ValidationError('Idempotency key must be 128 characters or fewer');
    }
    return idempotencyKey.trim();
}
/**
 * Create a new generation job with idempotency support.
 * Handles validation, sanitization, and job creation.
 * Credit charging and enqueuing must be done by the caller.
 */
async function createGenerationJob(params) {
    const { userId, prompt, style, model, privacy, idempotencyKey, requestId, source, apiKeyId, } = params;
    const sanitizedPrompt = validateAndSanitizePrompt(prompt);
    const validatedStyle = validateStyle(style);
    const selectedModel = validateModel(model);
    const isPrivate = privacy !== null && privacy !== void 0 ? privacy : false;
    const requestHash = (0, computeRequestHash_1.computeRequestHash)({
        prompt: sanitizedPrompt,
        style: validatedStyle,
        model: selectedModel,
        privacy: isPrivate,
    });
    const validatedIdempotencyKey = validateIdempotencyKey(idempotencyKey, userId, requestHash);
    const user = await prisma_1.default.user.findUnique({
        where: { id: userId },
        select: { id: true },
    });
    if (!user) {
        throw new NotFoundError('User not found');
    }
    const existingJob = await prisma_1.default.generationJob.findFirst({
        where: {
            userId,
            idempotencyKey: validatedIdempotencyKey,
        },
        select: exports.generationJobSelect,
    });
    if (existingJob) {
        if (existingJob.requestHash === requestHash) {
            return {
                job: existingJob,
                duplicate: true,
                status: 'duplicate',
                creditsCharged: false,
            };
        }
        throw new ConflictError('Idempotency key already used with different request parameters');
    }
    let generationJob;
    try {
        generationJob = await prisma_1.default.generationJob.create({
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
            select: exports.generationJobSelect,
        });
        logger_1.logger.info({
            jobId: generationJob.id,
            userId,
            requestId,
            prompt: sanitizedPrompt.substring(0, 50),
            style: validatedStyle,
            model: selectedModel,
        }, 'Generation job created');
        return {
            job: generationJob,
            duplicate: false,
            status: 'created',
            creditsCharged: true,
        };
    }
    catch (createError) {
        const isUniqueConstraintViolation = createError instanceof client_1.Prisma.PrismaClientKnownRequestError &&
            createError.code === 'P2002';
        if (isUniqueConstraintViolation) {
            const conflictingJob = await prisma_1.default.generationJob.findFirst({
                where: {
                    userId,
                    idempotencyKey: validatedIdempotencyKey,
                },
                select: exports.generationJobSelect,
            });
            if (conflictingJob) {
                if (conflictingJob.requestHash === requestHash) {
                    return {
                        job: conflictingJob,
                        duplicate: true,
                        status: 'duplicate',
                        creditsCharged: false,
                    };
                }
                throw new ConflictError('Idempotency key already used with different request parameters');
            }
        }
        throw createError;
    }
}
/**
 * Enqueue a generation job for processing.
 * Should be called after credits have been charged.
 */
async function enqueueGenerationJob(jobId, userId) {
    await (0, svgGenerationQueue_1.enqueueSvgGenerationJob)(jobId, userId);
    logger_1.logger.info({ jobId, userId }, 'Generation job enqueued');
}
function getDuplicateStatus(job) {
    return job.status === 'SUCCEEDED' || job.status === 'FAILED' ? 200 : 202;
}
function formatGenerationJobResponse(job) {
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
    };
}
