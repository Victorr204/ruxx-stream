import { createClient } from "npm:@supabase/supabase-js@2";
import { json, preflight } from "../_shared/cors.ts";

// Admin-only broadcast: fans a message out to every registered device via
// the Expo Push Service. Tokens are read with the caller's own (admin)
// session — push_tokens has an admin select policy — so no service-role
// key is required here.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
const CHUNK_SIZE = 100; // Expo rejects tickets beyond this per request
const MAX_TITLE = 100;
const MAX_BODY = 300;

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

type TicketRow = { status?: string; details?: { error?: string } };

async function sendChunk(messages: Record<string, unknown>[]): Promise<number> {
  const response = await fetch(EXPO_PUSH_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      "accept-encoding": "gzip, deflate",
    },
    body: JSON.stringify(messages),
  });

  const payload = await response.json().catch(() => null);
  const rows: TicketRow[] = Array.isArray(payload?.data) ? payload.data : [];
  if (!response.ok && rows.length === 0) return messages.length;

  let failed = 0;
  for (const row of rows) {
    if (row?.status !== "ok") failed += 1;
  }
  // Fewer tickets than messages means Expo dropped some — count the gap.
  if (rows.length < messages.length) failed += messages.length - rows.length;
  return failed;
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

    let title = "";
    let body = "";
    try {
      const parsed = await req.json();
      title = typeof parsed?.title === "string" ? parsed.title.trim() : "";
      body = typeof parsed?.body === "string" ? parsed.body.trim() : "";
    } catch {
      return json({ error: "Invalid JSON body" }, 400);
    }

    if (!title) return json({ error: "title is required" }, 400);
    if (title.length > MAX_TITLE) return json({ error: `title must be at most ${MAX_TITLE} characters` }, 400);
    if (body.length > MAX_BODY) return json({ error: `body must be at most ${MAX_BODY} characters` }, 400);

    const { data: tokens, error: tokenError } = await admin.db
      .from("push_tokens")
      .select("token");
    if (tokenError) return json({ error: tokenError.message }, 500);

    const uniqueTokens = [...new Set((tokens ?? []).map((row) => row.token))];
    if (uniqueTokens.length === 0) {
      return json({ sent: 0, failed: 0, total: 0, requested_by: admin.userId });
    }

    const messages = uniqueTokens.map((token) => ({
      to: token,
      title,
      body,
      sound: "default",
      priority: "high",
    }));

    let failed = 0;
    for (let offset = 0; offset < messages.length; offset += CHUNK_SIZE) {
      const chunk = messages.slice(offset, offset + CHUNK_SIZE);
      try {
        failed += await sendChunk(chunk);
      } catch (e) {
        console.error("[send-push] chunk failed", e);
        failed += chunk.length;
      }
    }

    return json({
      sent: messages.length - failed,
      failed,
      total: messages.length,
      requested_by: admin.userId,
    });
  } catch (e) {
    console.error("[send-push]", e);
    return json({ error: e instanceof Error ? e.message : "Unexpected error" }, 500);
  }
});
