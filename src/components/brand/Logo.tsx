import { useId } from "react";
import Link from "next/link";

type LogoProps = {
  className?: string;
  variant?: "lockup" | "monogram";
  tone?: "color" | "mono";
  tagline?: boolean;
  href?: string | null;
};

const markPath = [
  // Outer silhouette: a soft, confident P with a long rounded stem.
  "M 19.8 66",
  "C 13.9 66 9.8 62.1 9.8 56.2",
  "L 9.8 14.4",
  "C 9.8 7.4 14.5 4 21.6 4",
  "H 36.4",
  "C 53.3 4 62.5 14.8 62.5 29",
  "C 62.5 44.1 52.2 53 36.4 53",
  "C 31.7 53 27.1 54.1 25.6 57.1",
  "C 24.6 58.8 24.8 62.6 22.6 65.1",
  "C 22 65.8 20.9 66 19.8 66",
  "Z",
  // Counter: kept generously open so the mark stays crisp at small sizes.
  "M 26 23.7",
  "C 26 20.3 28.1 17.9 31.8 17.9",
  "H 36.4",
  "C 44.2 17.9 48.8 22.4 48.8 28.7",
  "C 48.8 35.3 44.3 38.1 36.4 38.1",
  "H 32",
  "C 28.1 38.1 26 36.3 26 33.1",
  "Z",
].join(" ");

export function Monogram({
  className = "h-10 w-10",
  tone = "color",
}: {
  className?: string;
  tone?: "color" | "mono";
}) {
  const instanceId = useId().replace(/:/g, "");
  const gradientId = `pryva-mark-gradient-${instanceId}`;
  const sheenId = `pryva-mark-sheen-${instanceId}`;
  const rimId = `pryva-mark-rim-${instanceId}`;
  const shadowId = `pryva-mark-shadow-${instanceId}`;
  const clipId = `pryva-mark-clip-${instanceId}`;

  return (
    <svg
      viewBox="0 0 72 72"
      className={className}
      aria-hidden="true"
      role="presentation"
      focusable="false"
      xmlns="http://www.w3.org/2000/svg"
    >
      {tone === "color" ? (
        <>
          <defs>
            <linearGradient
              id={gradientId}
              x1="8"
              y1="3"
              x2="65"
              y2="67"
              gradientUnits="userSpaceOnUse"
            >
              <stop stopColor="#E9DFFC" />
              <stop offset="0.3" stopColor="#CBB8F0" />
              <stop offset="0.68" stopColor="#9B7DDD" />
              <stop offset="1" stopColor="#7255B8" />
            </linearGradient>
            <linearGradient id={sheenId} x1="0" y1="0" x2="1" y2="0.2">
              <stop stopColor="#FFFFFF" stopOpacity="0.48" />
              <stop offset="0.38" stopColor="#FFFFFF" stopOpacity="0.15" />
              <stop offset="0.76" stopColor="#FFFFFF" stopOpacity="0" />
              <stop offset="1" stopColor="#4F3B83" stopOpacity="0.18" />
            </linearGradient>
            <linearGradient id={rimId} x1="0" y1="0" x2="1" y2="1">
              <stop stopColor="#FFFFFF" stopOpacity="0.72" />
              <stop offset="0.5" stopColor="#FFFFFF" stopOpacity="0.28" />
              <stop offset="1" stopColor="#FFFFFF" stopOpacity="0.08" />
            </linearGradient>
            <clipPath id={clipId}>
              <path d={markPath} fillRule="evenodd" clipRule="evenodd" />
            </clipPath>
            <filter
              id={shadowId}
              x="-20%"
              y="-15%"
              width="145%"
              height="150%"
              colorInterpolationFilters="sRGB"
            >
              <feDropShadow
                dx="0"
                dy="1.2"
                stdDeviation="1.25"
                floodColor="#4F3B83"
                floodOpacity="0.2"
              />
            </filter>
          </defs>
          <path
            d={markPath}
            fill={`url(#${gradientId})`}
            fillRule="evenodd"
            clipRule="evenodd"
            filter={`url(#${shadowId})`}
          />
          <g clipPath={`url(#${clipId})`}>
            <rect width="72" height="72" fill={`url(#${sheenId})`} />
            <path
              d="M 15.2 14.8 V 54.8 C 15.2 58.3 16.9 60.6 19.7 61.7"
              fill="none"
              stroke="#FFFFFF"
              strokeOpacity="0.44"
              strokeWidth="1.2"
              strokeLinecap="round"
            />
            <path
              d="M 16.1 11.3 C 17.7 9.1 19.9 8.2 23 8.2 H 36.2 C 48.4 8.2 56.4 14.3 59.6 23.8"
              fill="none"
              stroke="#FFFFFF"
              strokeOpacity="0.35"
              strokeWidth="0.9"
              strokeLinecap="round"
            />
          </g>
          <path
            d={markPath}
            fill="none"
            stroke={`url(#${rimId})`}
            strokeWidth="0.65"
            strokeLinejoin="round"
            fillRule="evenodd"
            clipRule="evenodd"
          />
        </>
      ) : (
        <path d={markPath} fill="currentColor" fillRule="evenodd" clipRule="evenodd" />
      )}
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
