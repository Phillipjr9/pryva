// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { AssistantPresence } from "@/components/support/AssistantPresence";
import { SupportChat } from "@/components/support/SupportChat";

/**
 * The conversation, driven the way a customer drives it.
 *
 * The complaint that produced this screen was not "the styling is off" — it was
 * "it is not interacting with my questions and messages". So these tests assert
 * the mechanics of a conversation rather than the markup:
 *
 *   * what I typed appears straight away, before anything comes back,
 *   * the answer lands in the same transcript and a follow-up continues it,
 *   * while the request is in flight the screen visibly says it is working,
 *   * a failure gives the words back instead of swallowing them,
 *   * and the animation can be hidden for good.
 *
 * The network is stubbed; the engine's own behaviour is tested against real facts
 * in `support-assistant-engine.test.ts`.
 */

const refresh = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh, push: vi.fn(), replace: vi.fn() }),
}));

beforeAll(() => {
  // jsdom has no layout, so the scroll helper the chat calls does not exist.
  Element.prototype.scrollIntoView = vi.fn();
});

beforeEach(() => {
  refresh.mockClear();
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function jsonResponse(body: unknown, init: { ok?: boolean; status?: number } = {}) {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: async () => body,
  } as unknown as Response;
}

function stubFetch(responses: Array<ReturnType<typeof jsonResponse> | Error>) {
  const fetchMock = vi.fn(async () => {
    const next = responses.shift();
    if (next instanceof Error) throw next;
    return next ?? jsonResponse({ ok: false, error: "unexpected call" }, { ok: false, status: 500 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const composer = () => screen.getByLabelText(/your message/i) as HTMLTextAreaElement;
/** Only the transcript, so the textarea's own value cannot be mistaken for a bubble. */
const transcript = () => screen.getByRole("log");
const submit = () => screen.getByRole("button", { name: /ask the assistant|^send$/i });

describe("a customer talking to the assistant", () => {
  it("shows what was typed immediately, then the real answer underneath it", async () => {
    let release: (value: Response) => void = () => {};
    const pending = new Promise<Response>((resolve) => {
      release = resolve;
    });
    vi.stubGlobal("fetch", vi.fn(() => pending));

    render(<SupportChat />);

    fireEvent.change(composer(), { target: { value: "My deposit never arrived" } });
    fireEvent.click(submit());

    // Before the server has said anything, the message and the work are visible.
    expect(screen.getByText("My deposit never arrived")).toBeTruthy();
    expect(screen.getByText(/checking your account/i)).toBeTruthy();
    expect(composer().value).toBe("");
    // And the assistant says in words that it is reading, not just spinning.
    expect(screen.getByText(/reading your message and checking the account/i)).toBeTruthy();

    await act(async () => {
      release(
        jsonResponse({
          ok: true,
          ticketId: "ticket-1",
          status: "answered",
          outcome: "answered",
          reply: "The ₦5,000 is with the provider but not settled into your wallet yet.",
        }),
      );
      await pending;
    });

    await waitFor(() =>
      expect(screen.getByText(/with the provider but not settled/i)).toBeTruthy(),
    );
    expect(screen.queryByText(/checking your account/i)).toBeNull();
    expect(screen.getByText(/here, and ready when you are/i)).toBeTruthy();
    // The new ticket belongs on the server-rendered list of conversations.
    expect(refresh).toHaveBeenCalled();
  });

  it("keeps the thread, and sends a follow-up into the same ticket", async () => {
    const fetchMock = stubFetch([
      jsonResponse({
        ok: true,
        ticketId: "ticket-7",
        status: "answered",
        outcome: "answered",
        reply: "I can see the payment, it is still pending at the provider.",
      }),
      jsonResponse({
        ok: true,
        ticketId: "ticket-7",
        status: "answered",
        outcome: "answered",
        reply: "Nothing more is needed from you; it settles on its own.",
      }),
    ]);

    render(<SupportChat />);

    fireEvent.change(composer(), { target: { value: "Where is my deposit?" } });
    fireEvent.click(submit());
    await waitFor(() => expect(screen.getByText(/still pending at the provider/i)).toBeTruthy());

    // The first question is still on screen: this is a transcript, not a slot.
    expect(screen.getByText("Where is my deposit?")).toBeTruthy();

    fireEvent.change(composer(), { target: { value: "So what do I do now?" } });
    fireEvent.click(submit());
    await waitFor(() => expect(screen.getByText(/settles on its own/i)).toBeTruthy());

    expect(screen.getByText("So what do I do now?")).toBeTruthy();
    expect(screen.getByText(/still pending at the provider/i)).toBeTruthy();

    const calls = fetchMock.mock.calls as unknown as Array<[string, RequestInit]>;
    expect(calls[0][0]).toBe("/api/support/tickets");
    expect(calls[1][0]).toBe("/api/support/tickets/ticket-7");
    expect(JSON.parse(String(calls[1][1].body))).toEqual({ message: "So what do I do now?" });
  });

  it("gives the words back when nothing was recorded", async () => {
    stubFetch([jsonResponse({ ok: false, error: "That did not send. Please try again." }, { ok: false, status: 502 })]);

    render(<SupportChat />);

    fireEvent.change(composer(), { target: { value: "My refund never arrived" } });
    fireEvent.click(submit());

    await waitFor(() =>
      expect(screen.getByText("That did not send. Please try again.")).toBeTruthy(),
    );
    // The optimistic bubble is gone — it never happened — and the text is editable again.
    expect(transcript().textContent).not.toContain("My refund never arrived");
    expect(composer().value).toBe("My refund never arrived");
    expect(refresh).not.toHaveBeenCalled();
  });

  it("treats a network failure the same as a refused one", async () => {
    stubFetch([new TypeError("Failed to fetch")]);

    render(<SupportChat />);
    fireEvent.change(composer(), { target: { value: "Hello, are you there?" } });
    fireEvent.click(submit());

    await waitFor(() => expect(screen.getByText("Failed to fetch")).toBeTruthy());
    expect(composer().value).toBe("Hello, are you there?");
  });

  it("shows an escalated reply as a handover, not as silence", async () => {
    stubFetch([
      jsonResponse({ ok: true, ticketId: "ticket-9", status: "escalated", outcome: "escalated", reply: null }),
    ]);

    render(<SupportChat />);
    fireEvent.change(composer(), { target: { value: "asdf qwerty" } });
    fireEvent.click(submit());

    await waitFor(() => expect(screen.getByText(/this is with a person now/i)).toBeTruthy());
    // The status pill says it in the customer's words, not the database's.
    expect(screen.getByText("With a person")).toBeTruthy();
  });

  it("can hand a ticket to a person without sending another message", async () => {
    const fetchMock = stubFetch([
      jsonResponse({ ok: true, status: "escalated", reply: null }),
    ]);

    render(
      <SupportChat
        ticketId="ticket-3"
        initialMessages={[
          {
            id: "m1",
            role: "customer",
            body: "Something is wrong with my order",
            createdAt: "2026-10-30T12:00:00.000Z",
          },
        ]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /ask for a person instead/i }));

    await waitFor(() => expect(screen.getByText(/passed to a person/i)).toBeTruthy());
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/support/tickets/ticket-3");
    expect(JSON.parse(String(init.body))).toEqual({ action: "escalate" });
    // Once it is with a person, offering the button again would be a lie.
    expect(screen.queryByRole("button", { name: /ask for a person instead/i })).toBeNull();
  });

  it("seeds an existing conversation and refuses to type into a closed one", () => {
    render(
      <SupportChat
        ticketId="ticket-4"
        initialMessages={[
          {
            id: "m1",
            role: "customer",
            body: "My gift card will not redeem",
            createdAt: "2026-10-30T12:00:00.000Z",
          },
          {
            id: "m2",
            role: "admin",
            body: "Fixed it — the code was regenerated.",
            createdAt: "2026-10-30T12:05:00.000Z",
          },
        ]}
      />,
    );

    expect(screen.getByText(/gift card will not redeem/i)).toBeTruthy();
    expect(screen.getByText(/the code was regenerated/i)).toBeTruthy();
    expect(screen.getByText(/pryva support team/i)).toBeTruthy();

    cleanup();
    render(<SupportChat ticketId="ticket-4" closed />);
    expect(screen.getByText(/this conversation is closed/i)).toBeTruthy();
    expect(screen.queryByLabelText(/your message/i)).toBeNull();
  });
});

describe("the animation", () => {
  it("is decoration: the state is also written in words", () => {
    const { rerender, container } = render(<AssistantPresence state="thinking" />);
    expect(container.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
    expect(container.querySelector(".sp-orb-fast")).not.toBeNull();
    expect(container.querySelector(".sp-ring")).not.toBeNull();
    expect(screen.getByText(/reading your message and checking the account/i)).toBeTruthy();

    rerender(<AssistantPresence state="idle" />);
    expect(screen.getByText(/here, and ready when you are/i)).toBeTruthy();
  });

  it("stays hidden after it is hidden", async () => {
    const first = render(<AssistantPresence />);
    fireEvent.click(screen.getByRole("button", { name: /hide the assistant animation/i }));

    // Hidden means not rendered: no orb, no keyframes, nothing to animate.
    await waitFor(() => expect(first.container.querySelector(".sp-orb")).toBeNull());
    expect(window.localStorage.getItem("pryva:support-presence-hidden")).toBe("1");

    // A later visit — a fresh mount, as the page would do — honours the choice.
    cleanup();
    const second = render(<AssistantPresence />);
    await waitFor(() => expect(second.container.querySelector(".sp-orb")).toBeNull());
    expect(screen.queryByText(/reading your message/i)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /show assistant/i }));
    await waitFor(() => expect(second.container.querySelector(".sp-orb")).not.toBeNull());
    expect(window.localStorage.getItem("pryva:support-presence-hidden")).toBe("0");
  });
});

describe("a link that already carries the question", () => {
  const reset = () => window.history.replaceState(null, "", "/dashboard/support");
  afterEach(reset);

  it("drafts the question from the fragment and sends nothing", () => {
    const question = "When will Mobile data be available to order?";
    window.history.replaceState(null, "", `/dashboard/support#ask=${encodeURIComponent(question)}`);
    const fetchMock = stubFetch([]);
    render(<SupportChat />);
    expect(composer().value).toBe(question);
    expect(fetchMock).not.toHaveBeenCalled();
    // A draft is not a message: the transcript stays empty until send.
    expect(transcript().textContent).not.toContain(question);
  });

  it("ignores a query parameter, which the page must not read", () => {
    window.history.replaceState(null, "", `/dashboard/support?ask=${encodeURIComponent("spoofed")}`);
    render(<SupportChat />);
    expect(composer().value).toBe("");
  });

  it("ignores a malformed fragment instead of throwing", () => {
    window.history.replaceState(null, "", "/dashboard/support#ask=%E0%A4%A");
    render(<SupportChat />);
    expect(composer().value).toBe("");
  });
});
