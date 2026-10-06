// S3-compatible object storage (Backblaze B2) request signing for Supabase
// Edge Functions. Signing is unchanged from the original Cloudflare R2
// implementation — endpoint and region now come from the environment so any
// S3-compatible provider can be dropped in via function secrets.
//
// SigV4 construction mirrors the reference `aws4` implementation:
//   [method, uri, query, canonicalHeaders + "\n", signedHeaders, payloadHash].join("\n")

export interface StorageConfig {
  /** Host only, no scheme or path — e.g. s3.eu-central-003.backblazeb2.com */
  endpoint: string;
  /** Credential-scope region — e.g. eu-central-003 (R2 used "auto"). */
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
}

const encoder = new TextEncoder();
export const EMPTY_SHA256 =
  "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

/** Accepts `host`, `https://host` or `https://host/anything` → `host`. */
export function normalizeEndpoint(value: string): string {
  return value.trim().replace(/^https?:\/\//, "").split("/")[0] ?? "";
}

export function storageConfigFromEnv(): StorageConfig {
  const endpoint = Deno.env.get("S3_ENDPOINT");
  const region = Deno.env.get("S3_REGION");
  const accessKeyId = Deno.env.get("S3_ACCESS_KEY_ID");
  const secretAccessKey = Deno.env.get("S3_SECRET_ACCESS_KEY");
  const bucket = Deno.env.get("S3_BUCKET");
  if (!endpoint || !region || !accessKeyId || !secretAccessKey || !bucket) {
    throw new Error(
      "Storage is not configured — set S3_ENDPOINT, S3_REGION, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, S3_BUCKET as function secrets.",
    );
  }
  return {
    endpoint: normalizeEndpoint(endpoint),
    region,
    accessKeyId,
    secretAccessKey,
    bucket,
  };
}

/** encodeURIComponent plus the extra RFC 3986 unreserved-char escaping. */
export function encodeRfc3986(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase(),
  );
}

/** Encode an object path segment by segment, keeping "/" separators. */
export function encodePath(objectPath: string): string {
  return objectPath.split("/").map(encodeRfc3986).join("/");
}

export function toHex(bytes: Uint8Array): string {
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}

/** Compact ISO-8601 basic format: 20261005T121345Z */
export function amzDateNow(now = new Date()): string {
  return now.toISOString().replace(/[:-]|\.\d{3}/g, "");
}

export async function sha256Hex(data: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(data));
  return toHex(new Uint8Array(digest));
}

export async function hmacSha256(
  key: Uint8Array | string,
  data: string,
): Promise<Uint8Array> {
  const keyData = typeof key === "string" ? encoder.encode(key) : key;
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyData as BufferSource,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(data));
  return new Uint8Array(sig);
}

export interface CanonicalInput {
  method: string;
  uri: string;
  query: string;
  /** Header lines without a trailing newline, already sorted and lower-cased. */
  canonicalHeaders: string;
  signedHeaders: string;
  payloadHash: string;
}

export function buildCanonicalRequest(input: CanonicalInput): string {
  return [
    input.method,
    input.uri,
    input.query,
    input.canonicalHeaders + "\n",
    input.signedHeaders,
    input.payloadHash,
  ].join("\n");
}

export async function buildStringToSign(
  amzDate: string,
  scope: string,
  canonicalRequest: string,
): Promise<string> {
  const hash = await sha256Hex(canonicalRequest);
  return ["AWS4-HMAC-SHA256", amzDate, scope, hash].join("\n");
}

export async function deriveSigningKey(
  secretAccessKey: string,
  dateStamp: string,
  region: string,
  service: string,
): Promise<Uint8Array> {
  const kDate = await hmacSha256("AWS4" + secretAccessKey, dateStamp);
  const kRegion = await hmacSha256(kDate, region);
  const kService = await hmacSha256(kRegion, service);
  return await hmacSha256(kService, "aws4_request");
}

function presignQuery(
  cfg: StorageConfig,
  scope: string,
  amzDate: string,
  expiresInSeconds: number,
): string {
  return [
    "X-Amz-Algorithm=AWS4-HMAC-SHA256",
    "X-Amz-Credential=" + encodeRfc3986(`${cfg.accessKeyId}/${scope}`),
    "X-Amz-Date=" + amzDate,
    "X-Amz-Expires=" + String(expiresInSeconds),
    "X-Amz-SignedHeaders=host",
  ].join("&");
}

async function presign(
  cfg: StorageConfig,
  method: "GET" | "PUT",
  objectKey: string,
  expiresInSeconds: number,
  now = new Date(),
): Promise<string> {
  const host = cfg.endpoint;
  const amzDate = amzDateNow(now);
  const dateStamp = amzDate.slice(0, 8);
  const scope = `${dateStamp}/${cfg.region}/s3/aws4_request`;
  const uri = "/" + encodePath(`${cfg.bucket}/${objectKey}`);
  const query = presignQuery(cfg, scope, amzDate, expiresInSeconds);

  const canonical = buildCanonicalRequest({
    method,
    uri,
    query,
    canonicalHeaders: `host:${host}`,
    signedHeaders: "host",
    payloadHash: "UNSIGNED-PAYLOAD",
  });
  const stringToSign = await buildStringToSign(amzDate, scope, canonical);
  const key = await deriveSigningKey(cfg.secretAccessKey, dateStamp, cfg.region, "s3");
  const signature = toHex(await hmacSha256(key, stringToSign));

  return `https://${host}${uri}?${query}&X-Amz-Signature=${signature}`;
}

/** Short-lived read URL for a video object (default 6 hours). */
export function presignGetObject(
  cfg: StorageConfig,
  objectKey: string,
  expiresInSeconds = 21600,
  now = new Date(),
): Promise<string> {
  return presign(cfg, "GET", objectKey, expiresInSeconds, now);
}

/** Short-lived upload URL used by the admin panel (default 1 hour). */
export function presignPutObject(
  cfg: StorageConfig,
  objectKey: string,
  expiresInSeconds = 3600,
  now = new Date(),
): Promise<string> {
  return presign(cfg, "PUT", objectKey, expiresInSeconds, now);
}

/** Header-signed DELETE (presigned DELETE is not supported by S3). */
export async function deleteObject(
  cfg: StorageConfig,
  objectKey: string,
  now = new Date(),
): Promise<{ ok: boolean; status: number; body: string }> {
  const host = cfg.endpoint;
  const amzDate = amzDateNow(now);
  const dateStamp = amzDate.slice(0, 8);
  const scope = `${dateStamp}/${cfg.region}/s3/aws4_request`;
  const uri = "/" + encodePath(`${cfg.bucket}/${objectKey}`);
  const signedHeaders = "host;x-amz-content-sha256;x-amz-date";

  const canonical = buildCanonicalRequest({
    method: "DELETE",
    uri,
    query: "",
    canonicalHeaders: [
      `host:${host}`,
      `x-amz-content-sha256:${EMPTY_SHA256}`,
      `x-amz-date:${amzDate}`,
    ].join("\n"),
    signedHeaders,
    payloadHash: EMPTY_SHA256,
  });
  const stringToSign = await buildStringToSign(amzDate, scope, canonical);
  const key = await deriveSigningKey(cfg.secretAccessKey, dateStamp, cfg.region, "s3");
  const signature = toHex(await hmacSha256(key, stringToSign));

  const res = await fetch(`https://${host}${uri}`, {
    method: "DELETE",
    headers: {
      Authorization:
        `AWS4-HMAC-SHA256 Credential=${cfg.accessKeyId}/${scope}, ` +
        `SignedHeaders=${signedHeaders}, Signature=${signature}`,
      "x-amz-content-sha256": EMPTY_SHA256,
      "x-amz-date": amzDate,
    },
  });

  return {
    ok: res.ok,
    status: res.status,
    body: res.status === 204 ? "" : await res.text(),
  };
}
