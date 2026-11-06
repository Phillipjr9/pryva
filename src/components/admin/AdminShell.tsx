"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { OperatorNav, OperatorSignOut, ADMIN_NAV_ITEMS, adminSectionFor } from "@/app/admin/(console)/OperatorNav";
import {
  ArrowRight, Bell, ChevronDown, Close, Home,
  Menu, Monitor, Moon, Search, Shield, Sun, Users,
} from "@/components/icons";

export type AttentionItem = { label: string; description: string; count: number; href: string; kind: "payouts" | "support" | "security" | "messages" };
type Theme = "light" | "dark" | "system";
const THEME_KEY = "pryva-admin-theme";

function readTheme(): Theme {
  try {
    const value = localStorage.getItem(THEME_KEY);
    return value === "light" || value === "dark" ? value : "system";
  } catch { return "system"; }
}
function subscribeTheme(callback: () => void) {
  window.addEventListener("storage", callback);
  window.addEventListener("pryva-theme-change", callback);
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  media.addEventListener("change", callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener("pryva-theme-change", callback);
    media.removeEventListener("change", callback);
  };
}
const serverTheme = (): Theme => "system";
function subscribeViewport(callback: () => void) {
  const media = window.matchMedia("(max-width: 991px)");
  media.addEventListener("change", callback);
  return () => media.removeEventListener("change", callback);
}
const readViewport = () => window.matchMedia("(max-width: 991px)").matches;
const serverViewport = () => false;
const themeScript = `(function(){try{var t=localStorage.getItem('${THEME_KEY}')||'system';var d=t==='dark'||(t==='system'&&matchMedia('(prefers-color-scheme: dark)').matches);document.getElementById('pryva-admin').setAttribute('data-bs-theme',d?'dark':'light');}catch(e){}})();`;

function ConsoleSearch({ open, onClose }: { open: boolean; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [query, setQuery] = useState("");
  const router = useRouter();
  const term = query.trim();
  const results = term
    ? ADMIN_NAV_ITEMS.filter((item) => `${item.label} ${item.section}`.toLowerCase().includes(term.toLowerCase()))
    : ADMIN_NAV_ITEMS.filter((item) => ["/admin", "/admin/orders", "/admin/users", "/admin/withdrawals", "/admin/support", "/admin/transactions"].includes(item.href));
  const recordSearches = term ? [
    { href: `/admin/orders?q=${encodeURIComponent(term)}`, label: `Search orders for “${term}”`, section: "Orders", icon: Search },
    { href: `/admin/users?q=${encodeURIComponent(term)}`, label: `Search users for “${term}”`, section: "Users", icon: Users },
  ] : [];

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) { element.showModal(); setQuery(""); }
    if (!open && element.open) element.close();
  }, [open]);

  function navigate(href: string) { onClose(); router.push(href); }

  return (
    <dialog
      ref={dialog}
      className="console-search-dialog"
      aria-label="Search the operator console"
      onClose={onClose}
      onClick={(event) => { if (event.target === dialog.current) onClose(); }}
      onKeyDown={(event) => {
        const links = Array.from(dialog.current?.querySelectorAll<HTMLAnchorElement>("[data-search-result]") ?? []);
        const index = links.indexOf(document.activeElement as HTMLAnchorElement);
        if (event.key === "ArrowDown" && links.length) { event.preventDefault(); links[(index + 1) % links.length]?.focus(); }
        if (event.key === "ArrowUp" && links.length) { event.preventDefault(); links[index <= 0 ? links.length - 1 : index - 1]?.focus(); }
      }}
    >
      <div className="search-dialog-input">
        <Search aria-hidden="true" />
        <input
          autoFocus
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search pages, orders or users…"
          aria-label="Search pages, orders or users"
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              const first = dialog.current?.querySelector<HTMLAnchorElement>("[data-search-result]");
              if (first) { event.preventDefault(); navigate(first.href); }
            }
          }}
        />
        <button type="button" className="icon-button" onClick={onClose} aria-label="Close search"><Close /></button>
      </div>
      <div className="search-dialog-results">
        <p className="px-3 pt-2 pb-1 mb-0 text-uppercase" style={{ color: "var(--pc-muted)", fontSize: ".6rem", letterSpacing: ".1em" }}>{term ? "Pages" : "Quick navigation"}</p>
        {results.map((item) => {
          const Icon = item.icon ?? Search;
          return <Link key={item.href} href={item.href} data-search-result className="search-result" onClick={(event) => { event.preventDefault(); navigate(item.href); }}><Icon /><span>{item.label}</span><small>{item.section}</small></Link>;
        })}
        {term && results.length === 0 && <p className="px-3 py-2 mb-0 small" style={{ color: "var(--pc-muted)" }}>No matching pages. Search your records below.</p>}
        {recordSearches.map((item) => <Link key={item.href} href={item.href} data-search-result className="search-result" onClick={(event) => { event.preventDefault(); navigate(item.href); }}><Search /><span className="text-truncate">{item.label}</span><ArrowRight className="ms-auto" /></Link>)}
      </div>
      <div className="search-dialog-footer">↑ ↓ to navigate <span className="mx-2">·</span> Enter to open <span className="mx-2">·</span> Esc to close</div>
    </dialog>
  );
}

export function AdminShell({
  email,
  name,
  attention,
  preview,
  children,
}: {
  email: string;
  name: string;
  attention: AttentionItem[];
  preview: boolean;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const section = adminSectionFor(pathname);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [popover, setPopover] = useState<"notifications" | "profile" | null>(null);
  const actionsRef = useRef<HTMLDivElement>(null);
  const theme = useSyncExternalStore(subscribeTheme, readTheme, serverTheme);
  const mobileViewport = useSyncExternalStore(subscribeViewport, readViewport, serverViewport);
  const attentionCount = attention.reduce((total, item) => total + item.count, 0);

  useEffect(() => {
    const dark = theme === "dark" || (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
    document.getElementById("pryva-admin")?.setAttribute("data-bs-theme", dark ? "dark" : "light");
  }, [theme]);

  useEffect(() => {
    function keyboard(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") { event.preventDefault(); setSearchOpen((value) => !value); }
      if (event.key === "Escape") { setMobileOpen(false); setPopover(null); setSearchOpen(false); }
    }
    function outside(event: PointerEvent) {
      if (!actionsRef.current?.contains(event.target as Node)) setPopover(null);
    }
    document.addEventListener("keydown", keyboard);
    document.addEventListener("pointerdown", outside);
    return () => { document.removeEventListener("keydown", keyboard); document.removeEventListener("pointerdown", outside); };
  }, []);

  useEffect(() => {
    if (!mobileOpen || !mobileViewport) return;
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.querySelector<HTMLAnchorElement>("#operator-sidebar a")?.focus();
    function trapFocus(event: KeyboardEvent) {
      if (event.key !== "Tab") return;
      const links = Array.from(document.querySelectorAll<HTMLElement>("#operator-sidebar a, #operator-sidebar button"));
      const first = links[0];
      const last = links[links.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
    document.addEventListener("keydown", trapFocus);
    return () => { document.body.style.overflow = overflow; document.removeEventListener("keydown", trapFocus); previous?.focus(); };
  }, [mobileOpen, mobileViewport]);

  function chooseTheme(value: Theme) {
    try { localStorage.setItem(THEME_KEY, value); } catch { /* The theme still works when storage is unavailable. */ }
    window.dispatchEvent(new Event("pryva-theme-change"));
  }
  function toggleSidebar() {
    if (mobileViewport) setMobileOpen((value) => !value);
    else setCollapsed((value) => !value);
  }

  return (
    <div className="admin-app app-loaded" id="pryva-admin" data-bs-theme="light">
      {/* A static, local preference read prevents a light-theme flash. No user data is interpolated. */}
      <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      <a href="#admin-content" className="skip-link">Skip to content</a>
      <div className={`app-wrapper fixed-header sidebar-expand-lg${collapsed ? " sidebar-collapse" : ""}${mobileOpen ? " sidebar-open" : ""}`}>
        {mobileOpen && <button type="button" className="sidebar-overlay" aria-label="Close navigation" onClick={() => setMobileOpen(false)} />}
        <OperatorNav email={email} name={name} mobileOpen={mobileOpen} onNavigate={() => setMobileOpen(false)} />
        <header className="app-header">
          <div className="header-inner">
            <div className="header-left">
              <button type="button" className="icon-button" onClick={toggleSidebar} aria-label="Toggle navigation" aria-controls="operator-sidebar" aria-expanded={mobileViewport ? mobileOpen : !collapsed}><Menu /></button>
              <span className="header-divider d-none d-sm-block" />
              <span className="d-none d-sm-inline" style={{ fontSize: ".76rem", fontWeight: 600 }}>{section?.label ?? "Console"}</span>
            </div>
            <div className="header-actions" ref={actionsRef}>
              <button type="button" className="header-search" onClick={() => setSearchOpen(true)} aria-label="Search console (Control or Command K)"><Search /><span>Search console…</span><kbd>⌘ K</kbd></button>
              <div className="position-relative">
                <button type="button" className="icon-button" aria-label={`Notifications${attentionCount ? `, ${attentionCount} items need attention` : ""}`} aria-expanded={popover === "notifications"} aria-controls="admin-notifications" onClick={() => setPopover((value) => value === "notifications" ? null : "notifications")}><Bell />{attentionCount > 0 && <span className="notification-count">{attentionCount > 99 ? "99+" : attentionCount}</span>}</button>
                {popover === "notifications" && <div className="header-popover" id="admin-notifications">
                  <div className="popover-heading d-flex justify-content-between align-items-center">Needs attention <span className="status-badge warning">{attentionCount} items</span></div>
                  {attention.every((item) => item.count === 0) && <p className="px-3 py-3 mb-0 small" style={{ color: "var(--pc-muted)" }}>These queues are clear. No pending items to show.</p>}
                  {attention.filter((item) => item.count > 0).map((item) => <Link className="popover-row" key={item.href} href={item.href} onClick={() => setPopover(null)}><span className="flex-grow-1">{item.label}<small className="d-block mt-1" style={{ color: "var(--pc-muted)", fontSize: ".63rem" }}>{item.description}</small></span><span className="status-badge warning">{item.count}</span><ArrowRight /></Link>)}
                  <Link href="/admin/health" className="popover-footer" onClick={() => setPopover(null)}>Open operational health</Link>
                </div>}
              </div>
              <span className="header-divider" />
              <div className="position-relative">
                <button type="button" className="header-profile" aria-label="Operator menu" aria-expanded={popover === "profile"} aria-controls="admin-profile" onClick={() => setPopover((value) => value === "profile" ? null : "profile")}><span className="header-avatar">{name.charAt(0).toUpperCase()}</span><span className="header-profile-copy"><span className="header-profile-name">{name}</span><span className="header-profile-role">Administrator</span></span><ChevronDown className="d-none d-sm-block" style={{ width: 13, height: 13 }} /></button>
                {popover === "profile" && <div className="header-popover" id="admin-profile">
                  <div className="popover-heading"><span className="d-block">{name}</span><span className="d-block mt-1 text-truncate" style={{ color: "var(--pc-muted)", fontSize: ".68rem", fontWeight: 400 }} title={email}>{email}</span></div>
                  <Link href="/admin/account" className="popover-row" onClick={() => setPopover(null)}><Users /> Account & security</Link>
                  <div className="px-3 pt-3 pb-1" style={{ color: "var(--pc-muted)", fontSize: ".62rem", textTransform: "uppercase", letterSpacing: ".08em" }}>Appearance</div>
                  <div className="d-flex gap-1 px-3 pb-3" role="group" aria-label="Color theme">
                    {([{ value: "light", label: "Light", icon: Sun }, { value: "dark", label: "Dark", icon: Moon }, { value: "system", label: "Auto", icon: Monitor }] as const).map((option) => { const Icon = option.icon; return <button type="button" key={option.value} className={`btn btn-sm flex-fill ${theme === option.value ? "btn-primary" : "btn-outline-secondary"}`} aria-pressed={theme === option.value} onClick={() => chooseTheme(option.value)}><Icon />{option.label}</button>; })}
                  </div>
                  <OperatorSignOut />
                </div>}
              </div>
            </div>
          </div>
        </header>
        <main className="app-main" id="admin-content" tabIndex={-1}>
          <div className="app-content-header">
            <nav aria-label="Breadcrumb"><ol className="console-breadcrumb"><li><Link href="/admin" aria-label="Console home"><Home /></Link></li><li><Link href="/admin">Console</Link></li>{section && section.href !== "/admin" && <li>{section.section}</li>}<li aria-current="page">{section?.label ?? "Console"}</li></ol></nav>
          </div>
          {preview && <div className="mx-3 mx-lg-4 mt-3 info-note"><Shield /><span><strong>Preview workspace.</strong> This deployment uses an isolated, in-memory database. Changes reset when the server restarts; no live payments are processed.</span></div>}
          <div className="app-content">{children}</div>
        </main>
        <footer className="app-footer"><span><strong>Pryva</strong> <span className="mx-2">/</span> Operator console</span><span>Secure workspace <span className="mx-2">·</span> AdminLTE-inspired interface</span></footer>
      </div>
      <ConsoleSearch open={searchOpen} onClose={() => setSearchOpen(false)} />
    </div>
  );
}
