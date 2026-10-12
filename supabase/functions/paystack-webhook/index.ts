import { createClient } from "npm:@supabase/supabase-js@2";
import { json, preflight } from "../_shared/cors.ts";

// Receives Paystack billing events and keeps profiles.is_premium truthful.
//
// Security model: the x-paystack-signature header is HMAC-SHA512 of the raw
// body with the secret key and is verified before anything is parsed, every
// event is logged once (event id = SHA-256 of the raw payload ⇒ redeliveries
// are no-ops), and writes run as the service role — the amended
// guard_profile_privileges trigger explicitly trusts that role while still
// blocking app users.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const PAYSTACK_SECRET_KEY = Deno.env.get("PAYSTACK_SECRET_KEY") ?? "";
const PAYSTACK_PLAN_AMOUNT = Number(Deno.env.get("PAYSTACK_PLAN_AMOUNT") ?? "150000");
const PAYSTACK_PROMO_BASE_AMOUNT = Number(Deno.env.get("PAYSTACK_PROMO_BASE_AMOUNT") ?? "100000");

// Built once per cold start; typed off the concrete call so helper
// signatures never drift from the client's inferred generics.
const admin =
  SUPABASE_URL && SERVICE_ROLE_KEY
    ? createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
        auth: { persistSession: false, autoRefreshToken: false },
      })
    : null;

type AdminClient = NonNullable<typeof admin>;

type PaystackEvent = { event?: string; data?: Record<string, unknown> };

/**
 * Maps a payer's email to a user id. Payment-page charges carry no
 * supabase_user_id metadata (the page locks the email instead), so the
 * webhook resolves the account through GoTrue before granting.
 */
async function userIdForEmail(db: AdminClient, email: string): Promise<string | null> {
  const target = email.trim().toLowerCase();
  if (!target) return null;
  for (let page = 1; page <= 5; page += 1) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 100 });
    if (error || !data?.users?.length) return null;
    const match = data.users.find((user) => (user.email ?? "").toLowerCase() === target);
    if (match) return match.id;
    if (data.users.length < 100) return null;
  }
  return null;
}

async function hmacSha512Hex(secret: string, body: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-512" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, encoder.encode(body));
  return Array.from(new Uint8Array(mac))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function sha256Hex(body: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function str(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

function customerCodeOf(value: unknown): string | null {
  if (typeof value === "string") return value || null;
  if (value && typeof value === "object") return str((value as Record<string, unknown>).customer_code);
  return null;
}

/**
 * Flips is_premium for one profile, located by user id (from transaction
 * metadata), by the payer's email (payment-page charges), or by the
 * Paystack customer code stored at first charge. premiumUntil opens a
 * bounded window for one-time charges (bank transfer) and clears it for
 * subscription charges, which renew on their own.
 */
async function applyProfile(
  db: AdminClient,
  args: {
    userId: string | null;
    customerCode: string | null;
    email: string | null;
    premium: boolean;
    premiumUntil: string | null;
  },
): Promise<void> {
  const { userId, customerCode, email, premium, premiumUntil } = args;
  const ownerId = userId ?? (email ? await userIdForEmail(db, email) : null);
  if (!ownerId && !customerCode) {
    console.warn("[paystack-webhook] no profile mapping for event", { premium });
    return;
  }

  const update: Record<string, unknown> = { is_premium: premium, premium_until: premiumUntil };
  if (customerCode) update.billing_customer_id = customerCode;

  let query = db.from("profiles").update(update);
  if (ownerId) query = query.eq("id", ownerId);
  else query = query.eq("billing_customer_id", customerCode as string);

  const { error } = await query;
  if (error) {
    console.warn("[paystack-webhook] premium update failed", error.message);
  } else {
    console.log(
      `[paystack-webhook] profile ${ownerId ?? customerCode} premium=${premium}`,
    );
  }
}

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;

  try {
    if (!PAYSTACK_SECRET_KEY) {
      return json({ error: "PAYSTACK_SECRET_KEY is not set" }, 500);
    }

    const rawBody = await req.text();
    const provided = req.headers.get("x-paystack-signature");
    const expected = await hmacSha512Hex(PAYSTACK_SECRET_KEY, rawBody);
    if (!provided || provided !== expected) {
      return json({ error: "Invalid signature" }, 400);
    }

    let event: PaystackEvent;
    try {
      event = JSON.parse(rawBody);
    } catch {
      return json({ error: "Malformed JSON" }, 400);
    }
    if (!event.event) return json({ error: "Not a Paystack event" }, 400);
    if (!admin) return json({ error: "Service role key is not set" }, 500);

    // Idempotency first: identical payloads mean Paystack redelivered, so
    // acknowledge without touching any state (handlers below are idempotent
    // anyway, so a re-serialization would be harmless).
    const eventId = await sha256Hex(rawBody);
    const { error: logError } = await admin.from("billing_events").insert({
      event_id: eventId,
      type: event.event,
      payload: event,
    });
    if (logError) {
      if (logError.code === "23505") return json({ received: true, duplicate: true });
      console.warn("[paystack-webhook] event log failed", logError.message);
    }

    const object = (event.data ?? {}) as Record<string, unknown>;
    const metadataUid = str(
      object.metadata && typeof object.metadata === "object"
        ? (object.metadata as Record<string, unknown>).supabase_user_id
        : null,
    );
    const customerCode = customerCodeOf(object.customer);
    const customerEmail =
      object.customer && typeof object.customer === "object"
        ? str((object.customer as Record<string, unknown>).email)
        : null;
    const status = str(object.status);
    const amount = Number(object.amount ?? 0);
    const metadataMap =
      object.metadata && typeof object.metadata === "object"
        ? (object.metadata as Record<string, unknown>)
        : null;
    const premiumDays = Number(metadataMap?.premium_days ?? 0);
    const promo = metadataMap?.promo === true;
    const premiumUntil =
      premiumDays > 0
        ? new Date(Date.now() + premiumDays * 86_400_000).toISOString()
        : null;

    switch (event.event) {
      case "charge.success": {
        const minAmount = promo ? PAYSTACK_PROMO_BASE_AMOUNT : PAYSTACK_PLAN_AMOUNT;
        const paid = status === "success" && amount >= minAmount;
        if (paid) {
          await applyProfile(admin, {
            userId: metadataUid,
            customerCode,
            email: customerEmail,
            premium: true,
            premiumUntil,
          });
        }
        break;
      }
      case "subscription.create":
        // The first charge already succeeded (charge.success also fires and
        // is idempotent); grant on whichever identifier is available.
        await applyProfile(admin, {
          userId: metadataUid,
          customerCode,
          email: customerEmail,
          premium: true,
          premiumUntil: null,
        });
        break;
      case "subscription.disable":
      case "subscription.not_renew":
        await applyProfile(admin, {
          userId: metadataUid,
          customerCode,
          email: customerEmail,
          premium: false,
          premiumUntil: null,
        });
        break;
      case "invoice.payment_failed":
        // Paystack keeps retrying; premium only drops on subscription.disable.
        break;
      default:
        // Anything else just gets logged.
        break;
    }

    return json({ received: true });
  } catch (e) {
    console.error("[paystack-webhook]", e);
    return json({ error: e instanceof Error ? e.message : "Unexpected error" }, 500);
  }
});
