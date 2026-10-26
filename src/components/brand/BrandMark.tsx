import {
  siBinance,
  siDiscord,
  siFacebook,
  siGoogle,
  siInstagram,
  siNetflix,
  siOkx,
  siPaypal,
  siSnapchat,
  siSpotify,
  siTelegram,
  siTiktok,
  siTinder,
  siUber,
  siWhatsapp,
  siX,
  type SimpleIcon,
} from "simple-icons";

const brands: Record<string, SimpleIcon> = {
  whatsapp: siWhatsapp,
  telegram: siTelegram,
  google: siGoogle,
  binance: siBinance,
  tiktok: siTiktok,
  instagram: siInstagram,
  paypal: siPaypal,
  discord: siDiscord,
  x: siX,
  netflix: siNetflix,
  snapchat: siSnapchat,
  tinder: siTinder,
  okx: siOkx,
  facebook: siFacebook,
  spotify: siSpotify,
  uber: siUber,
};

export function brandFor(name: string): SimpleIcon | null {
  return brands[name.trim().toLowerCase()] ?? null;
}

export function hasBrand(name: string): boolean {
  return Boolean(brandFor(name));
}

export function BrandMark({
  name,
  className = "h-3.5 w-3.5",
  tone = "brand",
}: {
  name: string;
  className?: string;
  tone?: "brand" | "mono";
}) {
  const icon = brandFor(name);
  if (!icon) return null;

  return (
    <svg
      viewBox="0 0 24 24"
      role="img"
      aria-label={icon.title}
      className={className}
      fill={tone === "mono" ? "currentColor" : `#${icon.hex}`}
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d={icon.path} />
    </svg>
  );
}

export function BrandChip({
  name,
  className = "",
  iconClassName = "h-3 w-3",
}: {
  name: string;
  className?: string;
  iconClassName?: string;
}) {
  const icon = brandFor(name);
  return (
    <span className={`flex items-center gap-1.5 ${className}`}>
      {icon && (
        <span className="grid h-[18px] w-[18px] shrink-0 place-items-center rounded-[5px] bg-white shadow-sm ring-1 ring-line/60">
          <BrandMark name={name} className={iconClassName} />
        </span>
      )}
      {name}
    </span>
  );
}
