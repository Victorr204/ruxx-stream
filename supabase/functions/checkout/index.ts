import { createClient } from "npm:@supabase/supabase-js@2";
import { json, preflight } from "../_shared/cors.ts";

// Opens Paystack checkout for the monthly premium plan: the subscription
// payment page when PAYSTACK_PAYMENT_PAGE is set (preferred — its email
// field is locked so the webhook/verify can map the charge back to the
// account), or a transaction initialize otherwise.
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
const PAYSTACK_PAYMENT_PAGE = Deno.env.get("PAYSTACK_PAYMENT_PAGE") ?? "";

const PAYSTACK_API = "https://api.paystack.co";
const APP_REDIRECT = "ruxxstream://profile";

type PaystackEnvelope<T> = { status: boolean; message: string; data?: T };

async function paystackRequest<T>(
  path: string,
  body: Record<string, unknown>,
): Promise<T> {
  const res = await fetch(`${PAYSTACK_API}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const parsed = (await res.json()) as PaystackEnvelope<T>;
  if (!parsed.status || !parsed.data) {
    throw new Error(parsed.message || `Paystack ${res.status}`);
  }
  return parsed.data;
}

function safeRedirect(candidate: unknown): string {
  const value = typeof candidate === "string" ? candidate.trim() : "";
  if (
    value.startsWith("ruxxstream://") ||
    value.startsWith("https://") ||
    value.startsWith("http://")
  ) {
    return value.split("#")[0];
  }
  return APP_REDIRECT;
}

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;

  try {
    if (!PAYSTACK_SECRET_KEY || !PAYSTACK_PLAN_CODE) {
      return json({ configured: false });
    }

    const authorization = req.headers.get("Authorization");
    if (!authorization) return json({ error: "Missing Authorization header" }, 401);

    let redirectUrl = APP_REDIRECT;
    try {
      const body = await req.json();
      redirectUrl = safeRedirect(body?.redirect_url);
    } catch {
      redirectUrl = APP_REDIRECT;
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
      .select("is_premium")
      .eq("id", userId)
      .maybeSingle();
    if (profileError) return json({ error: profileError.message }, 500);
    if (profile?.is_premium) return json({ error: "already_premium" }, 409);

    if (PAYSTACK_PAYMENT_PAGE) {
      const pageUrl = email
        ? `${PAYSTACK_PAYMENT_PAGE}?email=${encodeURIComponent(email)}&read-only=email`
        : PAYSTACK_PAYMENT_PAGE;
      return json({ configured: true, url: pageUrl });
    }

    const reference = `ruxx_${crypto.randomUUID().replaceAll("-", "")}`;
    const data = await paystackRequest<{ authorization_url: string; reference: string }>(
      "/transaction/initialize",
      {
        email,
        amount: PAYSTACK_PLAN_AMOUNT, // kobo
        currency: "NGN",
        plan: PAYSTACK_PLAN_CODE,
        reference,
        callback_url: redirectUrl,
        metadata: { supabase_user_id: userId },
      },
    );

    if (!data.authorization_url) {
      return json({ error: "Paystack did not return a checkout URL" }, 502);
    }
    return json({ configured: true, url: data.authorization_url, reference: data.reference });
  } catch (e) {
    console.error("[checkout]", e);
    return json({ error: e instanceof Error ? e.message : "Unexpected error" }, 500);
  }
});
