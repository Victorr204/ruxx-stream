import { ScrollViewStyleReset } from "expo-router/html";
import type { PropsWithChildren } from "react";
import { ADSENSE_CLIENT } from "../src/lib/adsense";

export default function Root({ children }: PropsWithChildren) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no" />
        <title>ruxx stream</title>
        <meta name="description" content="Stream movies — ad-free with Premium, offline downloads, subtitles." />
        <ScrollViewStyleReset />
        <link rel="icon" href="/favicon.ico" />
        <link rel="manifest" href="/manifest.json" />
        <meta name="theme-color" content="#050505" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="ruxx stream" />
        <link rel="apple-touch-icon" href="/icon-512.png" />
        <script
          async
          src={`https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${ADSENSE_CLIENT}`}
          crossOrigin="anonymous"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
