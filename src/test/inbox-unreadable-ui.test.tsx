// @vitest-environment jsdom
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { InboxManager } from "@/app/dashboard/inbox/InboxManager";

/**
 * "Nothing has arrived yet" is the sentence a customer waiting for a verification
 * code reads most, so it has to mean what it says.
 *
 * When the provider read fails, pollInbox falls back to what it already has and
 * the response is still ok:true. That fallback is reasonable -- but until now the
 * screen could not tell it apart from a successful check that found nothing, and
 * it went on claiming "send an email and it will appear here automatically" while
 * the inbox was unreachable. The list was not empty; it was unread.
 */

const ADDRESS = "someone@inbox.test";

function activeInbox() {
  return {
    id: "inbox-1",
    address: ADDRESS,
    tier: "free",
    status: "active",
    expiresAt: null,
    createdAt: "2026-11-01T00:00:00Z",
    discardedAt: null,
  };
}

function stubPoll(poll: Record<string, unknown>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      const body =
        url === "/api/inbox"
          ? { ok: true, configured: true, inboxes: [activeInbox()] }
          : { ok: true, inbox: activeInbox(), messages: [], code: null, stored: false, ...poll };
      return { ok: true, json: async () => body };
    }),
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("reading an inbox the provider is not answering", () => {
  it("says the inbox could not be reached instead of claiming it is empty", async () => {
    stubPoll({ messages: [], unreadable: true });
    render(<InboxManager />);

    const notice = await screen.findByRole("status");
    expect(notice.textContent).toMatch(/could not reach the inbox/i);
    // The promise is the defect: nothing can appear automatically while the read
    // is failing, and a customer who believes it stops watching.
    expect(screen.queryByText(/will appear here automatically/i)).toBeNull();
  });

  it("keeps a failed check from updating the last-read time", async () => {
    stubPoll({ messages: [], unreadable: true });
    render(<InboxManager />);

    await screen.findByRole("status");
    expect(screen.queryByText(/Checked at/)).toBeNull();
  });

  it("still warns when the old messages it shows may be behind", async () => {
    stubPoll({
      unreadable: true,
      messages: [{ subject: "Your code", fromAddress: "no-reply@x.test", body: "123456", code: "123456", receivedAt: null }],
    });
    render(<InboxManager />);

    const notice = await screen.findByRole("status");
    expect(notice.textContent).toMatch(/could not reach the inbox/i);
    expect(await screen.findByText("Your code")).toBeTruthy();
  });
});

describe("reading an inbox that answers", () => {
  it("leaves the empty inbox promising exactly what it does", async () => {
    stubPoll({ messages: [], unreadable: false });
    render(<InboxManager />);

    const empty = await screen.findByText(/will appear here automatically/i);
    expect(empty.textContent).toMatch(/Nothing has arrived yet/i);
    expect(screen.queryByRole("status")).toBeNull();
  });
});
