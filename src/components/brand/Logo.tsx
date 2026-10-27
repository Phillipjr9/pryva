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
      src="/pryva-logo.png"
      alt="Pryva"
      width={40}
      height={40}
      className={className}
    />
  );
}

export function Logo({
  className = "",
  variant = "lockup",
  tagline = false,
  href = "/",
}: LogoProps) {
  const isLockup = variant === "lockup";

  const content = isLockup ? (
    <Image
      src="/pryva-logo.png"
      alt="Pryva"
      width={420}
      height={420}
      className={`${className} h-auto w-auto`}
    />
  ) : (
    <Image
      src="/pryva-logo.png"
      alt="Pryva"
      width={36}
      height={36}
      className={`${className} h-9 w-9 shrink-0`}
    />
  );

  if (!href) return content;

  return (
    <Link href={href} aria-label="Pryva home" className="group inline-flex items-center">
      <span className="transition-transform duration-300 group-hover:scale-[1.02]">{content}</span>
    </Link>
  );
}
