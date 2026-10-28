"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { Select } from "@/components/ui/Select";
import { Alert } from "@/components/ui/Alert";
import { Mail, MessageCircle, Clock } from "@/components/icons";

export default function ContactPage() {
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    topic: "general",
    message: "",
  });
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const topics = [
    { value: "general", label: "General Inquiry" },
    { value: "support", label: "Technical Support" },
    { value: "billing", label: "Billing & Payments" },
    { value: "partnership", label: "Partnership Opportunities" },
    { value: "feedback", label: "Feedback & Suggestions" },
  ];

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      const response = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });

      const data = await response.json();

      if (!response.ok || !data.ok) {
        throw new Error(data.error || "Failed to send message");
      }

      setSuccess("Your message was received for support review.");
      setFormData({ name: "", email: "", topic: "general", message: "" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send message");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-cream">
      {/* Hero */}
      <section className="py-16">
        <div className="shell text-center">
          <h1 className="text-[2.5rem] font-medium tracking-tight text-ink sm:text-[3rem]">
            Get in touch
          </h1>
          <p className="mt-4 text-[1.1rem] text-ink-2 max-w-2xl mx-auto">
            Have a question or need help? We&apos;re here to assist you.
          </p>
        </div>
      </section>

      {/* Contact Options */}
      <section className="pb-16">
        <div className="shell">
          <div className="grid gap-6 sm:grid-cols-3 mb-12">
            <div className="rounded-2xl border border-line bg-white p-6 text-center">
              <div className="grid h-12 w-12 place-items-center rounded-xl bg-lav-100 text-lav-600 mx-auto mb-4">
                <Mail className="h-6 w-6" />
              </div>
              <h3 className="text-[1rem] font-semibold text-ink mb-2">Email Us</h3>
              <p className="text-[0.86rem] text-ink-2">support@pryva.ng</p>
            </div>
            <div className="rounded-2xl border border-line bg-white p-6 text-center">
              <div className="grid h-12 w-12 place-items-center rounded-xl bg-green-100 text-green-600 mx-auto mb-4">
                <MessageCircle className="h-6 w-6" />
              </div>
              <h3 className="text-[1rem] font-semibold text-ink mb-2">Message form</h3>
              <p className="text-[0.86rem] text-ink-2">Send a message below</p>
            </div>
            <div className="rounded-2xl border border-line bg-white p-6 text-center">
              <div className="grid h-12 w-12 place-items-center rounded-xl bg-blue-100 text-blue-600 mx-auto mb-4">
                <Clock className="h-6 w-6" />
              </div>
              <h3 className="text-[1rem] font-semibold text-ink mb-2">Response Time</h3>
              <p className="text-[0.86rem] text-ink-2">Response times may vary</p>
            </div>
          </div>

          {/* Contact Form */}
          <div className="max-w-2xl mx-auto">
            <div className="rounded-2xl border border-line bg-white p-8">
              <h2 className="text-[1.5rem] font-semibold text-ink mb-6">
                Send us a message
              </h2>

              {error && <Alert variant="error" className="mb-6">{error}</Alert>}
              {success && <Alert variant="success" className="mb-6">{success}</Alert>}

              <form onSubmit={handleSubmit} className="space-y-6">
                <Input
                  label="Name"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="Your name"
                  required
                />

                <Input
                  label="Email"
                  type="email"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  placeholder="you@example.com"
                  required
                />

                <Select
                  label="Topic"
                  value={formData.topic}
                  onChange={(e) => setFormData({ ...formData, topic: e.target.value })}
                  options={topics}
                  required
                />

                <Textarea
                  label="Message"
                  value={formData.message}
                  onChange={(e) => setFormData({ ...formData, message: e.target.value })}
                  placeholder="How can we help you?"
                  rows={6}
                  required
                />

                <Button type="submit" size="lg" className="w-full" loading={loading} disabled={loading}>
                  {loading ? "Sending..." : "Send Message"}
                </Button>
              </form>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
