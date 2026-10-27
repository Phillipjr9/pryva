import { requireUser } from "@/lib/auth";
import { digitalServices, getDigitalService } from "@/lib/digital-services";
import { formatNaira } from "@/lib/catalog";
import { DigitalServicesForm } from "./DigitalServicesForm";
import { ServiceIcon } from "@/components/ServiceIcon";

export const dynamic = "force-dynamic";

export default async function DigitalServicesPage({
  searchParams,
}: {
  searchParams: { service?: string };
}) {
  const user = await requireUser("/dashboard/digital");
  const selectedService = searchParams.service ? getDigitalService(searchParams.service) : null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[1.5rem] font-medium tracking-tight">Digital Accounts</h1>
        <p className="mt-1 text-[0.86rem] text-ink-2">
          Buy premium accounts for Netflix, Spotify, ChatGPT, and more.
        </p>
      </div>

      {selectedService ? (
        <DigitalServicesForm user={user} service={selectedService} />
      ) : (
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {digitalServices.map((service) => (
            <a
              key={service.slug}
              href={`/dashboard/digital?service=${service.slug}`}
              className="card p-6 hover:scale-[1.02] transition-transform"
            >
              <div className="flex items-start gap-4 mb-4">
                <ServiceIcon service={service.slug as any} size="lg" />
                <div>
                  <h3 className="text-lg font-bold text-ink">{service.name}</h3>
                  <p className="text-xs text-ink-3">{service.plans.length} plans</p>
                </div>
              </div>
              <p className="text-sm text-ink-2 mb-4">{service.description}</p>
              <div className="flex items-center justify-between">
                <span className="text-xs text-ink-3">Starting from</span>
                <span className="text-lg font-bold text-lav-600">
                  {formatNaira(Math.min(...service.plans.map((p) => p.price)))}
                </span>
              </div>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
