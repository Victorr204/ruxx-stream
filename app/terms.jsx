import LegalScreen from "../src/components/LegalScreen";

const SECTIONS = [
  {
    heading: "Agreement",
    body: [
      "By creating an account or using ruxx stream (the “App”), you agree to these Terms. If you do not agree, do not use the App.",
    ],
  },
  {
    heading: "Your account",
    body: [
      "You are responsible for keeping your credentials private and for activity under your account. You must be at least 13 years old (or the age of majority where you live) to use the App. One account is for one household — sharing credentials outside your subscription may result in limits.",
    ],
  },
  {
    heading: "Subscriptions and billing",
    body: [
      "Premium is a monthly subscription billed through Paystack in Nigerian Naira (₦1,500 + 7.5% VAT = ₦1,612.50/month; first month ₦1,075 incl. VAT for new subscribers). Subscriptions renew automatically each month until cancelled. Cancel any time from your Play Store / payment profile or by contacting us — access continues until the end of the paid period. Bank-transfer payments grant a 30-day window and are confirmed once funds clear.",
      "Prices include applicable VAT where required. Failed or reversed payments downgrade the account to the free plan.",
    ],
  },
  {
    heading: "Free tier and ads",
    body: [
      "The free plan is supported by advertising, including short pre-roll and mid-roll breaks. Ads are provided by third parties (Google AdMob) and their availability, content, and targeting are governed by those providers. Premium removes all ads.",
    ],
  },
  {
    heading: "Acceptable use",
    body: [
      "Do not: redistribute, record, screen-capture, or publicly perform content from the App; scrape the catalogue; interfere with the service or its security; upload or share unlawful, infringing, or hateful material; or use the App to harass others. We may suspend accounts that break these rules.",
    ],
  },
  {
    heading: "Content and licences",
    body: [
      "The films, artwork, and metadata in the App are licensed to us and remain the property of their rights holders. Your subscription grants you a personal, non-transferable, non-exclusive right to stream and (with Premium) temporarily download titles for offline viewing — never to copy or redistribute them.",
    ],
  },
  {
    heading: "Third-party services",
    body: [
      "The App relies on third parties (Supabase hosting, Backblaze B2 storage, Paystack payments, AdMob ads, Expo push). Their own terms apply to their services, and we are not responsible for their acts or omissions.",
    ],
  },
  {
    heading: "Disclaimers and liability",
    body: [
      "The App is provided “as is” without warranties of any kind, express or implied, including fitness for a particular purpose and uninterrupted availability. To the maximum extent permitted by law, our total liability for claims relating to the App is limited to the amount you paid us in the 12 months before the claim arose. Nothing in these Terms limits liability that cannot be limited by law.",
    ],
  },
  {
    heading: "Termination and changes",
    body: [
      "You may stop using the App at any time and request account deletion from Profile. We may suspend or terminate accounts that violate these Terms or required law. We may update these Terms as the App evolves; material changes will be highlighted in the App or by email. Continued use after an update means you accept the new Terms.",
    ],
  },
  {
    heading: "Governing law and contact",
    body: [
      "These Terms are governed by the laws of the Federal Republic of Nigeria. Disputes will be handled by the courts of competent jurisdiction in Nigeria. Questions about these Terms go through the Profile screen.",
    ],
  },
];

export default function TermsOfService() {
  return (
    <LegalScreen
      title="Terms of Service"
      updated="9 October 2026"
      intro="The ground rules for using ruxx stream — your subscription, our service, and what's fair for everyone."
      sections={SECTIONS}
    />
  );
}
