/**
 * The optional voice model.
 *
 * The assistant's *decisions* are never made by a language model — they are made
 * by `engine.ts` from rows in this database, and that is deliberate: a model that
 * can invent a refund or a delivery time is worse than no assistant at all. What
 * a model is genuinely better at is prose, so this is the only thing it is
 * allowed to do: rewrite a reply the engine has already decided on, without
 * adding a fact.
 *
 * Three properties make that safe enough to offer:
 *
 *   1. **Off by default.** `AI_SUPPORT_MODEL_ENABLED` must be `"true"`, and a key
 *      must exist. Without both, this module returns `null` and the deterministic
 *      reply is used. Nothing else in the assistant changes.
 *   2. **It cannot fail a conversation.** Any error, timeout, empty answer or
 *      refusal returns `null`, and the engine's own wording goes out instead.
 *   3. **It never sees the account.** The payload is the draft, and only the
 *      draft: no customer name, no email, no reference from another system, no
 *      supplier, no wholesale cost. What the customer typed and what the engine
 *      decided to tell them is the whole of it.
 *
 * Turning it on is a decision with a privacy and cost implication, so it is
 * listed among the owner's open decisions rather than switched on here.
 */

const DEFAULT_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_MODEL = "gpt-4o-mini";
const TIMEOUT_MS = 8_000;

export function supportModelConfigured(): boolean {
  return process.env.AI_SUPPORT_MODEL_ENABLED?.trim().toLowerCase() === "true"
    && Boolean(process.env.AI_SUPPORT_API_KEY?.trim());
}

const SYSTEM_PROMPT = `You rewrite support replies for Pryva, a Nigerian digital-services shop.

Rules, in order:
1. Keep every fact exactly as given. Never add a number, a date, a price, a
   delivery time, a promise, an apology timeline or a policy that is not already
   in the draft.
2. Never remove a limitation, a refusal, a "we cannot see that" or the sentence
   saying the ticket is going to a person. Those are the point.
3. Keep the same meaning and the same structure. Short paragraphs, plain English,
   no marketing voice, no emoji.
4. British spelling. Address the customer as "you". Do not sign off with a name.
5. If you cannot rewrite it without breaking rules 1-3, return the draft unchanged.

Return only the reply text.`;

/**
 * Rewrite a decided reply for tone. Returns `null` whenever that is not safe or
 * not possible, and the caller keeps the original.
 */
export async function polishSupportReply(draft: string): Promise<string | null> {
  if (!supportModelConfigured()) return null;
  const key = process.env.AI_SUPPORT_API_KEY?.trim();
  if (!key) return null;

  const baseUrl = (process.env.AI_SUPPORT_BASE_URL?.trim() || DEFAULT_BASE_URL).replace(/\/$/, "");
  const model = process.env.AI_SUPPORT_MODEL?.trim() || DEFAULT_MODEL;

  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        max_tokens: 700,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: draft },
        ],
      }),
    });
    if (!response.ok) return null;
    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: unknown } }>;
    };
    const text = payload.choices?.[0]?.message?.content;
    if (typeof text !== "string") return null;
    const polished = text.trim();
    // A reply that dropped most of its content, or ballooned, is not a rewrite —
    // it is the model having its own conversation. Keep the draft.
    if (polished.length < draft.length * 0.6 || polished.length > draft.length * 2.5) return null;
    return polished;
  } catch {
    // Timeout, DNS, provider outage, malformed JSON: the draft is already good.
    return null;
  }
}
