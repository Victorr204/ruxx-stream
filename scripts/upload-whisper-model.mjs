#!/usr/bin/env node
// Uploads everything the in-app subtitle scanner needs into the private S3
// bucket (Backblaze B2 with S3 credentials):
//
//   models/onnx-community/whisper-tiny/…   Whisper weights (from Hugging Face)
//   models/whisper-wasm/…                  ONNX Runtime wasm (from node_modules)
//
// The app never sees these bytes directly — the whisper-model edge function
// answers with a presigned 302, so the bucket stays private.
//
// Usage:
//   node scripts/upload-whisper-model.mjs            # model + wasm
//   node scripts/upload-whisper-model.mjs --wasm     # runtime only
//   node scripts/upload-whisper-model.mjs --model    # weights only
//
// Credentials: S3_ENDPOINT, S3_REGION, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY,
// S3_BUCKET from the environment or a local .env file (same names the edge
// functions use).

import { Buffer } from "node:buffer";
import { createHash, createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

// ─────────────────────────────────────────────────────────── environment

async function readDotEnv() {
  for (const name of [".env.local", ".env"]) {
    const file = path.join(ROOT, name);
    if (!existsSync(file)) continue;
    const text = await readFile(file, "utf8");
    for (const line of text.split(/\r?\n/)) {
      const match = /^\s*([A-Za-z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (!match || line.trim().startsWith("#")) continue;
      if (process.env[match[1]] === undefined) {
        process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
      }
    }
  }
}

function requireEnv(name) {
  // eslint-disable-next-line expo/no-dynamic-env-var
  const value = process.env[name];
  if (!value) {
    console.error(`Missing ${name} — set it in the environment or .env`);
    process.exit(1);
  }
  return value;
}

// ─────────────────────────────────────────────────────────────── sigv4

const sha256 = (data) => createHash("sha256").update(data).digest("hex");
const hmac = (key, data) => createHmac("sha256", key).update(data).digest();

function encodeKey(key) {
  return key
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
}

async function putObject(config, key, body, contentType) {
  const endpoint = config.endpoint.replace(/\/$/, "");
  const base = endpoint.startsWith("http") ? endpoint : `https://${endpoint}`;
  const url = new URL(`${base}/${config.bucket}/${encodeKey(key)}`);
  const host = url.host;
  const payloadHash = sha256(body);
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);
  const signedHeaders = "host;x-amz-content-sha256;x-amz-date";
  const canonicalRequest = [
    "PUT",
    url.pathname,
    "",
    `host:${host}`,
    `x-amz-content-sha256:${payloadHash}`,
    `x-amz-date:${amzDate}`,
    "",
    signedHeaders,
    payloadHash,
  ].join("\n");
  const scope = `${dateStamp}/${config.region}/s3/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    scope,
    sha256(canonicalRequest),
  ].join("\n");
  const kDate = hmac(`AWS4${config.secretKey}`, dateStamp);
  const kRegion = hmac(kDate, config.region);
  const kService = hmac(kRegion, "s3");
  const kSigning = hmac(kService, "aws4_request");
  const signature = createHmac("sha256", kSigning).update(stringToSign).digest("hex");

  const response = await fetch(url, {
    method: "PUT",
    headers: {
      Host: host,
      "Content-Type": contentType,
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": amzDate,
      Authorization: `AWS4-HMAC-SHA256 Credential=${config.accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    },
    body,
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`PUT ${key} → HTTP ${response.status}: ${text.slice(0, 300)}`);
  }
  return response;
}

// ─────────────────────────────────────────────────────────────── files

const HF_REPO = "https://huggingface.co/onnx-community/whisper-tiny/resolve/main";
const MODEL_FILES = [
  { path: "config.json", type: "application/json" },
  { path: "generation_config.json", type: "application/json" },
  { path: "preprocessor_config.json", type: "application/json" },
  { path: "tokenizer.json", type: "application/json" },
  { path: "tokenizer_config.json", type: "application/json" },
  { path: "onnx/encoder_model_quantized.onnx", type: "application/octet-stream" },
  { path: "onnx/decoder_model_merged_quantized.onnx", type: "application/octet-stream" },
];
const MODEL_PREFIX = "models/onnx-community/whisper-tiny";
const WASM_PREFIX = "models/whisper-wasm";
const WASM_FILES = [
  "ort-wasm-simd-threaded.asyncify.mjs",
  "ort-wasm-simd-threaded.asyncify.wasm",
  "ort-wasm-simd-threaded.mjs",
  "ort-wasm-simd-threaded.wasm",
];

const megabytes = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

async function download(url) {
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok) throw new Error(`GET ${url} → HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

async function main() {
  await readDotEnv();
  const onlyWasm = process.argv.includes("--wasm");
  const onlyModel = process.argv.includes("--model");

  const config = {
    endpoint: requireEnv("S3_ENDPOINT"),
    region: requireEnv("S3_REGION"),
    accessKey: requireEnv("S3_ACCESS_KEY_ID"),
    secretKey: requireEnv("S3_SECRET_ACCESS_KEY"),
    bucket: requireEnv("S3_BUCKET"),
  };

  if (!onlyWasm) {
    for (const file of MODEL_FILES) {
      const key = `${MODEL_PREFIX}/${file.path}`;
      process.stdout.write(`model  ${file.path} … `);
      const body = await download(`${HF_REPO}/${file.path}`);
      await putObject(config, key, body, file.type);
      console.log(`ok (${megabytes(body.length)})`);
    }
  }

  if (!onlyModel) {
    const dist = path.join(ROOT, "node_modules", "onnxruntime-web", "dist");
    for (const name of WASM_FILES) {
      const file = path.join(dist, name);
      if (!existsSync(file)) {
        console.warn(`skip   ${name} (not present in node_modules)`);
        continue;
      }
      process.stdout.write(`wasm   ${name} … `);
      const body = await readFile(file);
      const type = name.endsWith(".wasm")
        ? "application/wasm"
        : name.endsWith(".json")
          ? "application/json"
          : "text/javascript";
      await putObject(config, `${WASM_PREFIX}/${name}`, body, type);
      console.log(`ok (${megabytes(body.length)})`);
    }
  }

  console.log(
    "\nDone. Deploy the model endpoint with:\n" +
      "  supabase functions deploy whisper-model --no-verify-jwt\n" +
      "And make sure the bucket CORS allows this site to GET with Range headers\n" +
      "(see README → Subtitle audio scanner)."
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
