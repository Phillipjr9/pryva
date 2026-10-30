import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
// Self-hosted webfonts, imported per weight so the build ships only the cuts
// the design actually uses. These replace the two <link> tags to
// fonts.googleapis.com that used to sit in <head>: that stylesheet was a
// third-party request on the critical path, and it was the only reason the
// Content-Security-Policy had to allow Google's style and font hosts.
// Each @fontsource file declares its own `unicode-range`, so a browser fetches
// latin, plus latin-ext only when a glyph like the naira sign (U+20A6) appears.
import "@fontsource/plus-jakarta-sans/300.css";
import "@fontsource/plus-jakarta-sans/400.css";
import "@fontsource/plus-jakarta-sans/500.css";
import "@fontsource/plus-jakarta-sans/600.css";
import "@fontsource/plus-jakarta-sans/700.css";
import "@fontsource/plus-jakarta-sans/800.css";
import "@fontsource/instrument-serif/400.css";
import "@fontsource/instrument-serif/400-italic.css";
import "./globals.css";
import { ToastProvider } from "@/components/ui/Toast";
import { BUILD_ID } from "@/lib/build-id";
import { BuildGuard } from "@/components/system/BuildGuard";
import { ServiceWorkerRegistration } from "@/components/system/ServiceWorkerRegistration";
import { serializeStructuredData, siteStructuredData } from "@/lib/structured-data";

export const metadata: Metadata = {
  metadataBase: new URL("https://pryva.ng"),
  title: {
    default: "Pryva — Virtual numbers, eSIMs and proxies for Nigeria",
    template: "%s · Pryva",
  },
  description:
    "Explore Pryva plans for virtual numbers, eSIM data, residential proxies and temporary email OTP, priced in Naira.",
  keywords: [
    "virtual numbers Nigeria",
    "OTP verification Nigeria",
    "buy eSIM Nigeria",
    "residential proxies Nigeria",
    "temporary email OTP",
    "pay with Naira",
  ],
  openGraph: {
    title: "Pryva — Virtual numbers, eSIMs and proxies for Nigeria",
    description:
      "Virtual numbers, eSIMs, residential proxies, email OTP and digital accounts. Naira payments, instant delivery and built-in refunds.",
    url: "/",
    type: "website",
    locale: "en_NG",
    siteName: "Pryva",
    images: [
      {
        url: "/og.png",
        width: 1200,
        height: 630,
        alt: "Pryva — numbers, eSIMs and proxies, priced in Naira",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Pryva — Virtual numbers, eSIMs and proxies for Nigeria",
    description:
      "Nigeria's calm way to buy virtual numbers, eSIMs, proxies, inboxes and accounts — in Naira.",
    images: ["/og.png"],
  },
};

/**
 * Declared explicitly rather than relying on Next's default.
 *
 * `width=device-width, initial-scale=1` is what makes a phone lay the page out
 * at its own width instead of a 980px desktop viewport. `viewport-fit=cover`
 * lets the dashboard's bottom tab bar sit against the home indicator, and
 * `colorScheme: "light"` stops iOS drawing dark form controls on a light page.
 *
 * `maximumScale` and `userScalable: false` are deliberately absent: pinch-zoom
 * has to keep working, and turning it off is the usual way a "fix" for small
 * text makes the page unusable for anyone who needs it.
 */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#faf7f1",
  colorScheme: "light",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <script
          type="application/ld+json"
          // Static, authored in @/lib/structured-data — not user input.
          dangerouslySetInnerHTML={{ __html: serializeStructuredData(siteStructuredData) }}
        />
        <noscript>
          <style>{`.reveal{opacity:1 !important;transform:none !important}`}</style>
        </noscript>
      </head>
      <body className="min-h-screen bg-cream text-ink antialiased">
        <BuildGuard buildId={BUILD_ID} />
        <ServiceWorkerRegistration />
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
