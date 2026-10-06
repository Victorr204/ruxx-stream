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
 * metadata) or by the Paystack customer code stored at first charge.
 */
async function applyProfile(
  db: AdminClient,
  args: { userId: string | null; customerCode: string | null; premium: boolean },
): Promise<void> {
  const { userId, customerCode, premium } = args;
  if (!userId && !customerCode) {
    console.warn("[paystack-webhook] no profile mapping for event", { premium });
    return;
  }

  const update: Record<string, unknown> = { is_premium: premium };
  if (customerCode) update.billing_customer_id = customerCode;

  let query = db.from("profiles").update(update);
  if (userId) query = query.eq("id", userId);
  else query = query.eq("billing_customer_id", customerCode as string);

  const { error } = await query;
  if (error) {
    console.warn("[paystack-webhook] premium update failed", error.message);
  } else {
    console.log(
      `[paystack-webhook] profile ${userId ?? customerCode} premium=${premium}`,
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
    const status = str(object.status);
    const amount = Number(object.amount ?? 0);

    switch (event.event) {
      case "charge.success": {
        const paid = status === "success" && amount >= PAYSTACK_PLAN_AMOUNT;
        if (paid) {
          await applyProfile(admin, { userId: metadataUid, customerCode, premium: true });
        }
        break;
      }
      case "subscription.create":
        // The first charge already succeeded (charge.success also fires and
        // is idempotent); grant on whichever identifier is available.
        await applyProfile(admin, { userId: metadataUid, customerCode, premium: true });
        break;
      case "subscription.disable":
      case "subscription.not_renew":
        await applyProfile(admin, { userId: metadataUid, customerCode, premium: false });
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
