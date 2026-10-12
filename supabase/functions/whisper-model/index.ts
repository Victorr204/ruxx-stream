import { createClient } from "npm:@supabase/supabase-js@2";
import { json, preflight } from "../_shared/cors.ts";
import { presignGetObject, storageConfigFromEnv } from "../_shared/storage.ts";

// Redirects a model-file request to a short-lived presigned GET on the
// private storage bucket, so the Whisper weights the in-app subtitle
// generator needs are served from our own storage without the bucket
// ever going public and without any storage credential reaching a client.
//
// Deployed with --no-verify-jwt (transformers.js fetches plain files with
// no Authorization header) — the path allowlist below is the security
// boundary: only files inside the pinned model directory can be signed,
// and the signature can't be forged for anything else. A per-IP rate limit
// keeps that anonymous surface from being hammered.

// Storage root for everything the scanner fetches: model weights live at
// models/onnx-community/whisper-tiny/… and the ONNX runtime at
// models/whisper-wasm/… (see scripts/upload-whisper-model.mjs).
const MODEL_DIR = Deno.env.get("WHISPER_MODEL_DIR") ?? "models";
const EXPIRES_SECONDS = 3600;

// Letters, digits, dash, underscore, plus single dots *inside* a segment
// (file.ext, model.onnx_data) — deliberately rejecting "..", a leading dot,
// or a trailing dot, so no path can walk out of MODEL_DIR. No leading slash.
const SAFE_FILE = /^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*(?:\/[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*)*$/;

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;

  try {
    if (req.method !== "GET") return json({ error: "Method not allowed" }, 405);

    const url = new URL(req.url);
    const file = url.searchParams.get("path") ?? "";
    if (!SAFE_FILE.test(file)) return json({ error: "Bad path" }, 400);

    // One whisper run pulls dozens of files; cap it per IP so the anonymous
    // signer can't be used as a general-purpose presign oracle.
    const clientIp =
      (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() ||
      req.headers.get("cf-connecting-ip") ||
      "unknown";
    const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: allowed } = await db.rpc("hit_rate_limit", {
      p_key: `whisper_model:${clientIp}`,
      p_max: 240,
      p_window_seconds: 3600,
    });
    if (allowed === false) return json({ error: "Rate limit exceeded" }, 429);

    const key = `${MODEL_DIR}/${file}`;
    const location = await presignGetObject(storageConfigFromEnv(), key, EXPIRES_SECONDS);

    return new Response(null, {
      status: 302,
      headers: {
        "Access-Control-Allow-Origin": "*",
        Location: location,
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (e) {
    console.error("[whisper-model]", e);
    return json({ error: e instanceof Error ? e.message : "Unexpected error" }, 500);
  }
});
