// Match videos in an S3-compatible bucket (e.g. Hetzner Object Storage). The server only
// signs: the app uploads straight into the bucket with presigned part URLs, and viewers
// stream from it with a presigned link that expires. AWS Signature Version 4, no SDK.
import crypto from 'node:crypto';

const sha256 = (data) => crypto.createHash('sha256').update(data).digest('hex');
const hmac = (key, data) => crypto.createHmac('sha256', key).update(data).digest();
/** RFC 3986 encoding as S3 expects it ([slash] kept in object keys). */
const enc = (s, slash = false) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`).replace(/%2F/g, slash ? '/' : '%2F');

/**
 * Config from the environment: S3_ENDPOINT (https://hel1.your-objectstorage.com),
 * S3_BUCKET, S3_ACCESS_KEY, S3_SECRET_KEY, optional S3_REGION (default: the endpoint's
 * first label, e.g. hel1) and S3_PATH_STYLE=true for path-style addressing.
 */
export function s3Config(env = {}) {
  const endpoint = env.S3_ENDPOINT?.replace(/\/+$/, '');
  if (!endpoint || !env.S3_BUCKET || !env.S3_ACCESS_KEY || !env.S3_SECRET_KEY) return null;
  const url = new URL(endpoint.includes('://') ? endpoint : `https://${endpoint}`);
  return {
    protocol: url.protocol,
    host: url.host,
    bucket: env.S3_BUCKET,
    accessKey: env.S3_ACCESS_KEY,
    secretKey: env.S3_SECRET_KEY,
    region: env.S3_REGION || url.hostname.split('.')[0] || 'us-east-1',
    pathStyle: env.S3_PATH_STYLE === 'true',
  };
}

function target(cfg, key) {
  const host = cfg.pathStyle ? cfg.host : `${cfg.bucket}.${cfg.host}`;
  const path = `${cfg.pathStyle ? `/${enc(cfg.bucket)}` : ''}/${enc(key, true)}`;
  return { host, path };
}

const stamp = (now) => now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

function signingKey(cfg, day) {
  return hmac(hmac(hmac(hmac(`AWS4${cfg.secretKey}`, day), cfg.region), 's3'), 'aws4_request');
}

/**
 * A presigned URL for [method] on [key] (query: extra parameters such as uploadId and
 * partNumber), valid for [expires] seconds. Anyone holding it can do just that, until then.
 */
export function presign(cfg, method, key, { query = {}, expires = 3600, now = new Date() } = {}) {
  const { host, path } = target(cfg, key);
  const t = stamp(now), day = t.slice(0, 8);
  const scope = `${day}/${cfg.region}/s3/aws4_request`;
  const params = {
    ...Object.fromEntries(Object.entries(query).map(([k, v]) => [k, String(v)])),
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${cfg.accessKey}/${scope}`,
    'X-Amz-Date': t,
    'X-Amz-Expires': String(expires),
    'X-Amz-SignedHeaders': 'host',
  };
  const qs = Object.keys(params).sort().map((k) => `${enc(k)}=${enc(params[k])}`).join('&');
  const canonical = [method, path, qs, `host:${host}\n`, 'host', 'UNSIGNED-PAYLOAD'].join('\n');
  const toSign = ['AWS4-HMAC-SHA256', t, scope, sha256(canonical)].join('\n');
  const sig = crypto.createHmac('sha256', signingKey(cfg, day)).update(toSign).digest('hex');
  return `${cfg.protocol}//${host}${path}?${qs}&X-Amz-Signature=${sig}`;
}

/** A signed request from the server itself (create / complete / abort an upload, delete). */
export async function request(cfg, method, key, { query = {}, body = '', fetchFn = fetch, now = new Date() } = {}) {
  const { host, path } = target(cfg, key);
  const t = stamp(now), day = t.slice(0, 8);
  const scope = `${day}/${cfg.region}/s3/aws4_request`;
  const hash = sha256(body);
  const qs = Object.keys(query).sort().map((k) => `${enc(k)}=${enc(String(query[k]))}`).join('&');
  const headers = { host, 'x-amz-content-sha256': hash, 'x-amz-date': t };
  const signed = Object.keys(headers).sort();
  const canonical = [method, path, qs, signed.map((h) => `${h}:${headers[h]}\n`).join(''), signed.join(';'), hash].join('\n');
  const toSign = ['AWS4-HMAC-SHA256', t, scope, sha256(canonical)].join('\n');
  const sig = crypto.createHmac('sha256', signingKey(cfg, day)).update(toSign).digest('hex');
  const res = await fetchFn(`${cfg.protocol}//${host}${path}${qs ? `?${qs}` : ''}`, {
    method,
    headers: {
      'x-amz-content-sha256': hash, 'x-amz-date': t,
      Authorization: `AWS4-HMAC-SHA256 Credential=${cfg.accessKey}/${scope}, SignedHeaders=${signed.join(';')}, Signature=${sig}`,
      ...(body && method === 'POST' ? { 'content-type': 'application/xml' } : {}),
    },
    body: body || undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`storage ${res.status}: ${(text.match(/<Code>([^<]+)<\/Code>/)?.[1]) ?? text.slice(0, 120)}`);
  return text;
}

/** Start a multipart upload; returns its id. */
export async function createUpload(cfg, key, opts = {}) {
  const xml = await request(cfg, 'POST', key, { ...opts, query: { uploads: '' } });
  const id = xml.match(/<UploadId>([^<]+)<\/UploadId>/)?.[1];
  if (!id) throw new Error('storage did not start the upload');
  return id;
}

/** Finish a multipart upload from its parts ({ n, etag }), in order. */
export async function completeUpload(cfg, key, uploadId, parts, opts = {}) {
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const body = `<CompleteMultipartUpload>${[...parts].sort((a, b) => a.n - b.n)
    .map((p) => `<Part><PartNumber>${p.n}</PartNumber><ETag>${esc(p.etag)}</ETag></Part>`).join('')}</CompleteMultipartUpload>`;
  await request(cfg, 'POST', key, { ...opts, query: { uploadId }, body });
}

export const abortUpload = (cfg, key, uploadId, opts = {}) => request(cfg, 'DELETE', key, { ...opts, query: { uploadId } });
export const deleteObject = (cfg, key, opts = {}) => request(cfg, 'DELETE', key, opts);
