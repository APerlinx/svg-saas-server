"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.uploadSvg = uploadSvg;
exports.deleteSvg = deleteSvg;
exports.getDownloadUrl = getDownloadUrl;
exports.getSvgSourceFromS3 = getSvgSourceFromS3;
exports.buildGenerationSvgKey = buildGenerationSvgKey;
// src/lib/s3.ts
const client_s3_1 = require("@aws-sdk/client-s3");
const s3_request_presigner_1 = require("@aws-sdk/s3-request-presigner");
const node_stream_1 = require("node:stream");
const env_1 = require("../config/env");
// Credentials are resolved automatically by the AWS SDK
const s3 = new client_s3_1.S3Client({
    region: env_1.AWS_REGION,
});
async function uploadSvg({ key, svg, contentType = 'image/svg+xml; charset=utf-8', cacheControl, }) {
    await s3.send(new client_s3_1.PutObjectCommand({
        Bucket: env_1.S3_BUCKET,
        Key: key,
        Body: svg,
        ContentType: contentType,
        ...(cacheControl ? { CacheControl: cacheControl } : {}),
        ACL: undefined,
    }));
    return `s3://${env_1.S3_BUCKET}/${key}`;
}
async function deleteSvg(key) {
    await s3.send(new client_s3_1.DeleteObjectCommand({
        Bucket: env_1.S3_BUCKET,
        Key: key,
    }));
}
async function getDownloadUrl(key, expiresIn) {
    var _a;
    return (0, s3_request_presigner_1.getSignedUrl)(s3, new client_s3_1.GetObjectCommand({
        Bucket: env_1.S3_BUCKET,
        Key: key,
    }), { expiresIn: (_a = expiresIn !== null && expiresIn !== void 0 ? expiresIn : env_1.S3_SIGNED_URL_TTL) !== null && _a !== void 0 ? _a : 60 });
}
async function readableToString(stream) {
    const chunks = [];
    for await (const chunk of stream) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks).toString('utf-8');
}
async function getSvgSourceFromS3(key) {
    const resp = await s3.send(new client_s3_1.GetObjectCommand({
        Bucket: env_1.S3_BUCKET,
        Key: key,
    }));
    if (!resp.Body) {
        throw new Error('S3 GetObject returned empty body');
    }
    const bodyAny = resp.Body;
    if (typeof bodyAny.transformToString === 'function') {
        return await bodyAny.transformToString();
    }
    if (resp.Body instanceof node_stream_1.Readable) {
        return await readableToString(resp.Body);
    }
    // Node 18+: resp.Body may be a Web ReadableStream
    if (typeof node_stream_1.Readable.fromWeb === 'function') {
        return await readableToString(node_stream_1.Readable.fromWeb(resp.Body));
    }
    throw new Error('Unsupported S3 body type');
}
function buildGenerationSvgKey(userId, jobId) {
    return `users/${userId}/jobs/${jobId}/chatsvg.svg`;
}
