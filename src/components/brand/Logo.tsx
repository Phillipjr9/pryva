import Link from "next/link";

type LogoProps = {
  className?: string;
  variant?: "lockup" | "monogram";
  tone?: "color" | "mono";
  tagline?: boolean;
  href?: string | null;
};

export function Monogram({
  className = "h-10 w-10",
  tone = "color",
}: {
  className?: string;
  tone?: "color" | "mono";
}) {
  const gradientId = tone === "color" ? "pryva-mono-gradient" : undefined;

  return (
    <svg
      viewBox="0 0 64 64"
      className={className}
      aria-hidden="true"
      role="presentation"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id="pryva-mono-gradient" x1="0.15" y1="0" x2="0.85" y2="1">
          <stop offset="0%" stopColor="#D6C7F5" />
          <stop offset="38%" stopColor="#B49CE7" />
          <stop offset="100%" stopColor="#8266C9" />
        </linearGradient>
        <mask id="pryva-mono-mask">
          <rect x="0" y="0" width="64" height="64" fill="white" />
          <ellipse cx="37.4" cy="26.4" rx="6.4" ry="7.1" fill="black" />
        </mask>
      </defs>
      <g mask="url(#pryva-mono-mask)" fill={tone === "color" ? `url(#${gradientId})` : "currentColor"}>
        <rect x="15" y="11" width="16.5" height="44" rx="8.25" />
        <circle cx="36.5" cy="26.5" r="14.5" />
      </g>
    </svg>
  );
}

export function Logo({
  className = "",
  variant = "lockup",
  tone = "color",
  tagline = false,
  href = "/",
}: LogoProps) {
  const content = (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <Monogram className="h-9 w-9 shrink-0" tone={tone} />
      {variant === "lockup" && (
        <span className="flex flex-col leading-none">
          <span
            className={`text-[1.45rem] font-medium tracking-[-0.04em] ${
              tone === "color" ? "text-lav-600" : "text-ink"
            }`}
          >
            Pryva
          </span>
          {tagline && (
            <span className="mt-1 text-[0.5rem] font-semibold uppercase tracking-[0.28em] text-ink-3">
              Simple. Secure. Scalable.
            </span>
          )}
        </span>
      )}
    </span>
  );

  if (!href) return content;

  return (
    <Link href={href} aria-label="Pryva home" className="group inline-flex items-center">
      <span className="transition-transform duration-300 group-hover:scale-[1.02]">{content}</span>
    </Link>
  );
}
