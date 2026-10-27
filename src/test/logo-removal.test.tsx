import React from "react";
import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { AuthForm } from "@/components/auth/AuthForm";
import { ServiceIcon } from "@/components/ServiceIcon";
import { SiteFooter } from "@/components/site/SiteFooter";
import NotFound from "@/app/not-found";
import {
  giftCardEmail,
  orderConfirmationEmail,
  passwordResetEmail,
  refundEmail,
  walletTopupEmail,
  welcomeEmail,
} from "@/lib/email-templates";

describe("logo-free presentation", () => {
  it("removes the site's logo component, image, and favicon", () => {
    expect(existsSync("public/pryva-logo.png")).toBe(false);
    expect(existsSync("src/app/icon.svg")).toBe(false);
    expect(existsSync("src/components/brand/Logo.tsx")).toBe(false);
    expect(existsSync("src/components/brand/BrandMark.tsx")).toBe(false);
    expect(renderToStaticMarkup(<SiteFooter />)).not.toContain("pryva-logo.png");
    expect(renderToStaticMarkup(<NotFound />)).not.toContain("pryva-logo.png");
  });

  it("keeps Google sign-in available without a logo", () => {
    const html = renderToStaticMarkup(<AuthForm mode="login" next="/dashboard" />);
    const googleLink = html.match(/<a[^>]*href="\/api\/auth\/google[^>]*>[\s\S]*?<\/a>/)?.[0];
    expect(googleLink).toContain("Continue with Google");
    expect(googleLink).not.toMatch(/<svg|<img/);
  });

  it("gives every digital service its real brand mark", () => {
    // Third-party products show their official logo now, not generated art.
    // What must stay true: each product renders its OWN mark (no sharing), the
    // mark is drawn SVG (no bitmap), and the accessible name matches the brand.
    const names: Record<string, string> = {
      netflix: "Netflix",
      spotify: "Spotify",
      youtube: "YouTube",
      disney: "Disney+",
      chatgpt: "ChatGPT",
      canva: "Canva",
    };

    const seen = new Set<string>();

    for (const service of ["netflix", "spotify", "youtube", "disney", "chatgpt", "canva"] as const) {
      const html = renderToStaticMarkup(<ServiceIcon service={service} />);
      expect(html).toContain(`aria-label="${names[service]}"`);
      // No leftover generated artwork for products that have a real logo.
      expect(html).not.toContain(`/images/services/${service}.png`);

      const shape = html.slice(html.indexOf("<g"), html.lastIndexOf("</g>") + 4) || html;
      seen.add(shape);
    }

    expect(seen.size).toBe(6);
  });

  it("keeps Pryva's own catalogue on its original artwork", () => {
    // There is no official logo for "virtual numbers" — those keep the 3D set.
    for (const service of ["numbers", "esim", "proxies", "email-otp", "data", "gift-cards"] as const) {
      const html = decodeURIComponent(renderToStaticMarkup(<ServiceIcon service={service} />));
      expect(html).toContain(`/images/services/`);
      expect(existsSync(`public/images/services/${service === "numbers" ? "virtual-numbers" : service}.png`)).toBe(true);
    }
  });

  it("removes the logo from every email template", () => {
    const templates = [
      welcomeEmail("Ada"),
      orderConfirmationEmail({ reference: "R1", productName: "Number", amount: 1000, service: "numbers" }),
      walletTopupEmail(1000, 1000, "T1"),
      giftCardEmail({ code: "CODE", amount: 1000, senderName: "Ada" }),
      refundEmail({ reference: "R1", productName: "Number", amount: 1000, reason: "Cancelled" }),
      passwordResetEmail("Ada", "https://pryva.ng/reset"),
    ];
    for (const template of templates) {
      expect(template.html).not.toContain("pryva-logo.png");
      expect(template.html).not.toContain("logoUrl");
    }
  });
});
