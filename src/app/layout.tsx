/* eslint-disable @next/next/no-page-custom-font -- fonts are loaded once in the shared App Router root layout. */
import type { Metadata } from "next";
import type { ReactNode } from "react";
import Script from "next/script";
import "./globals.css";
import { ToastProvider } from "@/components/ui/Toast";
import { BUILD_GUARD_SCRIPT_ID, BUILD_ID, staleBuildScript } from "@/lib/build-id";

export const metadata: Metadata = {
  metadataBase: new URL("https://pryva.ng"),
  title: {
    default: "Pryva — Virtual numbers, eSIMs and proxies for Nigeria",
    template: "%s · Pryva",
  },
  description:
    "Pryva is Nigeria's calm, reliable way to buy and rent virtual numbers, eSIM data, residential proxies and temporary email OTP. Pay in Naira. Instant delivery. Auto-refund if a code doesn't arrive.",
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

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@300;400;500;600;700;800&family=Instrument+Serif:ital@0;1&display=swap"
        />
        <meta name="theme-color" content="#faf7f1" />
        <noscript>
          <style>{`.reveal{opacity:1 !important;transform:none !important}`}</style>
        </noscript>
        {/*
          `next/script` with beforeInteractive — not a raw script element. React
          never executes a script tag it renders on the client (and warns about
          it); this one is placed in the server HTML and run by the Next runtime
          before hydration. Running *before* hydration is the whole point: a tab
          left open across a deploy reloads instead of reporting a mismatch it
          cannot otherwise fix.
        */}
        <Script id={BUILD_GUARD_SCRIPT_ID} strategy="beforeInteractive">
          {staleBuildScript(BUILD_ID)}
        </Script>
      </head>
      <body className="min-h-screen bg-cream text-ink antialiased">
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
