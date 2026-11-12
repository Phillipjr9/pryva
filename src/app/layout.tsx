import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Analytics } from "@vercel/analytics/next";
// One self-hosted variable font covers Jakarta's full weight range. The browser
// loads only the character subsets it needs (including latin-ext for ₦).
import "@fontsource-variable/plus-jakarta-sans";
import "@fontsource/instrument-serif/400.css";
import "@fontsource/instrument-serif/400-italic.css";
import "./globals.css";
import { ToastProvider } from "@/components/ui/Toast";
import { BUILD_ID } from "@/lib/platform/build-id";
import { BuildGuard } from "@/components/system/BuildGuard";
import { ServiceWorkerRegistration } from "@/components/system/ServiceWorkerRegistration";
import { SupportFloatButton } from "@/components/site/SupportFloatButton";
import { serializeStructuredData, siteStructuredData } from "@/lib/content/structured-data";
import { canonicalSiteUrl } from "@/lib/platform/net";

export const metadata: Metadata = {
  metadataBase: new URL(canonicalSiteUrl()),
  alternates: { canonical: "/" },
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
    "Pryva",
  ],
  applicationName: "Pryva",
  authors: [{ name: "Pryva" }],
  creator: "Pryva",
  publisher: "Pryva",
  category: "technology",
  classification: "Business and consumer services",
  robots: { index: true, follow: true, googleBot: { index: true, follow: true } },
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
        <SupportFloatButton />
        <Analytics />
      </body>
    </html>
  );
}
