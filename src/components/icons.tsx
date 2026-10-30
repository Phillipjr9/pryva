import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

function base(props: IconProps) {
  return {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.6,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
    ...props,
  };
}

export function ArrowRight(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M5 12h14" />
      <path d="m13 6 6 6-6 6" />
    </svg>
  );
}

export function ArrowUpRight(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M7 17 17 7" />
      <path d="M8 7h9v9" />
    </svg>
  );
}

export function Check(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="m5 12.5 4.5 4.5L19 7" />
    </svg>
  );
}

export function Sparkle(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M12 3.5l1.8 4.7L18.5 10l-4.7 1.8L12 16.5l-1.8-4.7L5.5 10l4.7-1.8z" />
      <path d="M18.5 15.5l.9 2.1 2.1.9-2.1.9-.9 2.1-.9-2.1-2.1-.9 2.1-.9z" />
    </svg>
  );
}

export function Shield(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M12 3.2 19 6v5.5c0 4.4-3 8-7 9.3-4-1.3-7-4.9-7-9.3V6z" />
      <path d="m9.2 11.8 2 2 3.6-4" />
    </svg>
  );
}

export function Bolt(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M13.5 3 6 13.2h4.8L9.9 21l7.6-10.4h-4.9z" />
    </svg>
  );
}

export function Wallet(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="3" y="6" width="18" height="13" rx="3.2" />
      <path d="M3 10h18" />
      <path d="M16.5 14.5h1.8" />
      <path d="M17 6V4.8A1.8 1.8 0 0 0 14.8 3H6.4A3.4 3.4 0 0 0 3 6.4" />
    </svg>
  );
}

export function Mail(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="3" y="5" width="18" height="14" rx="3" />
      <path d="m4.5 7.5 7.5 5.5 7.5-5.5" />
    </svg>
  );
}

export function Phone(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="6.5" y="2.5" width="11" height="19" rx="3" />
      <path d="M10.5 5.6h3" />
      <path d="M11 18.3h2" />
    </svg>
  );
}

export function Sim(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M7 2.8h6.6L19 8.3V18a3.2 3.2 0 0 1-3.2 3.2H7A3.2 3.2 0 0 1 3.8 18V6A3.2 3.2 0 0 1 7 2.8Z" />
      <rect x="7.4" y="12" width="8.2" height="6.2" rx="1.4" />
      <path d="M7.4 15.1h8.2" />
    </svg>
  );
}

export function Globe(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="12" cy="12" r="9" />
      <path d="M3.5 9.5h17M3.5 14.5h17" />
      <path d="M12 3c2.6 2.6 4 5.6 4 9s-1.4 6.4-4 9c-2.6-2.6-4-5.6-4-9s1.4-6.4 4-9Z" />
    </svg>
  );
}

export function Clock(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7.5V12l3 2" />
    </svg>
  );
}

export function Refresh(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M20 11a8 8 0 0 0-13.7-5.3L4 8" />
      <path d="M4 4v4h4" />
      <path d="M4 13a8 8 0 0 0 13.7 5.3L20 16" />
      <path d="M20 20v-4h-4" />
    </svg>
  );
}

export function Card(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="2.8" y="5.2" width="18.4" height="13.6" rx="3" />
      <path d="M2.8 10h18.4" />
      <path d="M6.5 14.5h3" />
    </svg>
  );
}

export function Lock(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="4.6" y="10.4" width="14.8" height="10" rx="3" />
      <path d="M8.4 10.4V8a3.6 3.6 0 0 1 7.2 0v2.4" />
      <path d="M12 14.4v2.2" />
    </svg>
  );
}

export function Chat(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M21 11.6c0 4.1-4 7.4-9 7.4a10 10 0 0 1-2.7-.4L4 21l1.2-3.7A7 7 0 0 1 3 11.6C3 7.5 7 4.2 12 4.2s9 3.3 9 7.4Z" />
      <path d="M9 11.5h6M9 8.8h3.5" />
    </svg>
  );
}

export function Users(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="9" cy="8.5" r="3.4" />
      <path d="M3.2 20c0-3.2 2.6-5.6 5.8-5.6s5.8 2.4 5.8 5.6" />
      <path d="M16 5.6a3.2 3.2 0 0 1 0 6.2" />
      <path d="M17.5 14.9c2 .6 3.5 2.4 3.5 4.7" />
    </svg>
  );
}

export function Logout(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M14 4.5H7.5A2.5 2.5 0 0 0 5 7v10a2.5 2.5 0 0 0 2.5 2.5H14" />
      <path d="M17.5 8.5 21 12l-3.5 3.5" />
      <path d="M10.5 12H21" />
    </svg>
  );
}

export function Copy(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="9" y="9" width="11.5" height="11.5" rx="2.6" />
      <path d="M15 9V6.5A2.5 2.5 0 0 0 12.5 4H6.5A2.5 2.5 0 0 0 4 6.5v6A2.5 2.5 0 0 0 6.5 15H9" />
    </svg>
  );
}

export function Grid(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="3.5" y="3.5" width="7" height="7" rx="2" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="2" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="2" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="2" />
    </svg>
  );
}

export function Receipt(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M6 3h12v18l-3-1.8-3 1.8-3-1.8L6 21z" />
      <path d="M9.5 8.5h5M9.5 12.5h5" />
    </svg>
  );
}

export function Menu(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M4 7h16M4 12h16M4 17h16" />
    </svg>
  );
}

export function Close(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="m6 6 12 12M18 6 6 18" />
    </svg>
  );
}

export function Loader2(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M12 3a9 9 0 0 1 9 9" />
      <path d="M12 21a9 9 0 0 1-9-9" />
      <path d="M21 12a9 9 0 0 1-9 9" />
      <path d="M3 12a9 9 0 0 1 9-9" />
    </svg>
  );
}

export function CheckCircle(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="12" cy="12" r="9" />
      <path d="m8 12 2.5 2.5L16 7" />
    </svg>
  );
}

export function XCircle(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="12" cy="12" r="9" />
      <path d="m8 8 8 8M16 8l-8 8" />
    </svg>
  );
}

export function AlertCircle(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8v4" />
      <path d="M12 16h.01" />
    </svg>
  );
}

export function Info(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5" />
      <path d="M12 7.6h.01" />
    </svg>
  );
}

export function ChevronDown(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="m6 9.5 6 6 6-6" />
    </svg>
  );
}

export function MessageCircle(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="12" cy="12" r="8.6" />
      <path d="M8.5 10.5h7M8.5 13.8h4.5" />
    </svg>
  );
}

export function Plus(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

export function Heart(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M12 20s-7.2-4.4-7.2-9.1A4.2 4.2 0 0 1 12 8.1a4.2 4.2 0 0 1 7.2 2.8C19.2 15.6 12 20 12 20Z" />
    </svg>
  );
}

export function Star(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...props}>
      <path d="m12 2.8 2.9 5.9 6.5.9-4.7 4.6 1.1 6.5-5.8-3.1-5.8 3.1 1.1-6.5L2.6 9.6l6.5-.9z" />
    </svg>
  );
}

export function Search(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.35-4.35" />
    </svg>
  );
}

export function Home(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <polyline points="9 22 9 12 15 12 15 22" />
    </svg>
  );
}

export function ShoppingCart(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="8" cy="21" r="1" />
      <circle cx="19" cy="21" r="1" />
      <path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12" />
    </svg>
  );
}

export function Gift(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="3" y="8" width="18" height="4" rx="1" />
      <path d="M12 8v13" />
      <path d="M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7" />
      <path d="M7.5 8a2.5 2.5 0 0 1 0-5A4.8 8 0 0 1 12 8a4.8 8 0 0 1 4.5-5 2.5 2.5 0 0 1 0 5" />
    </svg>
  );
}

export function Calendar(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect width="18" height="18" x="3" y="4" rx="2" ry="2" />
      <line x1="16" x2="16" y1="2" y2="6" />
      <line x1="8" x2="8" y1="2" y2="6" />
      <line x1="3" x2="21" y1="10" y2="10" />
    </svg>
  );
}

export function BarChart3(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M3 3v18h18" />
      <path d="M18 17V9" />
      <path d="M13 17V5" />
      <path d="M8 17v-3" />
    </svg>
  );
}

export function DollarSign(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M12 2v20" />
      <path d="M17 5.5c0-1.4-1.8-2.5-5-2.5s-5 1.1-5 2.5 1.8 2.5 5 2.5 5 1.1 5 2.5-1.8 2.5-5 2.5-5-1.1-5-2.5" />
    </svg>
  );
}

export function TrendingUp(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M4 16 10 10l4 4 6-8" />
      <path d="M15 6h5v5" />
    </svg>
  );
}

export function AlertTriangle(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="m12 3 9 15H3l9-15Z" />
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
    </svg>
  );
}

export function Activity(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M3 12h4l2.5-7 4 14 2.5-7H21" />
    </svg>
  );
}

export function Eye(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M2.5 12S6 5 12 5s9.5 7 9.5 7-3.5 7-9.5 7S2.5 12 2.5 12Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

export function EyeOff(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M10.6 5.2A9.9 9.9 0 0 1 12 5c6 0 9.5 7 9.5 7a15.6 15.6 0 0 1-2.4 3.3" />
      <path d="M6.4 6.6A15.9 15.9 0 0 0 2.5 12S6 19 12 19a9.8 9.8 0 0 0 4.2-.9" />
      <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
      <path d="m3 3 18 18" />
    </svg>
  );
}

export function Code(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="m8 8-4 4 4 4" />
      <path d="m16 8 4 4-4 4" />
      <path d="m14 4-4 16" />
    </svg>
  );
}

export function Book(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M4 6.5A2.5 2.5 0 0 1 6.5 4H20v15H6.5A2.5 2.5 0 0 0 4 21.5z" />
      <path d="M4 6.5V19" />
      <path d="M8 7.5h6" />
    </svg>
  );
}

export function User(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5 19c1.7-3.2 4.2-4.8 7-4.8s5.3 1.6 7 4.8" />
    </svg>
  );
}

export function Bell(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M15 17h5l-1.4-1.4A2 2 0 0 1 18 14.2V11a6 6 0 1 0-12 0v3.2a2 2 0 0 1-.6 1.4L4 17h5" />
      <path d="M10 20a2 2 0 0 0 4 0" />
    </svg>
  );
}

export function ArrowLeft(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M19 12H5" />
      <path d="m12 19-7-7 7-7" />
    </svg>
  );
}

export function Pause(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M8 5v14M16 5v14" />
    </svg>
  );
}

export function Play(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="m8 5 11 7-11 7V5Z" />
    </svg>
  );
}

export function X(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M6 6 18 18M18 6 6 18" />
    </svg>
  );
}

export function Sun(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
    </svg>
  );
}

export function Moon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />
    </svg>
  );
}

export function Monitor(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="3" y="4" width="18" height="12" rx="2" />
      <path d="M8 20h8M12 16v4" />
    </svg>
  );
}

export function Download(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M12 4v11" />
      <path d="m7 20 5 5 5-5" />
      <path d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
    </svg>
  );
}

export function FileText(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M14 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7z" />
      <path d="M14 2v5h5" />
      <path d="M9 12h6M9 16h6" />
    </svg>
  );
}

export function FileJson(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M14 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7z" />
      <path d="M14 2v5h5" />
      <path d="M9 11.5c0-1.5 1.2-2.5 3-2.5s3 1 3 2.5-1.2 2.5-3 2.5-3 1-3 2.5 1.2 2.5 3 2.5 3-1 3-2.5" />
    </svg>
  );
}

export function Zap(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M13 2 4 13h6l-1 9 9-11h-6l1-9Z" />
    </svg>
  );
}

export function Settings(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

export function Send(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M22 2 11 13" />
      <path d="M22 2l-7 20-4-9-9-4z" />
    </svg>
  );
}

export function Trash2(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M4 7h16M10 4h4M6 7l1 13h10l1-13M10 11v6M14 11v6" />
    </svg>
  );
}

export function Filter(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M4 5h16l-6.5 7.5v5.5l-3 1.5v-7z" />
    </svg>
  );
}

export const serviceIconMap = {
  phone: Phone,
  sim: Sim,
  globe: Globe,
  mail: Mail,
  accounts: Users,
  gift: Gift,
  package: ShoppingCart,
  calendar: Calendar,
} as const;
