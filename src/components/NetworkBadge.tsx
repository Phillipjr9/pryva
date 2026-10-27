import type { AirtimeProvider } from "@/lib/airtime";

/**
 * Network marks for the airtime/data pickers.
 *
 * Drawn as inline SVG in each network's own colours so they stay crisp at any
 * size and cost no image request. Each mark is a distinct shape (not just a
 * letter in a box) so the four tiles are instantly recognisable.
 */
const BRANDS: Record<
  AirtimeProvider,
  { name: string; from: string; to: string; ink: string; shape: "oval" | "wave" | "orbit" | "nine" }
> = {
  mtn: { name: "MTN", from: "#FFCC00", to: "#F5B800", ink: "#1a1a1a", shape: "oval" },
  airtel: { name: "Airtel", from: "#FF3B30", to: "#D9211A", ink: "#ffffff", shape: "wave" },
  glo: { name: "Glo", from: "#63B32E", to: "#3F8F1E", ink: "#ffffff", shape: "orbit" },
  "9mobile": { name: "9mobile", from: "#8CC63F", to: "#4E9E2A", ink: "#0f2d10", shape: "nine" },
};

export function NetworkBadge({
  provider,
  size = 40,
  className = "",
}: {
  provider: AirtimeProvider;
  size?: number;
  className?: string;
}) {
  const brand = BRANDS[provider];
  const id = `nb-${provider}`;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      role="img"
      aria-label={brand.name}
      className={className}
    >
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={brand.from} />
          <stop offset="100%" stopColor={brand.to} />
        </linearGradient>
      </defs>

      <rect width="48" height="48" rx="14" fill={`url(#${id})`} />

      {brand.shape === "oval" && (
        <ellipse cx="24" cy="24" rx="15" ry="11.5" fill="none" stroke={brand.ink} strokeWidth="3.2" opacity="0.9" />
      )}

      {brand.shape === "wave" && (
        <path
          d="M12 30c4-9 8 3 12-6s8 3 12-6"
          fill="none"
          stroke={brand.ink}
          strokeWidth="3.4"
          strokeLinecap="round"
        />
      )}

      {brand.shape === "orbit" && (
        <>
          <circle cx="24" cy="24" r="5.2" fill={brand.ink} />
          <ellipse
            cx="24"
            cy="24"
            rx="14"
            ry="7.5"
            fill="none"
            stroke={brand.ink}
            strokeWidth="2.6"
            transform="rotate(-28 24 24)"
            opacity="0.95"
          />
        </>
      )}

      {brand.shape === "nine" && (
        <>
          <circle cx="24" cy="19" r="7.5" fill="none" stroke={brand.ink} strokeWidth="3.2" />
          <path d="M30 25.5 22 38" stroke={brand.ink} strokeWidth="3.2" strokeLinecap="round" />
        </>
      )}
    </svg>
  );
}

export function networkName(provider: AirtimeProvider): string {
  return BRANDS[provider].name;
}
