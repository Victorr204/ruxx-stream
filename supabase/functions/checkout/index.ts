import { createClient } from "npm:@supabase/supabase-js@2";
import { json, preflight } from "../_shared/cors.ts";

// Opens Paystack checkout for premium in one of two modes:
//
//   "subscription" (default) — card payment bound to the monthly plan, so it
//   renews automatically. The plan's amount is synced to the VAT-inclusive
//   total first (Paystack charges whatever the plan says, ignoring `amount`),
//   and the channel list is card-only because renewals can only draw on a
//   stored card authorization.
//
//   "transfer" — a one-time charge for the same VAT-inclusive total over
//   Pay with Transfer (card kept as a fallback). It carries
//   metadata.premium_days, so verify/webhook grant a bounded window instead
//   of lifetime premium.
//
// First-time promo: a member who has never been charged (no
// billing_customer_id) pays PAYSTACK_PROMO_BASE_AMOUNT plus the same VAT
// for their first PREMIUM_WINDOW_DAYS on either channel — one-time, no
// plan — and the regular prices apply from their next purchase.
//
// Security model: like sign-stream-url, the function builds a Supabase
// client from the caller's own Authorization header, so every query runs
// under Row Level Security as that user. Paystack credentials live only in
// function secrets; when they are absent the function reports
// `configured: false` and the app keeps showing its "coming soon" state.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const PAYSTACK_SECRET_KEY = Deno.env.get("PAYSTACK_SECRET_KEY") ?? "";
const PAYSTACK_PLAN_CODE = Deno.env.get("PAYSTACK_PLAN_CODE") ?? "";
const PAYSTACK_PLAN_AMOUNT = Number(Deno.env.get("PAYSTACK_PLAN_AMOUNT") ?? "150000");
const PAYSTACK_PROMO_BASE_AMOUNT = Number(Deno.env.get("PAYSTACK_PROMO_BASE_AMOUNT") ?? "100000");
const PAYSTACK_VAT_RATE = Number(Deno.env.get("PAYSTACK_VAT_RATE") ?? "7.5");
const PAYSTACK_PAYMENT_PAGE = Deno.env.get("PAYSTACK_PAYMENT_PAGE") ?? "";

const PAYSTACK_API = "https://api.paystack.co";
const APP_REDIRECT = "ruxxstream://profile";
const PREMIUM_WINDOW_DAYS = 30;

type CheckoutMode = "subscription" | "transfer";
type PaystackEnvelope<T> = { status: boolean; message: string; data?: T };

function withTotal(amount: number): number {
  if (!Number.isFinite(PAYSTACK_VAT_RATE) || PAYSTACK_VAT_RATE < 0) return amount;
  return Math.round((amount * (100 + PAYSTACK_VAT_RATE)) / 100);
}

async function paystackRequest<T>(
  method: "POST" | "PUT",
  path: string,
  body: Record<string, unknown>,
): Promise<T | undefined> {
  const res = await fetch(`${PAYSTACK_API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const parsed = (await res.json()) as PaystackEnvelope<T>;
  // Paystack answers some successful calls (e.g. Update Plan with no
  // subscriptions) with `status: true, data: null`, so only a false status
  // is an error; callers guard against a missing payload themselves.
  if (!parsed.status) {
    throw new Error(parsed.message || `Paystack ${res.status}`);
  }
  return parsed.data;
}

/**
 * Keeps the plan's amount equal to the VAT-inclusive total so card charges
 * (first payment and every renewal) match what the app advertises. Failure
 * is non-fatal: the checkout still opens at the plan's current price.
 */
async function syncPlanAmount(amount: number): Promise<void> {
  if (!PAYSTACK_PLAN_CODE) return;
  try {
    await paystackRequest("PUT", `/plan/${PAYSTACK_PLAN_CODE}`, { amount });
  } catch (e) {
    console.warn("[checkout] plan amount sync failed", e);
  }
}

// Paystack redirects the browser here after checkout, so this is an
// open-redirect surface: only the app scheme and an explicit origin
// allowlist (CHECKOUT_REDIRECT_ORIGINS, comma separated — the deployed web
// origin plus localhost in dev) may pass; everything else falls back to the
// in-app profile route.
function safeRedirect(candidate: unknown): string {
  const value = typeof candidate === "string" ? candidate.trim() : "";
  if (!value) return APP_REDIRECT;
  if (value.startsWith("ruxxstream://")) return value.split("#")[0];
  try {
    const url = new URL(value);
    const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
    const allowed = new Set(
      (Deno.env.get("CHECKOUT_REDIRECT_ORIGINS") ?? "")
        .split(",")
        .map((entry) => entry.trim().replace(/\/+$/, ""))
        .filter(Boolean),
    );
    if (local) allowed.add("http://localhost:8081");
    if ((url.protocol === "https:" || (local && url.protocol === "http:")) && allowed.has(url.origin)) {
      return value.split("#")[0];
    }
  } catch {
    // fall through to the app route
  }
  return APP_REDIRECT;
}

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;

  try {
    if (!PAYSTACK_SECRET_KEY) {
      return json({ configured: false });
    }

    const authorization = req.headers.get("Authorization");
    if (!authorization) return json({ error: "Missing Authorization header" }, 401);

    let redirectUrl = APP_REDIRECT;
    let mode: CheckoutMode = "subscription";
    try {
      const body = await req.json();
      redirectUrl = safeRedirect(body?.redirect_url);
      mode = body?.mode === "transfer" ? "transfer" : "subscription";
    } catch {
      redirectUrl = APP_REDIRECT;
    }

    if (mode === "subscription" && !PAYSTACK_PLAN_CODE) {
      return json({ configured: false });
    }

    const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: userData, error: userError } = await db.auth.getUser();
    if (userError || !userData?.user) return json({ error: "Invalid session" }, 401);
    const userId = userData.user.id;
    const email = userData.user.email ?? "";

    const { data: profile, error: profileError } = await db
      .from("profiles")
      .select("is_premium, premium_until, billing_customer_id")
      .eq("id", userId)
      .maybeSingle();
    if (profileError) return json({ error: profileError.message }, 500);
    const windowOpen =
      profile?.is_premium === true &&
      (!profile.premium_until || new Date(profile.premium_until).getTime() > Date.now());
    if (windowOpen) return json({ error: "already_premium" }, 409);

    const firstTime = !profile?.billing_customer_id;
    const total = withTotal(PAYSTACK_PLAN_AMOUNT); // kobo, VAT inclusive
    const charge = firstTime ? withTotal(PAYSTACK_PROMO_BASE_AMOUNT) : total;
    if (mode === "subscription" && !firstTime) await syncPlanAmount(total);

    if (mode === "subscription" && !firstTime && PAYSTACK_PAYMENT_PAGE) {
      const pageUrl = email
        ? `${PAYSTACK_PAYMENT_PAGE}?email=${encodeURIComponent(email)}&read-only=email`
        : PAYSTACK_PAYMENT_PAGE;
      return json({ configured: true, url: pageUrl });
    }

    const reference = `ruxx_${crypto.randomUUID().replaceAll("-", "")}`;
    const metadata: Record<string, unknown> = {
      supabase_user_id: userId,
      payment_type: firstTime ? "promo" : mode,
    };
    if (firstTime) {
      metadata.premium_days = PREMIUM_WINDOW_DAYS;
      metadata.promo = true;
    } else if (mode === "transfer") {
      metadata.premium_days = PREMIUM_WINDOW_DAYS;
    }

    const payload: Record<string, unknown> = {
      email,
      amount: charge,
      currency: "NGN",
      reference,
      callback_url: redirectUrl,
      metadata,
    };
    if (mode === "subscription" && !firstTime) {
      payload.plan = PAYSTACK_PLAN_CODE;
      payload.channels = ["card"];
    } else if (mode === "transfer") {
      payload.channels = ["bank_transfer", "card"];
    } else {
      payload.channels = ["card"];
    }

    const data = await paystackRequest<{ authorization_url: string; reference: string }>(
      "POST",
      "/transaction/initialize",
      payload,
    );

    if (!data?.authorization_url) {
      return json({ error: "Paystack did not return a checkout URL" }, 502);
    }
    return json({ configured: true, url: data.authorization_url, reference: data.reference });
  } catch (e) {
    console.error("[checkout]", e);
    return json({ error: e instanceof Error ? e.message : "Unexpected error" }, 500);
  }
});
