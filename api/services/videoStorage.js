// Download a remote (IG) signed URL and re-upload to our own S3 so the
// stored URL doesn't expire. IG signs video + thumbnail URLs with an
// `oe=` token that lasts ~24h; once expired the CDN returns 403 and the
// storefront feed shows a black box. Uploading the bytes to our bucket
// at import time means the URL we save in `videos.s3_url` is permanent.
//
// Strategy:
//   1. fetch the source URL (with a 25s timeout — Vercel's serverless
//      ceiling is 60s and we're inside an import loop, so keep headroom)
//   2. PutObject to s3://${AWS_S3_BUCKET}/${s3Key}
//   3. return { s3Key, s3Url } that the caller writes to the videos row
//
// On any failure, the caller should fall back to keeping the original
// URL — the customer briefly sees the IG video play, then gets the
// black-box bug for that ONE video, instead of the import failing
// entirely.

const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { v4: uuidv4 } = require('uuid');

const s3 = new S3Client({
  region: process.env.AWS_REGION || 'us-east-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});
const BUCKET = process.env.AWS_S3_BUCKET;

const FETCH_TIMEOUT_MS = 25_000;
const MAX_BYTES = 80 * 1024 * 1024;   // 80 MB cap — IG reels are ~5–20 MB; anything bigger is suspect

function inferExtFromUrlOrType(url, contentType) {
  if (contentType) {
    if (/mp4/i.test(contentType)) return 'mp4';
    if (/quicktime|mov/i.test(contentType)) return 'mov';
    if (/webm/i.test(contentType)) return 'webm';
    if (/jpeg|jpg/i.test(contentType)) return 'jpg';
    if (/png/i.test(contentType)) return 'png';
    if (/webp/i.test(contentType)) return 'webp';
  }
  try {
    const path = new URL(url).pathname.toLowerCase();
    const m = path.match(/\.([a-z0-9]{2,4})(?:$|[?#])/);
    if (m) return m[1];
  } catch {}
  return null;
}

async function fetchWithTimeout(url, ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { signal: controller.signal, redirect: 'follow' });
  } finally {
    clearTimeout(timer);
  }
}

// Streams remote URL → S3. Returns { s3Key, s3Url, bytes, contentType }.
// Throws on any non-recoverable error so the caller can decide whether
// to skip the video or fall back to the original URL.
async function uploadRemoteToS3({ sourceUrl, merchantId, kind }) {
  if (!BUCKET) throw new Error('AWS_S3_BUCKET not configured');
  if (!sourceUrl) throw new Error('sourceUrl required');

  const res = await fetchWithTimeout(sourceUrl, FETCH_TIMEOUT_MS);
  if (!res.ok) throw new Error(`source fetch ${res.status}`);

  const contentType = res.headers.get('content-type') || (kind === 'image' ? 'image/jpeg' : 'video/mp4');
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.byteLength > MAX_BYTES) throw new Error(`source too large (${buf.byteLength} bytes)`);

  const ext = inferExtFromUrlOrType(sourceUrl, contentType) || (kind === 'image' ? 'jpg' : 'mp4');
  const folder = kind === 'image' ? 'thumbnails' : 'videos';
  const s3Key = `${folder}/${merchantId}/${uuidv4()}.${ext}`;

  await s3.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: s3Key,
    Body: buf,
    ContentType: contentType,
    CacheControl: 'public, max-age=31536000, immutable',
  }));

  return {
    s3Key,
    s3Url: `https://${BUCKET}.s3.amazonaws.com/${s3Key}`,
    bytes: buf.byteLength,
    contentType,
  };
}

// Convenience: upload both video and thumbnail in parallel, return all
// resolved URLs. Either side can fail independently — caller falls
// back to the original URL on failure for that side.
async function importIgMedia({ videoUrl, thumbnailUrl, merchantId }) {
  const result = {
    s3_key: null,
    s3_url: null,
    thumbnail_s3_url: null,
    video_failed: null,
    thumbnail_failed: null,
  };

  const tasks = [];

  if (videoUrl) {
    tasks.push(
      uploadRemoteToS3({ sourceUrl: videoUrl, merchantId, kind: 'video' })
        .then(({ s3Key, s3Url }) => { result.s3_key = s3Key; result.s3_url = s3Url; })
        .catch(err => { result.video_failed = err.message; })
    );
  }

  if (thumbnailUrl) {
    tasks.push(
      uploadRemoteToS3({ sourceUrl: thumbnailUrl, merchantId, kind: 'image' })
        .then(({ s3Url }) => { result.thumbnail_s3_url = s3Url; })
        .catch(err => { result.thumbnail_failed = err.message; })
    );
  }

  await Promise.all(tasks);
  return result;
}

module.exports = { uploadRemoteToS3, importIgMedia };
