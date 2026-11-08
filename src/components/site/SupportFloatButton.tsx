"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { SupportChat } from "@/components/support/SupportChat";

function ChatIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-3.5 w-3.5 fill-none stroke-current stroke-[2] sm:h-4 sm:w-4">
      <path d="M6.5 18.5 3.5 20.5V6.8A2.8 2.8 0 0 1 6.3 4h11.4A2.8 2.8 0 0 1 20.5 6.8v7.4A2.8 2.8 0 0 1 17.7 17H8.3L6.5 18.5Z" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M8 9.5h8M8 13h6" strokeLinecap="round" />
    </svg>
  );
}

export function SupportFloatButton() {
  const pathname = usePathname();
  const [visible, setVisible] = useState(true);
  const [open, setOpen] = useState(false);
  const lastScrollY = useRef(0);

  useEffect(() => {
    const handleScroll = () => {
      const currentY = window.scrollY;
      const shouldShow = currentY < 48 || currentY < lastScrollY.current;
      setVisible(shouldShow);
      lastScrollY.current = currentY;
    };

    const handleOpenSupport = () => setOpen(true);
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    handleScroll();
    window.addEventListener("scroll", handleScroll, { passive: true });
    window.addEventListener("open-support-chat", handleOpenSupport);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("scroll", handleScroll);
      window.removeEventListener("open-support-chat", handleOpenSupport);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  // Operators have their own support and account queues; never mount the
  // customer assistant inside the privileged console.
  if (pathname?.startsWith("/admin")) return null;

  /*
   * The dashboard has a fixed bottom tab bar on phones, and this button used to
   * sit directly on top of it — `bottom-4` against a bar roughly 64px tall — so
   * the pill covered the tabs, and the Support tab most of all: the one place
   * this button's own destination was already reachable. Lift it clear of the
   * bar on those routes only, and leave every other page where it was.
   */
  const raisedAboveTabBar = Boolean(
    pathname === "/dashboard" || pathname?.startsWith("/dashboard/"),
  );

  return (
    <>
      <div
        className={`pointer-events-none fixed right-3 z-50 sm:right-5 ${
          raisedAboveTabBar
            ? "bottom-[calc(env(safe-area-inset-bottom)+4.75rem)] sm:bottom-5"
            : "bottom-4 sm:bottom-5"
        }`}
      >
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Open support chat"
          className={`floating pointer-events-auto group relative inline-flex items-center justify-center overflow-hidden rounded-full border border-lav-300/80 bg-gradient-to-b from-lav-600 via-lav-700 to-lav-800 text-white shadow-[0_10px_20px_rgba(78,58,130,0.24),0_18px_34px_rgba(107,79,174,0.18),inset_0_1px_0_rgba(255,255,255,0.32)] transition-all duration-200 ease-out hover:-translate-y-0.5 hover:shadow-[0_14px_24px_rgba(78,58,130,0.3),0_24px_40px_rgba(107,79,174,0.22),inset_0_1px_0_rgba(255,255,255,0.38)] active:translate-y-0 focus-visible:outline-2 focus-visible:outline-offset-4 ${
            visible ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0 pointer-events-none"
          } h-10 gap-1.5 px-2.5 text-[0.72rem] font-semibold tracking-[0.01em] sm:h-11 sm:gap-2 sm:px-3.5 sm:text-[0.76rem]`}
        >
          <span className="absolute inset-x-2 top-1 h-1.5 rounded-full bg-white/30 blur-[2px]" />
          <span className="relative grid h-6 w-6 place-items-center rounded-full border border-white/30 bg-white/10 shadow-inner shadow-white/20 sm:h-7 sm:w-7">
            <ChatIcon />
          </span>
          <span className="relative hidden sm:inline">Need help?</span>
          <span className="relative sm:hidden">Help</span>
        </button>
      </div>

      {open ? (
        <div className="fixed inset-x-0 bottom-0 z-[60] flex justify-center px-2 pb-[calc(env(safe-area-inset-bottom)+0.5rem)] sm:inset-auto sm:bottom-20 sm:right-4 sm:left-auto sm:w-[340px] sm:px-0">
          <div className="relative z-10 w-full overflow-hidden rounded-[1.25rem] border border-line bg-[#fffdfa] shadow-[0_16px_28px_rgba(24,20,31,0.16)] sm:w-[340px]">
            <div className="flex items-center justify-between border-b border-line bg-lav-50 px-2.5 py-2">
              <div className="flex items-center gap-2">
                <span className="grid h-5 w-5 place-items-center rounded-full bg-lav-700 text-white">
                  <ChatIcon />
                </span>
                <span className="text-[0.72rem] font-semibold text-ink">Support</span>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-full border border-line bg-white px-1.5 py-0.5 text-[0.65rem] font-semibold text-ink-2 hover:border-lav-300 hover:text-lav-700"
              >
                ×
              </button>
            </div>
            <div className="max-h-[62vh] overflow-y-auto p-2 sm:max-h-[54vh]">
              <SupportChat />
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
