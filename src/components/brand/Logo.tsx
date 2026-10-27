import Image from "next/image";
import Link from "next/link";

type LogoProps = {
  className?: string;
  variant?: "lockup" | "monogram";
  tagline?: boolean;
  href?: string | null;
};

export function Monogram({
  className = "h-10 w-10",
}: {
  className?: string;
}) {
  return (
    <Image
      src="/pryva-logo.png?v=3"
      alt="Pryva"
      width={40}
      height={40}
      className={className}
      style={{ background: 'transparent' }}
    />
  );
}

export function Logo({
  className = "",
  variant = "lockup",
  tagline = false,
  href = "/",
}: LogoProps) {
  const content = (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <Image
        src="/pryva-logo.png?v=3"
        alt="Pryva"
        width={36}
        height={36}
        className="h-9 w-9 shrink-0"
        loading="eager"
        priority
        style={{ background: 'transparent' }}
      />
      {variant === "lockup" && (
        <span className="flex flex-col leading-none">
          <span className="text-[1.45rem] font-medium tracking-[-0.04em] text-lav-600">
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
