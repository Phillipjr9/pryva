import Link from "next/link";
import { ServiceIcon } from "@/components/ServiceIcon";
import { ArrowRight, Bell, Check } from "@/components/icons";

export const metadata = {
  title: "Digital subscriptions | Pryva",
  description: "Streaming and digital subscriptions are coming to Pryva. Check back soon or contact support.",
};

const planned = [
  { name: "Streaming services", detail: "Netflix, Spotify, YouTube Premium and similar platforms." },
  { name: "AI tools", detail: "ChatGPT Plus, Midjourney, Claude and other AI subscriptions." },
  { name: "Productivity apps", detail: "Notion, Canva Pro, Adobe and similar tools." },
  { name: "Gaming", detail: "Xbox Game Pass, PlayStation Plus and gaming credits." },
];

export default function DigitalServicesPage() {
  return (
    <div className="min-h-screen bg-cream">
      <section className="py-16 sm:py-20">
        <div className="shell">
          <div className="max-w-3xl">
            <ServiceIcon service="accounts" size="lg" className="mb-5" />
            <span className="mb-4 inline-block rounded-full bg-amber-100 px-4 py-1.5 text-meta font-semibold text-amber-800">
              Coming soon
            </span>
            <h1 className="text-[2.5rem] font-medium tracking-tight text-ink sm:text-[3.5rem]">
              Digital subscriptions
            </h1>
            <p className="mt-6 text-[1.1rem] leading-relaxed text-ink-2">
              Streaming, AI tools and productivity subscriptions are not available to order yet.
              No price or product is being advertised until a delivery path is connected.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/accounts" className="btn btn-primary">
                Explore account listings
                <ArrowRight className="h-4 w-4" />
              </Link>
              <Link href="/contact" className="btn btn-ghost">
                <Bell className="h-4 w-4" />
                Get notified when available
              </Link>
            </div>
          </div>
        </div>
      </section>

      <section className="pb-16">
        <div className="shell">
          <h2 className="mb-6 text-[1.5rem] font-semibold text-ink">What we are planning</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            {planned.map((item) => (
              <div key={item.name} className="rounded-2xl border border-line bg-white p-6">
                <div className="flex items-start gap-3">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-lav-600" />
                  <div>
                    <h3 className="text-[1rem] font-semibold text-ink">{item.name}</h3>
                    <p className="mt-1 text-[0.88rem] leading-relaxed text-ink-2">{item.detail}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 p-5">
            <p className="text-[0.9rem] leading-relaxed text-amber-900">
              <strong>Not available yet.</strong> These categories are listed for planning purposes only.
              Nothing here can be ordered or charged until a delivery service is connected.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
