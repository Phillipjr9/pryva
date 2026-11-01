import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { escapeHtml, sendGiftCardDelivery } from "@/lib/gift-card-delivery";

/**
 * A gift card bought "for someone" used to reach nobody.
 *
 * `giftCardEmail()` shipped with the gift-card launch and was never called: the
 * purchase route accepted a recipient address, stored it, and showed the code to
 * the buyer. The code is the money, so a card whose email never leaves is a card
 * the recipient cannot spend.
 *
 * The send is a courtesy on top of a completed purchase, so it must never turn a
 * debit that already happened into an error the customer retries.
 */

let sent: { url: string; body: Record<string, unknown> }[] = [];
let respond: () => Response = () => ({ ok: true, status: 200 }) as Response;

beforeEach(() => {
  sent = [];
  respond = () => ({ ok: true, status: 200 }) as Response;
  vi.stubEnv("RESEND_API_KEY", "re_test");
  vi.stubEnv("RESEND_FROM_EMAIL", "Pryva <hello@pryva.ng>");
  vi.stubGlobal("fetch", vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    sent.push({ url: String(url), body: JSON.parse(String(init?.body)) });
    return respond();
  }));
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const GIFT = { to: "ada@example.com", code: "PRYVA-ABCD-2345-WXYZ", amount: 5_000, senderName: "Emeka" };

describe("sendGiftCardDelivery", () => {
  it("mails the code to the recipient the buyer named", async () => {
    expect(await sendGiftCardDelivery(GIFT)).toBe(true);
    expect(sent).toHaveLength(1);
    expect(sent[0].url).toBe("https://api.resend.com/emails");
    expect(sent[0].body).toMatchObject({ to: "ada@example.com" });
    const body = sent[0].body as { subject: string; html: string };
    expect(body.subject).toContain("Emeka sent you a Pryva gift card");
    expect(body.html).toContain("PRYVA-ABCD-2345-WXYZ");
    expect(body.html).toContain("5,000");
  });

  it("never claims a send that is not configured", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    expect(await sendGiftCardDelivery(GIFT)).toBe(false);
    expect(sent).toHaveLength(0);
  });

  it("reports a rejected send instead of pretending it went out", async () => {
    respond = () => ({ ok: false, status: 422 }) as Response;
    expect(await sendGiftCardDelivery(GIFT)).toBe(false);
  });

  it("survives a network failure without throwing at the caller", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("socket hang up");
    }));
    await expect(sendGiftCardDelivery(GIFT)).resolves.toBe(false);
  });

  it("escapes the sender's name and message, which are customer text inside HTML", async () => {
    await sendGiftCardDelivery({
      ...GIFT,
      senderName: '<script>alert(1)</script>',
      message: 'Happy birthday "Ada" & <b>enjoy</b>',
    });
    const html = (sent[0].body as { html: string }).html;
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).not.toContain("<b>enjoy</b>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&amp;");
  });
});

describe("escapeHtml", () => {
  it("covers the five characters that matter", () => {
    expect(escapeHtml(`<&>"'`)).toBe("&lt;&amp;&gt;&quot;&#39;");
  });
});

describe("the gift card order route tells the truth when its own refund fails", () => {
  const source = readFileSync("src/app/api/gift-cards/order/route.ts", "utf8");

  it("moves the order where an operator will see it", () => {
    expect(source).toContain('status: "review"');
    expect(source).toContain("automatic refund failed — debit still stands");
  });

  it("does not claim a refund that did not happen", () => {
    // The old code printed the same sentence whether or not the credit committed.
    expect(source).toContain("We could not return the money to your wallet automatically");
    expect(source).toContain("refunded\n          ?");
  });
});
