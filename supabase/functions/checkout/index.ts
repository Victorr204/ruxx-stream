import { createClient } from "npm:@supabase/supabase-js@2";
import { json, preflight } from "../_shared/cors.ts";

// Starts a Stripe Checkout session for the monthly premium plan.
//
// Security model: like sign-stream-url, the function builds a Supabase
// client from the caller's own Authorization header, so every query runs
// under Row Level Security as that user. Stripe credentials live only in
// function secrets; when they are absent the function reports
// `configured: false` and the app keeps showing its "coming soon" state.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
const STRIPE_PRICE_ID = Deno.env.get("STRIPE_PRICE_ID") ?? "";

const STRIPE_API = "https://api.stripe.com/v1";
const APP_REDIRECT = "ruxxstream://profile";

/** application/x-www-form-urlencoded with Stripe's bracket notation. */
function encodeForm(params: Record<string, unknown>): string {
  const query = new URLSearchParams();
  const walk = (key: string, value: unknown) => {
    if (value === null || value === undefined || value === "") return;
    if (Array.isArray(value)) {
      value.forEach((item, index) => walk(`${key}[${index}]`, item));
    } else if (typeof value === "object") {
      Object.entries(value as Record<string, unknown>).forEach(([k, v]) =>
        walk(`${key}[${k}]`, v),
      );
    } else {
      query.append(key, String(value));
    }
  };
  Object.entries(params).forEach(([k, v]) => walk(k, v));
  return query.toString();
}

async function stripeRequest<T>(
  method: "GET" | "POST",
  path: string,
  params: Record<string, unknown>,
): Promise<T> {
  const url = new URL(`${STRIPE_API}${path}`);
  let body: string | undefined;
  if (method === "GET") {
    new URLSearchParams(
      Object.fromEntries(
        Object.entries(params).map(([k, v]) => [k, String(v)]),
      ),
    ).forEach((value, key) => url.searchParams.append(key, value));
  } else {
    body = encodeForm(params);
  }
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${STRIPE_SECRET_KEY}`,
      ...(method === "POST"
        ? { "Content-Type": "application/x-www-form-urlencoded" }
        : {}),
    },
    body,
  });
  const parsed = (await res.json()) as T & {
    error?: { message?: string };
  };
  if (!res.ok) throw new Error(parsed?.error?.message ?? `Stripe ${res.status}`);
  return parsed;
}

/** Appends `checkout=…` without breaking the ruxxstream:// scheme URL. */
function withCheckoutParam(redirectUrl: string, value: string): string {
  try {
    const url = new URL(redirectUrl);
    url.searchParams.set("checkout", value);
    return url.toString();
  } catch {
    const sep = redirectUrl.includes("?") ? "&" : "?";
    return `${redirectUrl}${sep}checkout=${value}`;
  }
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
    if (!STRIPE_SECRET_KEY || !STRIPE_PRICE_ID) {
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

    // One Stripe customer per Supabase user, looked up by metadata so
    // retries never create duplicates.
    const lookup = await stripeRequest<{ data: { id: string }[] }>("GET", "/customers", {
      "metadata[supabase_user_id]": userId,
      limit: 1,
    });
    let customerId = lookup.data?.[0]?.id;
    if (!customerId) {
      const created = await stripeRequest<{ id: string }>("POST", "/customers", {
        email,
        metadata: { supabase_user_id: userId },
      });
      customerId = created.id;
    }

    const session = await stripeRequest<{ url: string }>("POST", "/checkout/sessions", {
      mode: "subscription",
      customer: customerId,
      client_reference_id: userId,
      "line_items[0][price]": STRIPE_PRICE_ID,
      "line_items[0][quantity]": 1,
      success_url: withCheckoutParam(redirectUrl, "success"),
      cancel_url: withCheckoutParam(redirectUrl, "cancelled"),
      "metadata[supabase_user_id]": userId,
      "subscription_data[metadata][supabase_user_id]": userId,
    });

    if (!session.url) return json({ error: "Stripe did not return a checkout URL" }, 502);
    return json({ configured: true, url: session.url });
  } catch (e) {
    console.error("[checkout]", e);
    return json({ error: e instanceof Error ? e.message : "Unexpected error" }, 500);
  }
});
