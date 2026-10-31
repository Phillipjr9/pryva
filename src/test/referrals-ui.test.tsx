// @vitest-environment jsdom
import React from "react";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { ReferralProgram } from "@/app/dashboard/referrals/ReferralProgram";
import { AuthForm } from "@/components/auth/AuthForm";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
}));

const read = (path: string) => readFileSync(path, "utf8");
const page = read("src/app/dashboard/referrals/page.tsx");
const api = read("src/app/api/referrals/route.ts");
const shell = read("src/components/dashboard/DashboardShell.tsx");
const signupPage = read("src/app/(auth)/signup/page.tsx");
const authForm = read("src/components/auth/AuthForm.tsx");

const base = {
  code: "ABC23DEF",
  link: "https://pryva.ng/signup?ref=ABC23DEF",
  earned: 500,
  invited: 2,
  pending: 1,
  percent: 5,
  capNgn: 2_000,
  invites: [
    { id: "a", code: "ABC23DEF", status: "credited", rewardAmount: 500, createdAt: "2026-10-01T10:00:00.000Z", creditedAt: "2026-10-02T10:00:00.000Z", refereeLabel: "b•••@example.com" },
    { id: "b", code: "ABC23DEF", status: "pending", rewardAmount: null, createdAt: "2026-10-03T10:00:00.000Z", creditedAt: null, refereeLabel: "c•••@example.com" },
  ],
};

const html = (renderToStaticMarkup(<ReferralProgram {...base} />));

/**
 * The invite page.
 *
 * A referral link is only worth anything if a customer can find it, copy it, and
 * understand exactly when it pays — so the page has to state the offer in the
 * same terms the code implements: 5%, capped, after a delivered first order,
 * once per friend.
 */
describe("the referral page", () => {
  it("shows the link and the code, both copyable", () => {
    expect(html).toContain("https://pryva.ng/signup?ref=ABC23DEF");
    expect(html).toContain(">ABC23DEF<");
    expect(html).toContain("Copy link");
    expect(html).toContain("select-all");
  });

  it("states the offer exactly as the code applies it", () => {
    expect(html).toContain("5%");
    expect(html).toContain("₦2,000");
    expect(html).toContain("first order is delivered");
    expect(html).toContain("Once per friend");
    expect(html).toContain("does not earn a reward");
    expect(html).toContain("not cashable");
  });

  it("shows who joined, masked, with the state of each reward", () => {
    expect(html).toContain("b•••@example.com");
    expect(html).toContain("c•••@example.com");
    expect(html).toContain("+₦500");
    expect(html).toContain("Waiting for their first order");
    expect(html).toContain("Paid");
  });

  it("never leaks a full address, a provider name or a cost", () => {
    expect(html).not.toContain("bola@example.com");
    for (const word of ["supplier", "reseller", "wholesale", "upstream", "vendor"]) {
      expect(html.toLowerCase()).not.toContain(word);
    }
  });

  it("explains the empty state instead of showing a blank list", () => {
    const empty = (renderToStaticMarkup(<ReferralProgram {...base} invites={[]} invited={0} pending={0} earned={0} />));
    expect(empty).toContain("Nobody yet");
    expect(empty).toContain("₦0");
  });

  it("says so when a code cannot be minted, rather than showing a broken link", () => {
    const broken = (renderToStaticMarkup(<ReferralProgram {...base} code={null} link={null} />));
    expect(broken).toContain("Invite codes are unavailable right now");
    expect(broken).not.toContain("signup?ref=");
  });
});

describe("the wiring behind it", () => {
  it("is a page inside the dashboard, for the signed-in account", () => {
    expect(page).toContain('requireUser("/dashboard/referrals")');
    expect(page).toContain("referralOverview(user.id)");
    expect(page).toContain("<ReferralProgram");
  });

  it("is reachable from the dashboard nav", () => {
    expect(shell).toContain('{ href: "/dashboard/referrals", label: "Refer & earn", nav: "referrals" }');
  });

  it("serves the code and the stats over an authenticated, uncached API", () => {
    expect(api).toContain("requireAuthApi");
    expect(api).toContain("referralOverview(user.id)");
    expect(api).toContain('"Cache-Control": "no-store"');
  });

  it("carries ?ref= through the signup form, and remembers it in a cookie", () => {
    expect(signupPage).toContain("normalizeReferralCode(ref)");
    expect(signupPage).toContain("refCode=");
    expect(authForm).toContain("document.cookie");
    expect(authForm).toContain("REFERRAL_COOKIE");
    expect(authForm).toContain("ref: invite ?? undefined");
    // A passkey or password login is not a signup and must not carry a code.
    expect(authForm).toContain('const invite = mode === "signup" ? normalizeReferralCode(refCode) : null;');
  });

  it("keeps the invite code out of the sign-up markup", () => {
    // The code travels in the request body and the cookie, not in HTML that a
    // shared screenshot would show.
    const signup = decodeURIComponent(
      renderToStaticMarkup(<AuthForm mode="signup" next="/dashboard" refCode="ABC23DEF" />),
    );
    expect(signup).not.toContain("ABC23DEF");
    expect(signup).toContain("Create your account");
  });
});
