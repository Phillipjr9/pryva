import { ServiceIcon, type ServiceType } from "@/components/ServiceIcon";

/**
 * A page title with the service's own icon in front of it.
 *
 * Every service page and dashboard section used to open with a bare `<h1>`,
 * so a customer who arrived from a card showing the e-mail artwork landed on a
 * page with no icon at all and could not tell the two surfaces described the
 * same product. The icon is decorative here — the heading beside it already
 * names the service — so it never repeats the name for a screen reader.
 */
export function ServiceTitle({
  service,
  size = "sm",
  className = "",
  children,
}: {
  service: ServiceType;
  size?: "xs" | "sm" | "md" | "lg";
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`flex items-center gap-2.5 ${className}`}>
      <ServiceIcon service={service} size={size} decorative />
      <h1 className="text-[1.5rem] font-medium tracking-tight text-ink sm:text-[1.7rem]">{children}</h1>
    </div>
  );
}
