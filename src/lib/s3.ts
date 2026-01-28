// src/lib/s3.ts
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { Readable } from 'node:stream'
import { AWS_REGION, S3_BUCKET, S3_SIGNED_URL_TTL } from '../config/env'

// Credentials are resolved automatically by the AWS SDK
const s3 = new S3Client({
  region: AWS_REGION,
})

export async function uploadSvg({
  key,
  svg,
  contentType = 'image/svg+xml; charset=utf-8',
  cacheControl,
}: {
  key: string
  svg: string
  contentType?: string
  cacheControl?: string
}) {
  await s3.send(
    new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: key,
      Body: svg,
      ContentType: contentType,
      ...(cacheControl ? { CacheControl: cacheControl } : {}),
      ACL: undefined,
    }),
  )

  return `s3://${S3_BUCKET}/${key}`
}

export async function deleteSvg(key: string) {
  await s3.send(
    new DeleteObjectCommand({
      Bucket: S3_BUCKET,
      Key: key,
    }),
  )
}

export async function getDownloadUrl(key: string) {
  return getSignedUrl(
    s3,
    new GetObjectCommand({
      Bucket: S3_BUCKET,
      Key: key,
    }),
    { expiresIn: S3_SIGNED_URL_TTL ?? 60 },
  )
}

async function readableToString(stream: Readable): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  return Buffer.concat(chunks).toString('utf-8')
}

export async function getSvgSourceFromS3(key: string): Promise<string> {
  const resp = await s3.send(
    new GetObjectCommand({
      Bucket: S3_BUCKET,
      Key: key,
    }),
  )

  if (!resp.Body) {
    throw new Error('S3 GetObject returned empty body')
  }

  const bodyAny = resp.Body as any
  if (typeof bodyAny.transformToString === 'function') {
    return await bodyAny.transformToString()
  }

  if (resp.Body instanceof Readable) {
    return await readableToString(resp.Body)
  }

  // Node 18+: resp.Body may be a Web ReadableStream
  if (typeof (Readable as any).fromWeb === 'function') {
    return await readableToString((Readable as any).fromWeb(resp.Body))
  }

  throw new Error('Unsupported S3 body type')
}

export function buildGenerationSvgKey(userId: string, jobId: string) {
  return `users/${userId}/jobs/${jobId}/chatsvg.svg`
}
