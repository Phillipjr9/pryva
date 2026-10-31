// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

/**
 * The confirmation the button never gave.
 *
 * Reported: "when user click email me a link to verify there email nothing shows
 * as confirmation". The page checked `!token` first, so the intro block rendered
 * whatever the request did — the success and failure branches were unreachable
 * without a token in the URL, which is exactly the state of somebody pressing
 * that button. These tests press it.
 */

const nav = vi.hoisted(() => ({ params: new URLSearchParams() }));

vi.mock("next/navigation", () => ({
  useSearchParams: () => nav.params,
}));

import VerifyEmailPage from "@/app/(auth)/verify-email/page";

function jsonResponse(body: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

beforeEach(() => {
  nav.params = new URLSearchParams();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function pressEmailButton() {
  render(<VerifyEmailPage />);
  fireEvent.click(screen.getByRole("button", { name: /email me a link/i }));
}

describe("pressing 'Email me a link'", () => {
  it("confirms that a link was sent", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true, delivered: true }));
    vi.stubGlobal("fetch", fetchMock);

    pressEmailButton();

    await waitFor(() => expect(screen.getByText("Link sent")).toBeTruthy());
    expect(screen.getByText(/check your inbox/i)).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith("/api/auth/verify-email", { method: "POST" });
  });

  it("shows the server's reason when the mail was refused, instead of silence", async () => {
    const message = "A new link was created, but the mail service refused the message (403).";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ error: message }, 502)));

    pressEmailButton();

    await waitFor(() => expect(screen.getByText("We could not send that email")).toBeTruthy());
    expect(screen.getByText(message)).toBeTruthy();
  });

  it("tells a signed-out visitor to sign in rather than pretending to fail", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ error: "Unauthorized" }, 401)));

    pressEmailButton();

    await waitFor(() => expect(screen.getByText("Sign in to get a link")).toBeTruthy());
    const signIn = screen.getByRole("link", { name: "Sign in" });
    expect(signIn.getAttribute("href")).toBe("/login?next=%2Fverify-email");
  });

  it("does not loop on 'Try again' after a signed-out failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ error: "Unauthorized" }, 401)));

    pressEmailButton();

    await waitFor(() => expect(screen.getByText("Sign in to get a link")).toBeTruthy());
    expect(screen.queryByRole("button", { name: /try again/i })).toBeNull();
  });
});

describe("following a link", () => {
  it("confirms the address when the token works", async () => {
    nav.params = new URLSearchParams("token=abc");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ ok: true })));

    render(<VerifyEmailPage />);

    await waitFor(() => expect(screen.getByText("Email confirmed")).toBeTruthy());
  });

  it("explains a dead link and offers a new one", async () => {
    nav.params = new URLSearchParams("token=dead");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ error: "That link is no longer valid." }, 400)),
    );

    render(<VerifyEmailPage />);

    await waitFor(() => expect(screen.getByText("That link did not work")).toBeTruthy());
    expect(screen.getByRole("button", { name: /send a new link/i })).toBeTruthy();
  });

  it("turns a dead link into a confirmation once a new link is sent", async () => {
    nav.params = new URLSearchParams("token=dead");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ error: "expired" }, 400))
      .mockResolvedValueOnce(jsonResponse({ ok: true, delivered: true }));
    vi.stubGlobal("fetch", fetchMock);

    render(<VerifyEmailPage />);
    await waitFor(() => expect(screen.getByText("That link did not work")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: /send a new link/i }));

    await waitFor(() => expect(screen.getByText("Link sent")).toBeTruthy());
  });
});
