import React from "react";
import { existsSync, statSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { AuthForm } from "@/components/auth/AuthForm";
import { ServiceIcon } from "@/components/ServiceIcon";
import { SiteFooter } from "@/components/site/SiteFooter";
import { BrandLockup, BrandMark } from "@/components/brand/BrandLockup";
import NotFound from "@/app/not-found";
import {
  emailVerificationEmail,
  giftCardEmail,
  orderConfirmationEmail,
  passwordResetEmail,
  refundEmail,
  walletTopupEmail,
  welcomeEmail,
} from "@/lib/email-templates";

/**
 * Brand presentation.
 *
 * History: this file used to assert the opposite — that Pryva had NO logo
 * (no `public/pryva-logo.png`, no `icon.svg`, no `<BrandLockup>` in the footer),
 * because an earlier pass removed a placeholder mark. The owner has since
 * supplied the real mark, so the tests now protect the new intent: the logo and
 * the "Pryva" name appear wherever the brand should, and the assets the app
 * points at actually exist.
 */
describe("brand presentation", () => {
  it("ships the mark, the favicon and the apple touch icon", () => {
    for (const file of [
      "public/images/brand/pryva-mark.png",
      "public/icon.png",
      "src/app/icon.png",
      "public/apple-icon.png",
    ]) {
      expect(existsSync(file), `${file} is missing`).toBe(true);
      expect(statSync(file).size).toBeGreaterThan(2000);
    }
  });

  it("renders the mark and the name in the lockup", () => {
    const html = decodeURIComponent(renderToStaticMarkup(<BrandLockup size="md" />));
    expect(html).toContain("/images/brand/pryva-mark.png");
    expect(html).toContain("Pryva");
    expect(html).toContain('aria-label="Pryva home"');

    const markOnly = decodeURIComponent(renderToStaticMarkup(<BrandMark size="sm" />));
    expect(markOnly).toContain("/images/brand/pryva-mark.png");
    // Decorative on its own — the wordmark carries the name.
    expect(markOnly).toContain('aria-hidden="true"');
  });

  it("puts the brand in the footer and on the 404 page", () => {
    expect(decodeURIComponent(renderToStaticMarkup(<SiteFooter />))).toContain("/images/brand/pryva-mark.png");
    expect(decodeURIComponent(renderToStaticMarkup(<NotFound />))).toContain("/images/brand/pryva-mark.png");
  });

  it("keeps Google sign-in working next to the brand", () => {
    const html = renderToStaticMarkup(<AuthForm mode="login" next="/dashboard" />);
    const googleLink = html.match(/<a[^>]*href="\/api\/auth\/google[^>]*>[\s\S]*?<\/a>/)?.[0];
    expect(googleLink).toContain("Continue with Google");
    // The Google button must keep Google's own mark, never ours.
    expect(googleLink).not.toContain("pryva-mark");
  });

  it("gives every digital service its real brand mark", () => {
    // Third-party products show their official logo, not generated art.
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
      expect(html).toContain("/images/services/");
      expect(
        existsSync(`public/images/services/${service === "numbers" ? "virtual-numbers" : service}.png`),
      ).toBe(true);
    }
  });

  it("puts the brand header in every email template", () => {
    const templates = [
      welcomeEmail("Ada"),
      orderConfirmationEmail({ reference: "R1", productName: "Number", amount: 1000, service: "numbers" }),
      walletTopupEmail(1000, 1000, "T1"),
      giftCardEmail({ code: "CODE", amount: 1000, senderName: "Ada" }),
      refundEmail({ reference: "R1", productName: "Number", amount: 1000, reason: "Cancelled" }),
      passwordResetEmail("Ada", "https://pryva.ng/reset"),
      emailVerificationEmail("Ada", "https://pryva.ng/verify-email?token=t"),
    ];
    for (const template of templates) {
      expect(template.html).toContain("pryva-mark.png");
      expect(template.html).toContain("Pryva");
    }
  });

  it("gives the auth emails the branded card, hero image and gradient bar", () => {
    // The visual identity of every other Pryva email: a 5px gradient header bar,
    // a hero image from /images/email, the rounded card and a CTA button. These
    // two routes were sending bare <p> tags while this template library sat
    // unused, so the assertions are on the rendered output rather than on intent.
    for (const template of [
      emailVerificationEmail("Ada", "https://pryva.ng/verify-email?token=t"),
      passwordResetEmail("Ada", "https://pryva.ng/reset"),
    ]) {
      expect(template.html).toContain("/images/email/hero-");
      expect(template.html).toContain("linear-gradient");
      expect(template.html).toContain("border-radius:18px");
      expect(template.html).toContain("DM Sans");
      expect(template.text.length).toBeGreaterThan(20);
    }
    // A host that is not attached to the deployment would 404 every image.
    expect(emailVerificationEmail("Ada", "https://x.test/v").html).not.toContain(
      'src="/images/email/',
    );
  });
});
