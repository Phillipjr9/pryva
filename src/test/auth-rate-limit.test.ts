import { describe, expect, it } from "vitest";
import { checkAuthRateLimit, clientIp, clearAuthRateLimit } from "@/lib/auth-rate-limit";

function request(ip: string) {
  return new Request("http://localhost/api/auth/login", {
    method: "POST",
    headers: { "x-forwarded-for": `${ip}, 10.0.0.1` },
  });
}

describe("login throttling", () => {
  it("reads the first address from x-forwarded-for", () => {
    expect(clientIp(request("203.0.113.9"))).toBe("203.0.113.9");
  });

  it("blocks an account after five failed attempts and reports Retry-After", async () => {
    const req = request("198.51.100.1");
    const email = "throttle-1@example.com";

    for (let attempt = 1; attempt <= 5; attempt++) {
      await expect(checkAuthRateLimit(req, "login", email)).resolves.toBeNull();
    }

    const blocked = await checkAuthRateLimit(req, "login", email);
    expect(blocked).toBeInstanceOf(Response);
    expect(blocked?.status).toBe(429);
    expect(Number(blocked?.headers.get("Retry-After"))).toBeGreaterThan(0);
    const body = (await blocked?.json()) as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(body.error).toMatch(/too many sign-in attempts/i);
  });

  it("keeps separate budgets per account on the same connection", async () => {
    const req = request("198.51.100.2");
    for (let attempt = 1; attempt <= 5; attempt++) {
      await checkAuthRateLimit(req, "login", "throttle-2@example.com");
    }
    expect((await checkAuthRateLimit(req, "login", "throttle-2@example.com"))?.status).toBe(429);
    // A different account from the same IP is still allowed (IP bucket has headroom).
    await expect(checkAuthRateLimit(req, "login", "throttle-3@example.com")).resolves.toBeNull();
  });

  it("clears the budget after a successful sign-in", async () => {
    const req = request("198.51.100.3");
    const email = "throttle-4@example.com";
    for (let attempt = 1; attempt <= 5; attempt++) {
      await checkAuthRateLimit(req, "login", email);
    }
    expect((await checkAuthRateLimit(req, "login", email))?.status).toBe(429);

    clearAuthRateLimit(req, email);
    await expect(checkAuthRateLimit(req, "login", email)).resolves.toBeNull();
  });

  it("caps signup creation per connection", async () => {
    const req = request("198.51.100.4");
    let blocked: Response | null = null;
    for (let attempt = 1; attempt <= 11; attempt++) {
      blocked = await checkAuthRateLimit(req, "signup", `new-${attempt}@example.com`);
      if (blocked) break;
    }
    expect(blocked?.status).toBe(429);
  });
});
