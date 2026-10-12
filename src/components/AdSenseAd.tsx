import type { CSSProperties } from "react";

// Native stub: AdSense only runs on web. Metro resolves AdSenseAd.web.tsx
// there instead of this file; the props mirror the web component so shared
// callers typecheck.
type Props = {
  slot: string;
  format?: string;
  minHeight?: number;
  style?: CSSProperties;
};

export default function AdSenseAd(_props: Props) {
  return null;
}
