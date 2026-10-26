import Image from "next/image";
import Link from "next/link";

type LogoProps = {
  className?: string;
  variant?: "lockup" | "monogram";
  tone?: "color" | "mono";
  tagline?: boolean;
  href?: string | null;
};

const monochromeMarkPath = [
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
  if (tone === "color") {
    return (
      <Image
        src="/pryva-mark.png"
        alt=""
        width={1024}
        height={1024}
        sizes={className.includes("h-64") ? "256px" : "40px"}
        className={`${className} object-contain`}
        aria-hidden="true"
      />
    );
  }

  return (
    <svg
      viewBox="0 0 72 72"
      className={className}
      aria-hidden="true"
      role="presentation"
      focusable="false"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d={monochromeMarkPath}
        fill="currentColor"
        fillRule="evenodd"
        clipRule="evenodd"
      />
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
