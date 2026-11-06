import type { ReactNode } from "react";
import { Inbox } from "@/components/admin/AdminIcons";

export function PageHeading({ title, description, eyebrow, actions }: { title: string; description?: string; eyebrow?: string; actions?: ReactNode }) {
  return <div className="page-heading"><div>{eyebrow && <div className="eyebrow">{eyebrow}</div>}<h1>{title}</h1>{description && <p>{description}</p>}</div>{actions && <div className="page-heading-actions">{actions}</div>}</div>;
}

export function AdminCard({ title, subtitle, actions, children, className = "", padded = true, footer }: { title?: string; subtitle?: string; actions?: ReactNode; children: ReactNode; className?: string; padded?: boolean; footer?: ReactNode }) {
  return <section className={`card${className ? ` ${className}` : ""}`}>{title && <div className="card-header"><div><h2 className="card-title">{title}</h2>{subtitle && <p className="card-subtitle">{subtitle}</p>}</div>{actions}</div>}<div className={padded ? "card-body" : ""}>{children}</div>{footer && <div className="card-footer">{footer}</div>}</section>;
}

const STATUS_TONES: Record<string, string> = {
  delivered: "success", completed: "success", resolved: "success", verified: "success", paid: "success", published: "success",
  processing: "warning", pending: "warning", review: "warning", open: "warning", waiting_customer: "warning",
  failed: "danger", escalated: "danger", rejected: "danger", high: "danger",
  active: "info", refunded: "primary", approved: "primary", expired: "", closed: "",
};
export function StatusBadge({ status, label }: { status: string; label?: string }) {
  return <span className={`status-badge ${STATUS_TONES[status] ?? ""}`}><span className="status-dot" />{label ?? status.replace(/_/g, " ")}</span>;
}

export function EmptyState({ title, description, icon, action }: { title: string; description?: string; icon?: ReactNode; action?: ReactNode }) {
  return <div className="empty-state">{icon ?? <Inbox />}<strong>{title}</strong>{description && <p>{description}</p>}{action}</div>;
}

export function initials(name: string | null | undefined) {
  return (name ?? "Customer").trim().split(/\s+/).map((part) => part[0]).join("").toUpperCase().slice(0, 2) || "C";
}
export function serviceLabel(service: string) {
  const labels: Record<string, string> = { virtual_number: "Virtual numbers", esim: "eSIM data", proxy: "Proxies", email_otp: "Email OTP", gift_card: "Gift cards", gift_cards: "Gift cards", airtime: "Airtime", data: "Mobile data", accounts: "Digital accounts", marketplace: "Marketplace", boosting: "Social boosting", inbox: "Temporary inbox" };
  return labels[service] ?? service.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}
export function adminDate(value: Date | string, time = false) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", ...(time ? { hour: "2-digit", minute: "2-digit", timeZone: "UTC" } : { year: "numeric", timeZone: "UTC" }) }).format(date);
}
export function AdminTimestamp({ value, time = false }: { value: Date | string; time?: boolean }) {
  const date = new Date(value);
  return <time dateTime={Number.isFinite(date.getTime()) ? date.toISOString() : undefined} title={`${adminDate(date, true)} UTC`}>{adminDate(date, time)}</time>;
}
