import { createClient } from "npm:@supabase/supabase-js@2";
import { json, preflight } from "../_shared/cors.ts";
import { deleteObject, storageConfigFromEnv } from "../_shared/storage.ts";

// Admin-only: removes a video object from storage. The caller must also update or
// delete the movie row afterwards (done by the admin panel).

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

const KEY_PREFIX = "videos/";

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;

  try {
    if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

    const authorization = req.headers.get("Authorization");
    if (!authorization) return json({ error: "Missing Authorization header" }, 401);

    const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: userData, error: userError } = await db.auth.getUser();
    if (userError || !userData?.user) return json({ error: "Invalid session" }, 401);

    const { data: profile } = await db
      .from("profiles")
      .select("role")
      .eq("id", userData.user.id)
      .maybeSingle();
    if (profile?.role !== "admin") return json({ error: "Admin access required" }, 403);

    let key = "";
    try {
      const body = await req.json();
      key = typeof body?.key === "string" ? body.key : "";
    } catch {
      return json({ error: "Invalid JSON body" }, 400);
    }

    if (!key) return json({ error: "key is required" }, 400);
    // Never delete outside the videos/ prefix.
    if (!key.startsWith(KEY_PREFIX)) {
      return json({ error: `key must start with ${KEY_PREFIX}` }, 400);
    }

    const result = await deleteObject(storageConfigFromEnv(), key);
    return json({ ok: result.ok, status: result.status, key }, result.ok ? 200 : 502);
  } catch (e) {
    console.error("[r2-delete]", e);
    return json({ error: e instanceof Error ? e.message : "Unexpected error" }, 500);
  }
});
