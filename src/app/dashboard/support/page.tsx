import type { Metadata } from "next";
import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { contactMessages } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { isPreviewDatabase } from "@/lib/demo-policy";
import { ContactForm } from "@/components/site/ContactForm";
import { ArrowRight, Chat, Clock, Mail, MessageCircle } from "@/components/icons";

export const metadata: Metadata = { title: "Support" };
export const dynamic = "force-dynamic";

export default async function SupportPage() {
  const user = await requireUser("/dashboard/support");
  const preview = isPreviewDatabase();

  const messages = await db
    .select()
    .from(contactMessages)
    .where(eq(contactMessages.userId, user.id))
    .orderBy(desc(contactMessages.createdAt))
    .limit(10);

  return (
    <div className="grid min-w-0 grid-cols-1 gap-4">
      <div>
        <h1 className="text-[1.5rem] font-medium tracking-tight text-ink sm:text-[1.7rem]">Support</h1>
        <p className="mt-1 text-[0.86rem] text-ink-2">
          {preview ? "Try the support form with a fictional message. Demo messages are shared and no real request is sent." : "Send a message about your account or an existing order. Response times may vary."}
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        {[
          { icon: MessageCircle, label: preview ? "Demo form" : "Message form", value: preview ? "Save a fictional message below" : "Send a support request below" },
          { icon: Mail, label: preview ? "Delivery" : "Email", value: preview ? "No real request is sent" : "support@pryva.ng" },
          { icon: Clock, label: preview ? "Demo history" : "Response time", value: preview ? "Visible in this preview" : "May vary" },
        ].map((item) => {
          const Icon = item.icon;
          return (
            <div
              key={item.label}
              className="flex items-start gap-2.5 rounded-2xl border border-line bg-[#fffdfa] p-4"
            >
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-lav-50 text-lav-700">
                <Icon className="h-4 w-4" />
              </span>
              <div>
                <p className="text-[0.8rem] font-semibold text-ink">{item.label}</p>
                <p className="text-[0.72rem] text-ink-3">{item.value}</p>
              </div>
            </div>
          );
        })}
      </div>

      <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] lg:items-start">
        <ContactForm defaultName={preview ? "Demo Visitor" : user.name} defaultEmail={preview ? "demo@example.test" : user.email} signedIn preview={preview} />

        <div className="grid gap-4">
          <div className="rounded-[1.5rem] border border-line bg-[#fffdfa] p-5">
            <div className="flex items-center justify-between">
              <h2 className="text-[1rem] font-semibold">Your recent messages</h2>
              <Chat className="h-4 w-4 text-lav-600" />
            </div>
            {messages.length === 0 ? (
              <p className="mt-3 rounded-xl border border-dashed border-line bg-cream/50 px-4 py-6 text-center text-[0.8rem] text-ink-3">
                {preview ? "No demo messages yet. Try saving a fictional example." : "You haven't messaged us yet. Anything unclear? Ask away."}
              </p>
            ) : (
              <div className="mt-3 grid gap-2.5">
                {messages.map((message: { id: string; topic: string; status: string; message: string; createdAt: Date | string }) => (
                  <div key={message.id} className="rounded-xl border border-line bg-white p-3.5">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-[0.78rem] font-semibold text-ink">{message.topic}</p>
                      <span className="rounded-full bg-lav-50 px-2 py-0.5 text-[0.6rem] font-semibold capitalize text-lav-700">
                        {message.status}
                      </span>
                    </div>
                    <p className="mt-1 line-clamp-3 text-[0.76rem] leading-relaxed text-ink-2">
                      {message.message}
                    </p>
                    <p className="mt-1.5 text-[0.64rem] text-ink-3">
                      {new Date(message.createdAt).toLocaleString("en-NG", {
                        day: "numeric",
                        month: "short",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-[1.5rem] border border-lav-200 bg-gradient-to-br from-lav-50 to-white p-5">
            <p className="text-[0.85rem] font-semibold text-ink">Quick self-serve</p>
            <div className="mt-2.5 grid gap-1.5 text-[0.78rem]">
              <Link
                href="/faq"
                className="flex items-center justify-between rounded-lg bg-white/80 px-3 py-2 text-ink-2 hover:text-lav-700"
              >
                Read the full FAQ <ArrowRight className="h-3.5 w-3.5" />
              </Link>
              <Link
                href="/dashboard/orders"
                className="flex items-center justify-between rounded-lg bg-white/80 px-3 py-2 text-ink-2 hover:text-lav-700"
              >
                Find an order code <ArrowRight className="h-3.5 w-3.5" />
              </Link>
              <Link
                href="/refund-policy"
                className="flex items-center justify-between rounded-lg bg-white/80 px-3 py-2 text-ink-2 hover:text-lav-700"
              >
                Refund policy <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
