import { createClient } from "npm:@supabase/supabase-js@2";
import { json, preflight } from "../_shared/cors.ts";
import { presignPutObject, storageConfigFromEnv } from "../_shared/storage.ts";

// Admin-only: returns a presigned PUT URL so the browser can upload a
// movie file straight to storage (no storage credentials ever reach the client).

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

const UPLOAD_TTL_SECONDS = 3600;
const ALLOWED_TYPES = [
  "video/mp4",
  "video/quicktime",
  "video/x-matroska",
  "video/webm",
  "application/x-mpegURL",
  "application/vnd.apple.mpegurl",
];
const ALLOWED_EXT = ["mp4", "mov", "mkv", "webm", "m3u8"];

async function requireAdmin(authorization: string) {
  const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: userError } = await db.auth.getUser();
  if (userError || !userData?.user) return { error: "Invalid session" } as const;

  const { data: profile } = await db
    .from("profiles")
    .select("role")
    .eq("id", userData.user.id)
    .maybeSingle();

  if (profile?.role !== "admin") return { error: "Admin access required" } as const;
  return { db, userId: userData.user.id } as const;
}

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;

  try {
    if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

    const authorization = req.headers.get("Authorization");
    if (!authorization) return json({ error: "Missing Authorization header" }, 401);

    const admin = await requireAdmin(authorization);
    if ("error" in admin) {
      return json({ error: admin.error }, admin.error === "Admin access required" ? 403 : 401);
    }

    let filename = "";
    let contentType = "";
    try {
      const body = await req.json();
      filename = typeof body?.filename === "string" ? body.filename : "";
      contentType = typeof body?.content_type === "string" ? body.content_type : "";
    } catch {
      return json({ error: "Invalid JSON body" }, 400);
    }

    if (!filename) return json({ error: "filename is required" }, 400);
    if (!contentType || !ALLOWED_TYPES.includes(contentType)) {
      return json({ error: `content_type must be one of ${ALLOWED_TYPES.join(", ")}` }, 400);
    }

    const ext = (filename.split(".").pop() ?? "").toLowerCase();
    if (!ALLOWED_EXT.includes(ext)) {
      return json({ error: `File extension must be one of ${ALLOWED_EXT.join(", ")}` }, 400);
    }

    const safeName = filename.replace(/[^A-Za-z0-9._-]+/g, "_").slice(-80) || `upload.${ext}`;
    const key = `videos/${crypto.randomUUID()}-${safeName}`;
    const uploadUrl = await presignPutObject(storageConfigFromEnv(), key, UPLOAD_TTL_SECONDS);

    return json({
      key,
      upload_url: uploadUrl,
      method: "PUT",
      headers: { "Content-Type": contentType },
      expires_in: UPLOAD_TTL_SECONDS,
      requested_by: admin.userId,
    });
  } catch (e) {
    console.error("[r2-upload-ticket]", e);
    return json({ error: e instanceof Error ? e.message : "Unexpected error" }, 500);
  }
});
