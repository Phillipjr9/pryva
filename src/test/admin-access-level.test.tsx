import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { AccessLevel } from "@/app/admin/users/AccessLevel";

/**
 * The access label on /admin/users.
 *
 * Two facts decide administrator access -- the allowlist and a verified address --
 * and only one of them is visible in the email column. A row that reads plainly
 * "customer" while the address is allowlisted but unverified is the state that
 * caused an operator to conclude the setting was broken.
 */

beforeEach(() => {
  process.env.ADMIN_EMAILS = "owner@pryva.test";
});

afterEach(() => {
  delete process.env.ADMIN_EMAILS;
});

const render = (email: string, emailVerifiedAt: Date | string | null) =>
  renderToStaticMarkup(<AccessLevel email={email} emailVerifiedAt={emailVerifiedAt} />);

describe("the account access label", () => {
  it("marks an allowlisted, verified account as an administrator", () => {
    expect(render("owner@pryva.test", new Date("2026-10-31T12:00:00Z"))).toContain("Administrator");
  });

  it("distinguishes allowlisted-but-unverified from an ordinary customer", () => {
    const unverified = render("OWNER@pryva.test", null);
    expect(unverified).toContain("Admin · email unverified");
    expect(unverified).not.toContain(">Administrator<");
  });

  it("labels everyone else as a customer", () => {
    const customer = render("someone@example.test", new Date("2026-10-31T12:00:00Z"));
    expect(customer).toContain("Customer");
    expect(customer).not.toContain("Admin");
  });

  it("does not treat a verified address as privileged just because it is verified", () => {
    // Verification is proof of a mailbox, not a promotion.
    expect(render("someone@example.test", new Date())).not.toContain("Administrator");
  });
});
