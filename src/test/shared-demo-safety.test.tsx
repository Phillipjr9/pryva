import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { renderToStaticMarkup } from "react-dom/server";
import { SettingsForm } from "@/app/dashboard/settings/SettingsForm";
import { ContactForm } from "@/components/site/ContactForm";
import type { PublicUser } from "@/lib/auth";

const mocks = vi.hoisted(() => ({ user: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: mocks.user, requireAuthApi: mocks.user, requireUser: mocks.user, SESSION_COOKIE: "session", SESSION_COOKIE_EMBEDDED: "session-3p" }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

let sessions: typeof import("@/app/api/user/sessions/route");
let password: typeof import("@/app/api/user/password/route");
let profile: typeof import("@/app/api/user/profile/route");
let SecurityPage: typeof import("@/app/dashboard/security/page").default;
let policy: typeof import("@/lib/demo-policy");

const user = { id: "demo-user", name: "Demo User", email: "demo@pryva.ng", walletBalance: 5000, createdAt: new Date("2026-01-01"), role: "user" } as PublicUser;
function request(path: string, method: string, body?: unknown) {
  return new NextRequest(`https://pryva.test${path}`, { method, headers: { origin: "https://pryva.test", "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
}

beforeAll(async () => {
  [sessions, password, profile, { default: SecurityPage }, policy] = await Promise.all([
    import("@/app/api/user/sessions/route"), import("@/app/api/user/password/route"), import("@/app/api/user/profile/route"),
    import("@/app/dashboard/security/page"), import("@/lib/demo-policy"),
  ]);
});
beforeEach(() => { vi.stubEnv("DATABASE_URL", ""); mocks.user.mockResolvedValue(user); });

describe("shared demo privacy", () => {
  it("does not allow one visitor to view or revoke other visitors' sessions or change the shared profile and password", async () => {
    expect((await sessions.GET(request("/api/user/sessions", "GET"))).status).toBe(403);
    expect((await sessions.DELETE(request("/api/user/sessions", "DELETE", { revokeAll: true }))).status).toBe(403);
    expect((await password.POST(request("/api/user/password", "POST", { currentPassword: "old", newPassword: "new" }))).status).toBe(403);
    expect((await profile.PUT(request("/api/user/profile", "PUT", { name: "Changed" }))).status).toBe(403);
    expect(policy.isSharedPreviewUser(user)).toBe(true);
    vi.stubEnv("DATABASE_URL", "postgres://live.test/db");
    expect(policy.isSharedPreviewUser(user)).toBe(false);
  });

  it("makes shared settings and support clearly fictional without prompting for passwords or email", async () => {
    const settings = renderToStaticMarkup(<SettingsForm user={user} sharedDemo />);
    expect(settings).toContain("Changes stay in this view only");
    expect(settings).toContain("No password is needed");
    expect(settings).not.toContain('type="password"');
    const security = renderToStaticMarkup(await SecurityPage());
    expect(security).toContain("Your demo session");
    expect(security).not.toContain("Not yet available");
    expect(security).not.toContain("Active sessions");
    const support = renderToStaticMarkup(<ContactForm defaultName="Demo Visitor" defaultEmail="demo@example.test" signedIn preview />);
    expect(support).toContain("does not reach support");
    expect(support).toContain("Save demo message");
    expect(support).not.toContain('type="email"');
  });
});
