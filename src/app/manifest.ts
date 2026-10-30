import type { MetadataRoute } from "next";

/**
 * The installable identity of the app.
 *
 * Kept in code rather than `public/manifest.json` so the name and description
 * cannot drift from the site metadata, and so a type error catches a malformed
 * icon list before a browser silently refuses to install the app.
 *
 * `display: "standalone"` is deliberate: Pryva is a wallet, and a wallet in a
 * browser tab with an address bar invites mistyped URLs. It is still the same
 * web app — no offline purchases, no background sync, no push.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Pryva",
    short_name: "Pryva",
    description:
      "Virtual numbers, eSIM data, residential proxies and temporary email OTP, priced in Naira.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#faf7f1",
    theme_color: "#faf7f1",
    lang: "en-NG",
    dir: "ltr",
    categories: ["shopping", "finance"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
