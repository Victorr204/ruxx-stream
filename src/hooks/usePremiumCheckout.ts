import { useCallback, useEffect, useState } from "react";
import * as WebBrowser from "expo-web-browser";
import { GOLD } from "../../context/ThemeContext";
import { useAuthStore } from "../stores/auth";
import {
  checkoutRedirectUrl,
  startCheckout,
  verifyCheckout,
  type CheckoutMode,
} from "../lib/api";

// Shared premium checkout flow for every surface that can sell Premium
// (Profile sheet, the player's ad-overlay CTA). The screen owns how alerts
// are presented — this hook only decides what to say and when the sheet is
// open — so Profile keeps its gold-accented AppAlert and the player can
// render its own.

export type CheckoutNotify = (
  title: string,
  message: string,
  type?: "info" | "success" | "error",
  accent?: string
) => void;

/** Reads `key` out of a possibly deep-link URL; returns "" when absent. */
function queryParam(url: string, key: string): string {
  if (!url) return "";
  const match = url.match(new RegExp(`[?&]${key}=([^&#]*)`));
  return match ? decodeURIComponent(match[1]) : "";
}

// One verification per reference across every entry point (auth-session
// return, cold-start deep link, web full-page redirect).
let verifiedWebReference = "";

export type PremiumCheckout = {
  premiumModal: boolean;
  openPremium: () => void;
  closePremium: () => void;
  upgrading: string;
  firstTime: boolean;
  handleUpgrade: (mode?: CheckoutMode) => Promise<void>;
};

export function usePremiumCheckout(
  notify: CheckoutNotify,
  reference?: string | string[]
): PremiumCheckout {
  const profile = useAuthStore((s) => s.profile);
  const refreshProfile = useAuthStore((s) => s.refreshProfile);
  const [upgrading, setUpgrading] = useState("");
  const [premiumModal, setPremiumModal] = useState(false);

  const firstTime = !profile?.billing_customer_id;

  // Subscription-flow alerts keep the app's gold accent so they read as
  // part of the theme rather than stock iOS colors.
  const announcePremium = useCallback(() => {
    setPremiumModal(false);
    notify(
      "Welcome to Premium",
      "Ad-free streaming and offline downloads are unlocked.",
      "success",
      GOLD
    );
  }, [notify]);

  // Alerts from inside checkout close the sheet first: both are native
  // modals, and the sheet would otherwise sit on top of the alert.
  const stopUpgrade = useCallback(
    (title: string, message: string, type: "info" | "success" | "error" = "info") => {
      setPremiumModal(false);
      notify(title, message, type, GOLD);
    },
    [notify]
  );

  // Web returns from Paystack by navigating this route with ?reference=…
  // (full-page redirect). Confirm it once; premium lands instantly.
  useEffect(() => {
    const ref = Array.isArray(reference) ? reference[0] : reference;
    if (!ref || ref === verifiedWebReference) return undefined;
    let cancelled = false;
    verifyCheckout(ref).then((verification) => {
      if (cancelled) return;
      // Only mark verified once the server confirms — a failed verify must
      // stay retryable (e.g. the return navigation fires again).
      verifiedWebReference = ref;
      if (verification.premium) {
        refreshProfile().then(() => {
          if (!cancelled) announcePremium();
        });
      }
    }).catch(() => {
      if (cancelled) return;
      verifiedWebReference = "";
    });
    return () => {
      cancelled = true;
    };
  }, [reference, refreshProfile, announcePremium]);

  const handleUpgrade = async (mode: CheckoutMode = "subscription") => {
    if (upgrading) return;
    setUpgrading(mode);
    try {
      const result = await startCheckout(mode);
      if (result.url === null) {
        if (result.reason === "not-configured") {
          stopUpgrade(
            "Premium is Coming Soon",
            "The Premium plan will unlock ad-free streaming and offline downloads. Stay tuned!",
            "info"
          );
        } else if (result.reason === "already-premium") {
          await refreshProfile();
          announcePremium();
        } else {
          stopUpgrade("Checkout Failed", result.message || "Please try again later.", "error");
        }
        return;
      }

      const redirectUrl = checkoutRedirectUrl();
      const outcome = await WebBrowser.openAuthSessionAsync(result.url, redirectUrl);
      const returnedUrl =
        outcome.type === "success" && typeof outcome.url === "string" ? outcome.url : "";
      const returnedReference = queryParam(returnedUrl, "reference");
      if (returnedReference) {
        verifiedWebReference = returnedReference;
        const verification = await verifyCheckout(returnedReference);
        if (verification.premium) {
          await refreshProfile();
          announcePremium();
          return;
        }
        if (verification.status === "failed" || verification.status === "abandoned") {
          stopUpgrade(
            "Payment Not Completed",
            "You were not charged. Tap Premium again when you're ready.",
            "error"
          );
          return;
        }
      }
      await refreshProfile();
      if (useAuthStore.getState().profile?.is_premium) {
        announcePremium();
        return;
      }
      // Payment-page flow returns no reference (the browser is closed on
      // dismiss) — the webhook grants within seconds of a successful charge,
      // so poll briefly either way before giving up. Bank transfers confirm
      // a little slower, so that path waits longer.
      const dismissed = outcome.type !== "success";
      const attempts = mode === "transfer" ? 12 : 6;
      for (let attempt = 0; attempt < attempts; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 2500));
        await refreshProfile();
        if (useAuthStore.getState().profile?.is_premium) {
          announcePremium();
          return;
        }
      }
      stopUpgrade(
        "Payment Processing",
        dismissed
          ? "If your payment went through, Premium activates within a minute — reopen Profile to see it."
          : "Your payment is being confirmed. Premium activates within a minute — reopen Profile to see it.",
        "info"
      );
    } catch (e) {
      stopUpgrade(
        "Checkout Failed",
        e instanceof Error ? e.message : "Please try again later.",
        "error"
      );
    } finally {
      setUpgrading("");
    }
  };

  return {
    premiumModal,
    openPremium: useCallback(() => setPremiumModal(true), []),
    closePremium: useCallback(() => setPremiumModal(false), []),
    upgrading,
    firstTime,
    handleUpgrade,
  };
}
