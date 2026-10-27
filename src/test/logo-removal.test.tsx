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

  it("uses generic category art rather than third-party product logos", () => {
    for (const service of ["netflix", "spotify", "youtube", "disney", "chatgpt", "canva"] as const) {
      expect(existsSync(`public/images/services/${service}.png`)).toBe(false);
      const html = decodeURIComponent(renderToStaticMarkup(<ServiceIcon service={service} />));
      expect(html).not.toContain(`/images/services/${service}.png`);
      expect(html).toContain("/images/categories/");
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
