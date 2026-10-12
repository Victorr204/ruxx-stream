import { createClient } from "npm:@supabase/supabase-js@2";
import { json, preflight } from "../_shared/cors.ts";

// "Restore purchases": replays the caller's own Paystack charge history so a
// reinstalled device (or a charge that never reached the webhook) recovers
// premium without contacting support. Paystack's transaction list is queried
// server-to-server with the secret key and matched three ways — metadata
// supabase_user_id, exact customer email, or the customer code stored on the
// profile — then the winning reference is fully re-verified before any grant,
// so this can never invent premium the caller did not pay for.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const PAYSTACK_SECRET_KEY = Deno.env.get("PAYSTACK_SECRET_KEY") ?? "";
const PAYSTACK_PLAN_AMOUNT = Number(Deno.env.get("PAYSTACK_PLAN_AMOUNT") ?? "150000");
const PAYSTACK_PROMO_BASE_AMOUNT = Number(Deno.env.get("PAYSTACK_PROMO_BASE_AMOUNT") ?? "100000");

const PAYSTACK_API = "https://api.paystack.co";

type ListTransaction = {
  reference?: string;
  status?: string;
  amount?: number;
  currency?: string;
  created_at?: string;
  customer?: { customer_code?: string; email?: string } | string;
  metadata?: { supabase_user_id?: string; premium_days?: number; promo?: boolean } | null;
};

function customerCodeOf(customer: ListTransaction["customer"]): string | null {
  if (typeof customer === "string") return customer || null;
  if (customer && typeof customer.customer_code === "string") return customer.customer_code;
  return null;
}

function customerEmailOf(customer: ListTransaction["customer"]): string | null {
  if (customer && typeof customer === "object" && typeof customer.email === "string") {
    return customer.email.toLowerCase();
  }
  return null;
}

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;

  try {
    if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
    if (!PAYSTACK_SECRET_KEY) return json({ error: "PAYSTACK_SECRET_KEY is not set" }, 500);
    if (!SERVICE_ROLE_KEY) return json({ error: "Service role key is not set" }, 500);

    const authorization = req.headers.get("Authorization");
    if (!authorization) return json({ error: "Missing Authorization header" }, 401);

    const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: userData, error: userError } = await db.auth.getUser();
    if (userError || !userData?.user) return json({ error: "Invalid session" }, 401);
    const user = userData.user;
    const callerEmail = (user.email ?? "").toLowerCase();

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: profile, error: profileError } = await admin
      .from("profiles")
      .select("is_premium, premium_until, billing_customer_id")
      .eq("id", user.id)
      .maybeSingle();
    if (profileError) return json({ error: profileError.message }, 500);

    const until = profile?.premium_until ? new Date(profile.premium_until).getTime() : 0;
    if (profile?.is_premium && (!profile.premium_until || until > Date.now())) {
      return json({ premium: true, status: "already" });
    }

    const customerCode = profile?.billing_customer_id ?? null;
    if (!customerCode && !callerEmail) {
      return json({ premium: false, status: "no-history" });
    }

    // Customer-scoped list when the profile has a code (authoritative);
    // email-scoped otherwise (payment-page charges never stored the code).
    const params = new URLSearchParams({ status: "success", perPage: "50" });
    if (customerCode) params.set("customer", customerCode);
    else params.set("email", callerEmail);
    const listRes = await fetch(`${PAYSTACK_API}/transaction?${params.toString()}`, {
      headers: { Authorization: `Bearer ${PAYSTACK_SECRET_KEY}` },
    });
    const listed = (await listRes.json()) as {
      status?: boolean;
      data?: ListTransaction[];
    };
    if (!listed.status || !Array.isArray(listed.data) || listed.data.length === 0) {
      return json({ premium: false, status: "not_found" });
    }

    const mine = listed.data.filter((tx) => {
      if (tx.currency && tx.currency !== "NGN") return false;
      const metaUid = tx.metadata?.supabase_user_id ?? "";
      if (metaUid) return metaUid === user.id;
      const code = customerCodeOf(tx.customer);
      if (code && customerCode && code === customerCode) return true;
      const email = customerEmailOf(tx.customer);
      return !!email && email === callerEmail;
    });
    mine.sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""));

    for (const candidate of mine) {
      const reference = (candidate.reference ?? "").trim();
      if (!reference) continue;
      const verifyRes = await fetch(
        `${PAYSTACK_API}/transaction/verify/${encodeURIComponent(reference)}`,
        { headers: { Authorization: `Bearer ${PAYSTACK_SECRET_KEY}` } },
      );
      const parsed = (await verifyRes.json()) as {
        status?: boolean;
        data?: ListTransaction;
      };
      if (!parsed.status || !parsed.data) continue;
      const tx = parsed.data;
      const amount = Number(tx.amount ?? 0);
      const minAmount = tx.metadata?.promo === true ? PAYSTACK_PROMO_BASE_AMOUNT : PAYSTACK_PLAN_AMOUNT;
      if (tx.status !== "success" || tx.currency !== "NGN" || amount < minAmount) continue;

      const premiumDays = Number(tx.metadata?.premium_days ?? 0);
      const premiumUntil =
        premiumDays > 0 ? new Date(Date.now() + premiumDays * 86_400_000).toISOString() : null;
      const update: Record<string, unknown> = { is_premium: true, premium_until: premiumUntil };
      const code = customerCodeOf(tx.customer);
      if (code) update.billing_customer_id = code;
      const { error: updateError } = await admin.from("profiles").update(update).eq("id", user.id);
      if (updateError) return json({ error: updateError.message }, 500);

      return json({ premium: true, status: "success", until: premiumUntil });
    }

    return json({ premium: false, status: "not_found" });
  } catch (e) {
    console.error("[restore-purchases]", e);
    return json({ error: e instanceof Error ? e.message : "Unexpected error" }, 500);
  }
});
