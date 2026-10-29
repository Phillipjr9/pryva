import { digitalServices } from "@/lib/digital-services";
import Link from "next/link";
import { formatNaira } from "@/lib/catalog";
import { ServiceIcon, CategoryIcon } from "@/components/ServiceIcon";

export const metadata = {
  title: "Digital Accounts — Netflix, Spotify, ChatGPT & More | Pryva",
  description: "Explore the digital-services catalog. These products are not available for purchase yet.",
};

export default function DigitalServicesPage() {
  const categories = [
    { slug: "streaming", name: "Streaming", icon: "streaming" as const },
    { slug: "music", name: "Music", icon: "music" as const },
    { slug: "productivity", name: "Productivity", icon: "productivity" as const },
    { slug: "gaming", name: "Gaming", icon: "gaming" as const },
  ];

  return (
    <div className="shell py-16">
      {/* Hero */}
      <div className="text-center mb-16">
        <div className="inline-flex items-center gap-2 rounded-full bg-lav-100 px-4 py-2 text-sm font-semibold text-lav-700 mb-6">
          <span>🔥</span>
          <span>Premium Digital Accounts</span>
        </div>
        <h1 className="text-4xl md:text-5xl font-bold tracking-tight text-ink mb-4">
          Netflix, Spotify, ChatGPT & More
        </h1>
        <p className="text-lg text-ink-2 max-w-2xl mx-auto">
          Explore the catalog in Naira. Digital subscriptions are not available for purchase yet, so nothing on this page can be ordered or charged.
        </p>
      </div>

      {/* Quick Navigation */}
      <div className="mb-12">
        <h2 className="text-sm font-semibold text-ink-3 uppercase tracking-wide mb-4">Browse by Category</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {categories.map((cat) => {
            const count = digitalServices.filter((s) => s.category === cat.slug).length;
            if (count === 0) return null;
            
            return (
              <a
                key={cat.slug}
                href={`#${cat.slug}`}
                className="card p-6 hover:scale-[1.02] transition-transform flex items-center gap-4"
              >
                <CategoryIcon category={cat.icon} size="md" />
                <div>
                  <h3 className="text-lg font-semibold text-ink mb-1">{cat.name}</h3>
                  <p className="text-sm text-ink-3">{count} {count === 1 ? 'service' : 'services'}</p>
                </div>
              </a>
            );
          })}
        </div>
      </div>

      {/* Services */}
      {categories.map((cat) => {
        const services = digitalServices.filter((s) => s.category === cat.slug);
        if (services.length === 0) return null;

        return (
          <div key={cat.slug} id={cat.slug} className="mb-16">
            <h2 className="text-2xl font-bold text-ink mb-6 flex items-center gap-3">
              <CategoryIcon category={cat.icon} size="md" />
              {cat.name}
            </h2>
            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
              {services.map((service) => (
                <div key={service.slug} className="card p-6 hover:shadow-lg transition-shadow">
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex items-center gap-4">
                      <ServiceIcon service={service.slug as any} size="lg" />
                      <div>
                        <h3 className="text-xl font-bold text-ink">{service.name}</h3>
                        <p className="text-sm text-ink-3">{service.plans.length} plans listed</p>
                      </div>
                    </div>
                  </div>
                  <p className="text-sm text-ink-2 mb-4">{service.description}</p>
                  <div className="space-y-2 mb-4">
                    {service.plans.slice(0, 2).map((plan) => (
                      <div key={plan.id} className="flex items-center justify-between text-sm">
                        <span className="text-ink-2">{plan.name}</span>
                        <div className="text-right">
                          {plan.compareAt && (
                            <span className="text-xs text-ink-3 line-through mr-2">
                              {formatNaira(plan.compareAt)}
                            </span>
                          )}
                          <span className="font-bold text-lav-600">{formatNaira(plan.price)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                  <Link
                    href={`/dashboard/digital?service=${service.slug}`}
                    className="btn btn-primary w-full"
                  >
                    View {service.name} plans
                  </Link>
                </div>
              ))}
            </div>
          </div>
        );
      })}

      {/* Trust Badges */}
      <div className="card p-8 mt-16">
        <h2 className="text-2xl font-bold text-ink text-center mb-8">Before you order</h2>
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          <div className="text-center">
            <div className="text-4xl mb-3">⚡</div>
            <h3 className="font-semibold text-ink mb-2">Live fulfillment paused</h3>
            <p className="text-sm text-ink-2">Preview orders do not provide working accounts or credentials.</p>
          </div>
          <div className="text-center">
            <div className="text-4xl mb-3">🛡️</div>
            <h3 className="font-semibold text-ink mb-2">Review uncertain orders</h3>
            <p className="text-sm text-ink-2">Contact support with your reference; provider outcomes must be reviewed.</p>
          </div>
          <div className="text-center">
            <div className="text-4xl mb-3">💳</div>
            <h3 className="font-semibold text-ink mb-2">Naira Payments</h3>
            <p className="text-sm text-ink-2">Catalog prices are shown in Nigerian Naira.</p>
          </div>
          <div className="text-center">
            <div className="text-4xl mb-3">💬</div>
            <h3 className="font-semibold text-ink mb-2">Support requests</h3>
            <p className="text-sm text-ink-2">Use the contact page for an existing order or wallet issue.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
