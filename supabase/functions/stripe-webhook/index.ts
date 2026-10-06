import { createClient } from "npm:@supabase/supabase-js@2";
import { json, preflight } from "../_shared/cors.ts";

// Receives Stripe billing events and keeps profiles.is_premium truthful.
//
// Security model: the Stripe-Signature header is verified against
// STRIPE_WEBHOOK_SECRET before anything is parsed, every event is logged
// once (unique stripe_event_id ⇒ redeliveries are no-ops), and writes run
// as the service role — the amended guard_profile_privileges trigger
// explicitly trusts that role while still blocking app users.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const STRIPE_WEBHOOK_SECRET = Deno.env.get("STRIPE_WEBHOOK_SECRET") ?? "";

// Built once per cold start; typed off the concrete call so helper
// signatures never drift from the client's inferred generics.
const admin =
  SUPABASE_URL && SERVICE_ROLE_KEY
    ? createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
        auth: { persistSession: false, autoRefreshToken: false },
      })
    : null;

type AdminClient = NonNullable<typeof admin>;

const SIGNATURE_TOLERANCE_SECONDS = 300;
/** Subscription statuses that unlock premium benefits. */
const PREMIUM_STATUSES = new Set(["active", "trialing"]);

type StripeObject = Record<string, unknown> & {
  customer?: string | { id?: string };
  metadata?: Record<string, string>;
  status?: string;
};

function customerIdOf(object: StripeObject): string | null {
  const customer = object.customer;
  if (typeof customer === "string") return customer;
  if (customer && typeof customer.id === "string") return customer.id;
  return null;
}

async function verifySignature(
  rawBody: string,
  header: string | null,
  secret: string,
): Promise<boolean> {
  if (!header) return false;
  const parts = header.split(",").map((piece) => piece.split("="));
  const timestamp = parts.find(([key]) => key === "t")?.[1];
  const signed = parts.filter(([key]) => key === "v1").map(([, value]) => value);
  if (!timestamp || signed.length === 0) return false;

  const age = Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp));
  if (!Number.isFinite(age) || age > SIGNATURE_TOLERANCE_SECONDS) return false;

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(`${timestamp}.${rawBody}`),
  );
  const expected = Array.from(new Uint8Array(mac))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return signed.includes(expected);
}

/** Flips is_premium from a subscription payload, located by metadata or customer id. */
async function applySubscription(admin: AdminClient, subscription: StripeObject): Promise<void> {
  const status = typeof subscription.status === "string" ? subscription.status : "";
  const premium = PREMIUM_STATUSES.has(status);
  const customerId = customerIdOf(subscription);

  let profileId = subscription.metadata?.supabase_user_id ?? null;
  if (!profileId && customerId) {
    const { data } = await admin
      .from("profiles")
      .select("id")
      .eq("stripe_customer_id", customerId)
      .maybeSingle();
    profileId = data?.id ?? null;
  }
  if (!profileId) {
    console.warn("[stripe-webhook] no profile mapping for subscription", {
      customer: customerId,
      status,
    });
    return;
  }

  const update: Record<string, unknown> = { is_premium: premium };
  if (customerId) update.stripe_customer_id = customerId;
  const { error } = await admin.from("profiles").update(update).eq("id", profileId);
  if (error) {
    console.warn("[stripe-webhook] premium update failed", error.message);
  } else {
    console.log(`[stripe-webhook] profile ${profileId} premium=${premium} (${status})`);
  }
}

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;

  try {
    if (!STRIPE_WEBHOOK_SECRET) {
      return json({ error: "STRIPE_WEBHOOK_SECRET is not set" }, 500);
    }

    const rawBody = await req.text();
    const valid = await verifySignature(
      rawBody,
      req.headers.get("stripe-signature"),
      STRIPE_WEBHOOK_SECRET,
    );
    if (!valid) return json({ error: "Invalid signature" }, 400);

    let event: { id?: string; type?: string; data?: { object?: StripeObject } };
    try {
      event = JSON.parse(rawBody);
    } catch {
      return json({ error: "Malformed JSON" }, 400);
    }
    if (!event.id || !event.type) return json({ error: "Not a Stripe event" }, 400);
    if (!admin) return json({ error: "SUPABASE_SERVICE_ROLE_KEY is not set" }, 500);

    // Idempotency first: a duplicate event id means Stripe redelivered,
    // so acknowledge without touching any state.
    const { error: logError } = await admin.from("billing_events").insert({
      stripe_event_id: event.id,
      type: event.type,
      payload: event,
    });
    if (logError) {
      if (logError.code === "23505") return json({ received: true, duplicate: true });
      // Handlers below are idempotent, so processing continues even when
      // the audit insert fails (e.g. quota hiccup).
      console.warn("[stripe-webhook] event log failed", logError.message);
    }

    const object = (event.data?.object ?? {}) as StripeObject;

    switch (event.type) {
      case "checkout.session.completed": {
        const userId =
          (typeof object.client_reference_id === "string" ? object.client_reference_id : null) ??
          object.metadata?.supabase_user_id ??
          null;
        const customerId = customerIdOf(object);
        if (userId && customerId) {
          const { error } = await admin
            .from("profiles")
            .update({ stripe_customer_id: customerId })
            .eq("id", userId);
          if (error) console.warn("[stripe-webhook] customer link failed", error.message);
        }
        // Premium itself follows from the customer.subscription.* events.
        break;
      }
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted":
        await applySubscription(admin, object);
        break;
      default:
        // Anything else (invoices, payment intents…) just gets logged.
        break;
    }

    return json({ received: true });
  } catch (e) {
    console.error("[stripe-webhook]", e);
    return json({ error: e instanceof Error ? e.message : "Unexpected error" }, 500);
  }
});
