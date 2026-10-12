import { useEffect, useRef } from "react";
import { ADSENSE_CLIENT, pushAdsenseAd } from "../lib/adsense";

type Props = {
  /** AdSense ad unit slot id (digits). Empty string renders nothing. */
  slot: string;
  /** AdSense format: "auto" (responsive), "rectangle", "horizontal", … */
  format?: string;
  minHeight?: number;
  style?: React.CSSProperties;
};

// One AdSense <ins> unit. The loader script is already in the document head
// (app/+html.tsx); the first mount of each instance queues it via push({}).
export default function AdSenseAd({ slot, format = "auto", minHeight = 90, style }: Props) {
  const pushed = useRef(false);

  useEffect(() => {
    if (pushed.current || !slot) return;
    pushed.current = true;
    pushAdsenseAd();
  }, [slot]);

  if (!slot) return null;

  return (
    <div style={{ minHeight, overflow: "hidden", width: "100%", ...style }}>
      <ins
        className="adsbygoogle"
        style={{ display: "block", width: "100%", ...(style ?? {}) }}
        data-ad-client={ADSENSE_CLIENT}
        data-ad-slot={slot}
        data-ad-format={format}
        data-full-width-responsive="true"
      />
    </div>
  );
}
