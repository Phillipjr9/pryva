import { countryFor, flagSrc, regionFlagFor } from "@/lib/countries";

/**
 * CountryFlag shows the real flag artwork for a country or regional product.
 *
 * Used instead of emoji flags (🇳🇬), which degrade to "NG" on Windows and to
 * nothing in many email clients.
 */

export type CountryFlagProps = {
  /** A region string as it appears in plan data: "Nigeria", "US · 30 days". */
  region?: string | null;
  /** Skip detection and pass an ISO-3166 alpha-2 code directly. */
  code?: string;
  size?: number;
  className?: string;
  /** Set when the country name is already written next to the flag. */
  decorative?: boolean;
  /** Rounded corners radius; pass 0 for a square flag. */
  radius?: number;
};

function Globe({ size, label, decorative = false }: { size: number; label: string; decorative?: boolean }) {
  return (
    <span
      role={decorative ? undefined : "img"}
      aria-label={decorative ? undefined : label}
      aria-hidden={decorative ? true : undefined}
      title={decorative ? undefined : label}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: size,
        height: size,
        flex: "0 0 auto",
        borderRadius: Math.round(size * 0.22),
        background: "#F1ECFE",
        boxShadow: "inset 0 0 0 1px rgba(124,58,237,0.12)",
      }}
    >
      <svg viewBox="0 0 24 24" width={Math.round(size * 0.66)} height={Math.round(size * 0.66)} aria-hidden="true">
        <g fill="none" stroke="#7C3AED" strokeWidth="1.6" strokeLinecap="round">
          <circle cx="12" cy="12" r="7.4" />
          <path d="M4.7 12h14.6" />
          <path d="M12 4.6c3.6 4.3 3.6 10.5 0 14.8-3.6-4.3-3.6-10.5 0-14.8Z" />
        </g>
      </svg>
    </span>
  );
}

export function CountryFlag({
  region,
  code,
  size = 24,
  className,
  decorative = false,
  radius,
}: CountryFlagProps) {
  const resolved = code
    ? { code, name: code.toUpperCase() }
    : countryFor(region) ?? (regionFlagFor(region) ? { code: regionFlagFor(region)!.code, name: regionFlagFor(region)!.label } : null);

  if (!resolved) {
    return <Globe size={size} label={region || "Global"} decorative={decorative} />;
  }

  return (
    // Static SVG served from /public — next/image would only proxy it.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={flagSrc(resolved.code)}
      alt={decorative ? "" : `${resolved.name} flag`}
      title={resolved.name}
      width={size}
      height={size}
      loading="lazy"
      decoding="async"
      className={className}
      style={{
        display: "block",
        width: size,
        height: size,
        flex: "0 0 auto",
        objectFit: "cover",
        borderRadius: radius ?? Math.round(size * 0.22),
        boxShadow: "inset 0 0 0 1px rgba(15,23,42,0.10)",
        background: "#fff",
      }}
    />
  );
}

/**
 * A row of countries with their real flags — used to prove coverage at a glance
 * ("40+ countries") instead of a wall of emoji that renders as "NG US GB".
 */
export function CountryChips({
  codes,
  size = 22,
  className,
}: {
  codes: string[];
  size?: number;
  className?: string;
}) {
  return (
    <div className={className} style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
      {codes.map((code) => (
        <span
          key={code}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            borderRadius: 999,
            border: "1px solid rgba(15,23,42,0.08)",
            background: "#fff",
            padding: "4px 10px 4px 4px",
            fontSize: 12.5,
            color: "#3f3d56",
          }}
        >
          <CountryFlag code={code} size={size} decorative radius={size / 2} />
          {code.toUpperCase()}
        </span>
      ))}
    </div>
  );
}
