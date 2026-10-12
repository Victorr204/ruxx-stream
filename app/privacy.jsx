import LegalScreen from "../src/components/LegalScreen";

const SECTIONS = [
  {
    heading: "Who we are",
    body: [
      "ruxx stream (“the App”) is a video streaming application operated by Ruxx Digital. This policy explains what we collect, why, and the choices you have. It applies to the mobile and web versions of the App.",
    ],
  },
  {
    heading: "Information we collect",
    body: [
      "Account data: your email address and the display name you choose. Payment data: subscriptions are handled by Paystack — we receive the transaction reference, plan status, and expiry date, but we never see or store your card number, PIN, or bank credentials.",
      "Viewing data: playback progress, titles you watch, and which lists you add, so the App can resume playback, keep your My List, and rank recommendations. Push token: if you enable notifications, we store a device push token so we can send you download-ready alerts and announcements.",
      "Diagnostics: if the App crashes, a short error message and stack trace may be sent to help us fix bugs. Advertising data: the free tier is ad-supported. Google AdMob may collect device and usage identifiers to serve and measure ads, subject to its own privacy policy and your platform consent choices.",
    ],
  },
  {
    heading: "How we use information",
    body: [
      "To run the service (sign you in, stream video, resume playback), to take and confirm payments, to show and measure ads on the free plan, to send notifications you enabled, and to detect abuse (rate limits, fraud, and policy enforcement).",
    ],
  },
  {
    heading: "Sharing",
    body: [
      "We use Supabase for hosting and database services and Backblaze B2 for media storage. Payments are processed by Paystack. Ads are served by Google AdMob. We do not sell your personal information. We may disclose information if required by law.",
    ],
  },
  {
    heading: "Retention and security",
    body: [
      "We keep account data while your account is active and for a short period after deletion requests. Access is limited to signed-in sessions and row-level security policies; media links are signed and expire.",
    ],
  },
  {
    heading: "Your rights",
    body: [
      "You can edit your display name in Profile, reset your password from Profile, disable notifications from Profile or your device settings, and ask us to delete your account and its data by contacting us. If you are in a region with data-protection rights (e.g. GDPR), you may also request access, correction, or portability.",
    ],
  },
  {
    heading: "Children",
    body: [
      "The App is intended for general audiences and is not directed at children under 13 (or the minimum age in your country). We do not knowingly collect data from children.",
    ],
  },
  {
    heading: "Changes and contact",
    body: [
      "We may update this policy as the App evolves; the “last updated” date shows the latest revision. Continued use after changes means you accept the revised policy. Contact us through the Profile screen for any questions.",
    ],
  },
];

export default function PrivacyPolicy() {
  return (
    <LegalScreen
      title="Privacy Policy"
      updated="9 October 2026"
      intro="This policy describes how ruxx stream handles your data — plainly, with no hidden sharing."
      sections={SECTIONS}
    />
  );
}
