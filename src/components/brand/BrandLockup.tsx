import Image from "next/image";
import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * The Pryva lockup — the glossy 3D "P" mark plus the wordmark.
 *
 * One component so the brand is identical in the header, the footer, the
 * dashboard, the admin bar and the auth screens. The mark is a transparent PNG
 * (`public/images/brand/pryva-mark.png`), so it sits on cream, white or dark
 * without a baked background; the favicon/apple-touch files are generated from
 * the same master.
 */

const MARK_SRC = "/images/brand/pryva-mark.png";

type Size = "xs" | "sm" | "md" | "lg" | "xl";

const MARK_PX: Record<Size, number> = { xs: 22, sm: 28, md: 34, lg: 44, xl: 64 };
const TEXT_CLASS: Record<Size, string> = {
  xs: "text-[0.86rem]",
  sm: "text-[1rem]",
  md: "text-[1.12rem]",
  lg: "text-[1.35rem]",
  xl: "text-[1.9rem]",
};

export function BrandMark({
  size = "sm",
  className,
  priority = false,
}: {
  size?: Size;
  className?: string;
  priority?: boolean;
}) {
  const px = MARK_PX[size];
  return (
    <Image
      src={MARK_SRC}
      alt=""
      aria-hidden="true"
      width={px}
      height={px}
      priority={priority}
      // The art already carries its own perspective; a shadow here would double it.
      className={cn("select-none object-contain", className)}
      style={{ width: px, height: px }}
    />
  );
}

export function BrandLockup({
  size = "sm",
  href = "/",
  tone = "auto",
  showName = true,
  className,
  priority = false,
}: {
  size?: Size;
  href?: string | null;
  /** `auto` follows the theme tokens; `light` forces white text (dark panels). */
  tone?: "auto" | "light";
  showName?: boolean;
  className?: string;
  priority?: boolean;
}) {
  const content = (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <BrandMark size={size} priority={priority} />
      {showName && (
        <span
          className={cn(
            "font-semibold tracking-[-0.02em]",
            TEXT_CLASS[size],
            tone === "light" ? "text-white" : "text-ink",
          )}
        >
          Pryva
        </span>
      )}
    </span>
  );

  if (!href) return content;

  return (
    <Link
      href={href}
      aria-label="Pryva home"
      className="inline-flex shrink-0 items-center rounded-xl outline-none transition-opacity hover:opacity-85 focus-visible:ring-2 focus-visible:ring-lav-400"
    >
      {content}
    </Link>
  );
}
