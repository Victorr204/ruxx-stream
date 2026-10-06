import { createClient } from "npm:@supabase/supabase-js@2";
import { json, preflight } from "../_shared/cors.ts";

// Confirms a Paystack transaction after the browser returns from checkout
// and grants premium immediately, so the user never waits on the webhook.
// paystack-webhook remains the source of truth for renewals/cancellations.
//
// Security model: the caller's own Authorization header authenticates the
// request, the transaction metadata must name that same user, and the paid
// check runs server-to-server against Paystack with the secret key. The
// final profiles update runs as the service role because the privilege
// guard blocks ordinary app users from flipping is_premium themselves.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const PAYSTACK_SECRET_KEY = Deno.env.get("PAYSTACK_SECRET_KEY") ?? "";
const PAYSTACK_PLAN_AMOUNT = Number(Deno.env.get("PAYSTACK_PLAN_AMOUNT") ?? "150000");

const PAYSTACK_API = "https://api.paystack.co";

type VerifyTransaction = {
  status?: string;
  amount?: number;
  currency?: string;
  customer?: { customer_code?: string } | string;
  metadata?: { supabase_user_id?: string } | null;
};

function customerCodeOf(customer: VerifyTransaction["customer"]): string | null {
  if (typeof customer === "string") return customer || null;
  if (customer && typeof customer.customer_code === "string") return customer.customer_code;
  return null;
}

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;

  try {
    if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
    if (!PAYSTACK_SECRET_KEY) {
      return json({ error: "PAYSTACK_SECRET_KEY is not set" }, 500);
    }

    const authorization = req.headers.get("Authorization");
    if (!authorization) return json({ error: "Missing Authorization header" }, 401);

    let reference = "";
    try {
      const body = await req.json();
      reference = typeof body?.reference === "string" ? body.reference.trim() : "";
    } catch {
      reference = "";
    }
    if (!reference) return json({ error: "reference is required" }, 400);

    const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: userData, error: userError } = await db.auth.getUser();
    if (userError || !userData?.user) return json({ error: "Invalid session" }, 401);

    const res = await fetch(
      `${PAYSTACK_API}/transaction/verify/${encodeURIComponent(reference)}`,
      { headers: { Authorization: `Bearer ${PAYSTACK_SECRET_KEY}` } },
    );
    const parsed = (await res.json()) as {
      status?: boolean;
      message?: string;
      data?: VerifyTransaction;
    };

    if (!parsed.status || !parsed.data) {
      return json({ premium: false, status: "not_found" });
    }

    const tx = parsed.data;
    const owner = tx.metadata?.supabase_user_id ?? "";
    if (!owner) return json({ premium: false, status: "unlinked" });
    if (owner !== userData.user.id) return json({ error: "reference belongs to another user" }, 403);

    const amount = Number(tx.amount ?? 0);
    const paid =
      tx.status === "success" &&
      tx.currency === "NGN" &&
      amount >= PAYSTACK_PLAN_AMOUNT;

    if (!paid) return json({ premium: false, status: tx.status ?? "unknown" });

    if (!SERVICE_ROLE_KEY) return json({ error: "Service role key is not set" }, 500);
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const customerCode = customerCodeOf(tx.customer);
    const update: Record<string, unknown> = { is_premium: true };
    if (customerCode) update.billing_customer_id = customerCode;
    const { error: updateError } = await admin
      .from("profiles")
      .update(update)
      .eq("id", owner);
    if (updateError) {
      console.error("[paystack-verify] premium update failed", updateError.message);
      return json({ error: updateError.message }, 500);
    }

    return json({ premium: true, status: "success" });
  } catch (e) {
    console.error("[paystack-verify]", e);
    return json({ error: e instanceof Error ? e.message : "Unexpected error" }, 500);
  }
});
