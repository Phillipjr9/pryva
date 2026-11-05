import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { operatorHomeFor } from "@/lib/operator";
import { previewOperatorBootstrapEnabled } from "@/lib/preview-operator";

/**
 * The operator's separate door.
 *
 * Two things are easy to get wrong here and both are security-relevant:
 *
 *   1. The door decides where to *send* you, never what you may do. If `/admin`
 *      ever trusted the door instead of re-checking the account, signing in at
 *      `/admin/login` would be the whole authorisation.
 *   2. The preview bootstrap exists so an operator can reach the console on an
 *      in-memory preview. If it survived into a deployment with a real database,
 *      it would create a pre-verified account for any `ADMIN_EMAILS` address from
 *      the public signup form.
 */

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (path: string) => readFileSync(join(root, path), "utf8");

const admin = { emailVerifiedAt: new Date(), email: "ops@example.com" } as never;
const customer = { emailVerifiedAt: new Date(), email: "someone@example.com" } as never;
const unverifiedAdmin = { emailVerifiedAt: null, email: "ops@example.com" } as never;

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("where a sign-in lands", () => {
  it("sends an administrator to the console and a customer to the storefront", () => {
    vi.stubEnv("ADMIN_EMAILS", "ops@example.com");
    expect(operatorHomeFor(admin)).toBe("/admin");
    expect(operatorHomeFor(customer)).toBe("/dashboard");
  });

  it("treats an unverified administrator address as a customer", () => {
    // The address matches, but control of the mailbox was never proven. This is
    // the whole reason `isAdminUser` checks the timestamp.
    vi.stubEnv("ADMIN_EMAILS", "ops@example.com");
    expect(operatorHomeFor(unverifiedAdmin)).toBe("/dashboard");
  });

  it("refuses to invent an operator when no list is configured", () => {
    vi.stubEnv("ADMIN_EMAILS", "");
    expect(operatorHomeFor(admin)).toBe("/dashboard");
    expect(operatorHomeFor(null)).toBe("/dashboard");
  });
});

describe("the console door does not authorise anything", () => {
  it("keeps the real check inside the console layout", () => {
    const layout = read("app/admin/(console)/layout.tsx");
    expect(layout).toContain("await requireAdmin()");
  });

  it("sends a signed-out console visitor to the operator door, not the storefront", () => {
    const auth = read("lib/auth.ts");
    expect(auth).toContain('redirect(`/admin/login?next=');
  });

  it("keeps the 2FA requirement inside the console", () => {
    // Bouncing an operator into /dashboard to arm the console is the split
    // personality this separation exists to remove.
    const auth = read("lib/auth.ts");
    expect(auth).toContain("/admin/account?require=2fa");
    expect(auth).not.toContain("/dashboard/settings?require=2fa");
  });

  it("re-checks the account on the console home rather than trusting the door", () => {
    const home = read("app/admin/(console)/page.tsx");
    expect(home).toContain('await requireAdmin("/admin")');
  });

  it("leaves the login page outside the guarded layout, so it cannot loop", () => {
    // `(console)/layout.tsx` runs `requireAdmin`, which redirects a signed-out
    // visitor to `/login`. If the door lived under it, the door itself would need
    // a session before it could ask for one.
    const door = read("app/admin/login/page.tsx");
    expect(door).not.toContain("await requireAdmin(");
    expect(door).toContain("getCurrentUser");
  });

  it("sends a signed-in customer away instead of showing them a form they cannot use", () => {
    const door = read("app/admin/login/page.tsx");
    expect(door).toContain('redirect("/admin/login?denied=1")');
    expect(door).toContain("if (isAdminUser(user)) redirect(target)");
  });

  it("only honours a next destination inside the console", () => {
    const door = read("app/admin/login/page.tsx");
    // An operator sign-in must not become an open redirect to the storefront.
    expect(door).toContain('path === "/admin" || path.startsWith("/admin/")');
  });

  it("stays out of search results", () => {
    const door = read("app/admin/login/page.tsx");
    expect(door).toContain("robots: { index: false, follow: false }");
  });
});

describe("the preview operator bootstrap", () => {
  it("turns on only with the flag on an in-memory database", () => {
    // The positive case, so the two refusals below mean something: a predicate
    // that always returned false would satisfy them without ever working.
    vi.stubEnv("PREVIEW_OPERATOR", "1");
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("PGHOST", "");
    vi.stubEnv("PGUSER", "");
    vi.stubEnv("AWS_REGION", "");
    vi.stubEnv("AWS_ROLE_ARN", "");
    expect(previewOperatorBootstrapEnabled()).toBe(true);
  });

  it("is off when the flag is absent, even on an in-memory database", () => {
    vi.stubEnv("PREVIEW_OPERATOR", "");
    expect(previewOperatorBootstrapEnabled()).toBe(false);
  });

  it("is off when the flag is present but a real database is configured", () => {
    vi.stubEnv("PREVIEW_OPERATOR", "1");
    vi.stubEnv("DATABASE_URL", "postgres://example.invalid/pryva");
    // A deployment pointed at Postgres must never mint a pre-verified account.
    // This is the lock that matters: the flag alone is not enough.
    expect(previewOperatorBootstrapEnabled()).toBe(false);
  });

  it("still does not widen administrator identity", () => {
    // The bootstrap only lets a listed address be created; `isAdminUser` remains
    // the gate, so the list stays the single source of truth.
    const signup = read("app/api/auth/signup/route.ts");
    expect(signup).toContain("isConfiguredAdminEmail(email)");
    expect(signup).toContain("previewOperatorBootstrapEnabled()");
  });
});

describe("the console is its own place", () => {
  it("does not render the customer shell", () => {
    const layout = read("app/admin/(console)/layout.tsx");
    expect(layout).not.toContain("DashboardShell");
  });

  it("keeps the operator out of the storefront entirely", () => {
    // "Fully exclusive" has to mean both halves: the console does not render the
    // customer shell, and the customer shell does not render for an operator.
    // The second half is what stops an operator approving a withdrawal in one
    // tab and shopping from a wallet balance in the next.
    const dashboard = read("app/dashboard/layout.tsx");
    expect(dashboard).toContain('if (isAdminUser(user)) redirect("/admin")');
    expect(dashboard).not.toContain("isAdmin={");
  });

  it("documents the way in, not just the way around", () => {
    // The console is unreachable unless three things line up, and an operator
    // who cannot get in on a Friday night will read the runbook, not the source.
    const runbook = readFileSync(join(root, "../OPERATIONS.txt"), "utf8");
    expect(runbook).toContain("2. Signing in as an operator");
    expect(runbook).toContain("/admin/login");
    // The two silent traps: set ADMIN_EMAILS before the account is verified and
    // there is no account to verify; require 2FA before enrolling and the only
    // operator is locked out.
    expect(runbook).toContain("Set ADMIN_EMAILS after the account exists and is verified");
    expect(runbook).toContain("ADMIN_2FA_REQUIRED");

    const env = readFileSync(join(root, "../.env.example"), "utf8");
    expect(env).toContain("ADMIN_EMAILS");
    expect(env).toContain("necessarily but not sufficient".replace("necessarily but", "necessary but"));
  });

  it("keeps every console section reachable from one nav", () => {
    const nav = read("app/admin/(console)/OperatorNav.tsx");
    for (const href of [
      "/admin",
      "/admin/orders",
      "/admin/withdrawals",
      "/admin/payout-names",
      "/admin/transactions",
      "/admin/reconciliation",
      "/admin/security",
      "/admin/audit",
    ]) {
      expect(nav, `${href} should be in the operator nav`).toContain(`href: "${href}"`);
    }
  });
});
