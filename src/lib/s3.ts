// src/lib/s3.ts
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
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
    })
  )

  return `s3://${S3_BUCKET}/${key}`
}

export async function deleteSvg(key: string) {
  await s3.send(
    new DeleteObjectCommand({
      Bucket: S3_BUCKET,
      Key: key,
    })
  )
}

export async function getDownloadUrl(key: string) {
  return getSignedUrl(
    s3,
    new GetObjectCommand({
      Bucket: S3_BUCKET,
      Key: key,
    }),
    { expiresIn: S3_SIGNED_URL_TTL ?? 60 }
  )
}

export function buildGenerationSvgKey(userId: string, jobId: string) {
  return `users/${userId}/jobs/${jobId}/final.svg`
}
