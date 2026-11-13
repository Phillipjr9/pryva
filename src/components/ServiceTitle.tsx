import type { ServiceType } from "@/components/ServiceIcon";

/** A consistent text-first title for customer service pages. */
export function ServiceTitle({
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
      <h1 className="text-[1.5rem] font-medium tracking-tight text-ink sm:text-[1.7rem]">{children}</h1>
    </div>
  );
}
