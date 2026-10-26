import type { Metadata } from "next";
import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { db, hasDatabase } from "@/db";
import { contactMessages } from "@/db/schema";
import { isDemoUser, requireUser } from "@/lib/auth";
import { ContactForm } from "@/components/site/ContactForm";
import { ArrowRight, Chat, Clock, Mail, MessageCircle } from "@/components/icons";

export const metadata: Metadata = { title: "Support" };
export const dynamic = "force-dynamic";

export default async function SupportPage() {
  const user = await requireUser("/dashboard/support");
  const readOnlyDemo = !hasDatabase || isDemoUser(user);

  const messages = !readOnlyDemo
    ? await db
        .select()
        .from(contactMessages)
        .where(eq(contactMessages.userId, user.id))
        .orderBy(desc(contactMessages.createdAt))
        .limit(10)
    : [];

  return (
    <div className="pryva-page pryva-support-page">
      <header className="pryva-page-header">
        <div>
          <span className="pryva-section-eyebrow">ACCOUNT / SUPPORT</span>
          <h1>Support</h1>
          <p>Find an answer or send the Pryva team a message about an order or your wallet.</p>
        </div>
      </header>

      <section className="pryva-support-methods" aria-label="Support channels">
        {[
          { icon: MessageCircle, label: "WhatsApp", value: "Mon–Sat · 9am–8pm WAT" },
          { icon: Mail, label: "Email", value: "support@pryva.ng" },
          { icon: Clock, label: "Typical reply", value: "Under 2 working hours" },
        ].map((item) => {
          const Icon = item.icon;
          return (
            <div key={item.label} className="pryva-support-method">
              <span><Icon className="h-4 w-4" /></span>
              <div>
                <strong>{item.label}</strong>
                <small>{item.value}</small>
              </div>
            </div>
          );
        })}
      </section>

      <div className="pryva-support-columns">
        <div className="pryva-support-form">
          <ContactForm
            defaultName={user.name}
            defaultEmail={user.email}
            signedIn
            readOnly={readOnlyDemo}
          />
        </div>

        <div className="pryva-support-side">
          <section className="pryva-panel pryva-support-messages">
            <div className="pryva-section-head">
              <div>
                <span className="pryva-section-eyebrow">INBOX</span>
                <h2>Your recent messages</h2>
              </div>
              <Chat className="h-4 w-4" />
            </div>
            {messages.length === 0 ? (
              <div className="pryva-empty-ledger">
                <span><Chat className="h-4 w-4" /></span>
                <p>No messages yet.</p>
                <small>Send us a note if you need help with an order or wallet question.</small>
              </div>
            ) : (
              <div className="pryva-message-list">
                {messages.map((message) => (
                  <article key={message.id} className="pryva-message-item">
                    <div className="pryva-message-item-head">
                      <strong>{message.topic}</strong>
                      <span>{message.status}</span>
                    </div>
                    <p>{message.message}</p>
                    <small>
                      {new Date(message.createdAt).toLocaleString("en-NG", {
                        day: "numeric",
                        month: "short",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </small>
                  </article>
                ))}
              </div>
            )}
          </section>

          <section className="pryva-panel pryva-support-links">
            <div className="pryva-section-head">
              <div>
                <span className="pryva-section-eyebrow">SELF-SERVE</span>
                <h2>Quick answers</h2>
              </div>
            </div>
            <div className="pryva-support-link-list">
              <Link href="/faq">Read the full FAQ <ArrowRight className="h-3.5 w-3.5" /></Link>
              <Link href="/dashboard/orders">Find an order code <ArrowRight className="h-3.5 w-3.5" /></Link>
              <Link href="/contact#refunds">Refund policy <ArrowRight className="h-3.5 w-3.5" /></Link>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
