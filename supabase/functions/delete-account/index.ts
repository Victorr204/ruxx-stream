import { createClient } from "npm:@supabase/supabase-js@2";
import { json, preflight } from "../_shared/cors.ts";

// Account deletion: removes the caller's auth user (profiles and other FK
// children cascade) plus rows in tables that keep user_id nullable. The
// caller's own Authorization header is the only credential accepted — a user
// can only ever delete themselves.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const USER_SCOPED_TABLES = [
  "ad_events",
  "client_error_logs",
  "download_grants",
  "playback_events",
  "push_tokens",
  "user_list_items",
  "user_lists",
  "watch_progress",
];

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;

  try {
    if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
    if (!SERVICE_ROLE_KEY) return json({ error: "Service role key is not set" }, 500);

    const authorization = req.headers.get("Authorization");
    if (!authorization) return json({ error: "Missing Authorization header" }, 401);

    const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: userData, error: userError } = await db.auth.getUser();
    if (userError || !userData?.user) return json({ error: "Invalid session" }, 401);
    const userId = userData.user.id;

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // Nullable-FK children must go before profiles, or deleting the profile
    // orphans their rows (ad_events / playback_events keep user_id set).
    for (const table of USER_SCOPED_TABLES) {
      const { error } = await admin.from(table).delete().eq("user_id", userId);
      if (error) console.warn(`[delete-account] skip ${table}:`, error.message);
    }

    const { error: metadataError } = await admin.from("profiles").delete().eq("id", userId);
    if (metadataError) return json({ error: metadataError.message }, 500);

    const { error: deleteError } = await admin.auth.admin.deleteUser(userId);
    if (deleteError) return json({ error: deleteError.message }, 500);

    return json({ deleted: true });
  } catch (e) {
    console.error("[delete-account]", e);
    return json({ error: e instanceof Error ? e.message : "Unexpected error" }, 500);
  }
});
