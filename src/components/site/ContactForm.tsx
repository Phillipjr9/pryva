"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Check, Shield } from "@/components/icons";

const topics = [
  "General question",
  "Virtual numbers",
  "eSIM",
  "Residential proxies",
  "Email OTP",
  "Wallet or refund",
  "Partnership",
];

type Props = {
  defaultName?: string;
  defaultEmail?: string;
  signedIn?: boolean;
};

export function ContactForm({ defaultName = "", defaultEmail = "", signedIn = false }: Props) {
  const router = useRouter();
  const [form, setForm] = useState({
    name: defaultName,
    email: defaultEmail,
    topic: topics[0],
    message: "",
  });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = (await response.json()) as { ok?: boolean; error?: string };
      if (!response.ok || !data.ok) {
        setError(data.error ?? "We couldn't send that. Please try again.");
        return;
      }
      setSent(true);
      setForm({ ...form, message: "" });
      if (signedIn) router.refresh();
    } catch {
      setError("Network hiccup. Please try again.");
    } finally {
      setPending(false);
    }
  }

  if (sent) {
    return (
      <div className="card p-7 sm:p-9">
        <span className="grid h-12 w-12 place-items-center rounded-full bg-lav-100 text-lav-700">
          <Check className="h-6 w-6" />
        </span>
        <h3 className="mt-5 text-2xl font-medium">Message received.</h3>
        <p className="mt-2 max-w-md text-[0.92rem] leading-relaxed text-ink-2">
          Your message was saved for support review. Response times may vary.
        </p>
        <div className="mt-6 flex flex-col gap-2.5 sm:flex-row">
          <button type="button" onClick={() => setSent(false)} className="btn btn-primary">
            Send another message
            <ArrowRight className="h-4 w-4" />
          </button>
          {signedIn && (
            <Link href="/dashboard/support" className="btn btn-ghost">
              See your messages
            </Link>
          )}
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="card p-6 sm:p-8">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="name" className="field-label">
            Your name
          </label>
          <input
            id="name"
            required
            minLength={2}
            className="field"
            placeholder="Amaka Obi"
            value={form.name}
            onChange={(event) => setForm({ ...form, name: event.target.value })}
          />
        </div>
        <div>
          <label htmlFor="email" className="field-label">
            Email address
          </label>
          <input
            id="email"
            type="email"
            required
            className="field"
            placeholder="you@example.com"
            value={form.email}
            onChange={(event) => setForm({ ...form, email: event.target.value })}
          />
        </div>
      </div>

      <div className="mt-4">
        <label htmlFor="topic" className="field-label">
          What is this about?
        </label>
        <select
          id="topic"
          className="field appearance-none"
          value={form.topic}
          onChange={(event) => setForm({ ...form, topic: event.target.value })}
        >
          {topics.map((topic) => (
            <option key={topic} value={topic}>
              {topic}
            </option>
          ))}
        </select>
      </div>

      <div className="mt-4">
        <label htmlFor="message" className="field-label">
          How can we help?
        </label>
        <textarea
          id="message"
          required
          minLength={10}
          rows={5}
          className="field resize-none"
          placeholder="Tell us what happened, and include your order reference if you have one."
          value={form.message}
          onChange={(event) => setForm({ ...form, message: event.target.value })}
        />
      </div>

      {error && <p className="mt-3 text-[0.8rem] font-medium text-rose-600">{error}</p>}

      <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="inline-flex items-center gap-1.5 text-meta text-ink-3">
          <Shield className="h-3.5 w-3.5 text-lav-600" />
          Please do not include passwords, payment-card details or verification codes.
        </p>
        <button type="submit" disabled={pending} className="btn btn-primary disabled:opacity-60">
          {pending ? "Sending…" : "Send message"}
          {!pending && <ArrowRight className="h-4 w-4" />}
        </button>
      </div>
    </form>
  );
}
