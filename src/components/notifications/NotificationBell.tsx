"use client";

import { useEffect, useState, useCallback, useRef } from "react";

import { Bell } from "@/components/icons";

type Notification = {
  id: string;
  type: string;
  title: string;
  message: string;
  read: boolean;
  createdAt: string;
};

type Props = {
  /** How often to poll for new notifications, in ms. Default 30 seconds. */
  pollInterval?: number;
  /** Additional CSS classes for the bell button. */
  className?: string;
  /**
   * Render the bell alone, with no "Notifications" label.
   *
   * The dashboard header places this beside the balance and the search control,
   * where a wide button does not fit. It used to pass `h-9 w-9 p-0` and hope the
   * label went away; it did not. The button kept its own `px-3 py-2`, so a 36px
   * square ended up holding 24px of horizontal padding plus a 14px icon plus a
   * "Notifications" label — which, because the shared `.btn` rule sets
   * `white-space: normal; overflow-wrap: anywhere`, broke onto one line per
   * character and ran out of the button and over its neighbours.
   *
   * Hiding the label is therefore a decision the component has to make, not
   * something a class on the outside can do: the label and the padding have to
   * go together, and only the owner of both can remove them consistently.
   */
  iconOnly?: boolean;
};

const POLL_DEFAULT = 30_000;

/**
 * A bell icon that polls for unread notifications and shows them in a pop-up.
 *
 * Works for both dashboard customers (via /api/notifications, scoped by session)
 * and admin console operators (same endpoint, scoped to their admin session).
 * Clicking a notification marks it read and dismisses the pop-up item.
 */
export function NotificationBell({ pollInterval = POLL_DEFAULT, className, iconOnly = false }: Props) {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchNotifications = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/notifications?limit=20", {
        headers: { "Cache-Control": "no-store" },
      });
      if (!response.ok) return;
      const data = (await response.json()) as {
        notifications?: Notification[];
        unreadCount?: number;
      };
      setNotifications(data.notifications ?? []);
      setUnreadCount(Number(data.unreadCount ?? 0));
    } catch {
      // Silent: the bell stays empty until the next poll.
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Polling for external data is a legitimate effect: the server is the
    // source of truth and this component re-syncs on a timer.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchNotifications();
    pollRef.current = setInterval(fetchNotifications, pollInterval);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [fetchNotifications, pollInterval]);

  const markRead = useCallback(async (id: string) => {
    try {
      await fetch("/api/notifications/mark-read", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notificationIds: [id] }),
      });
      setNotifications((current) => current.map((n) => (n.id === id ? { ...n, read: true } : n)));
      setUnreadCount((current) => Math.max(0, current - 1));
    } catch {
      // Silent on failure.
    }
  }, []);

  const markAllRead = useCallback(async () => {
    try {
      await fetch("/api/notifications/mark-read", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ markAll: true }),
      });
      setNotifications((current) => current.map((n) => ({ ...n, read: true })));
      setUnreadCount(0);
      setOpen(false);
    } catch {
      // Silent on failure.
    }
  }, []);

  const toggle = () => setOpen((current) => !current);

  const unread = notifications.filter((n) => !n.read);

  return (
    <div className="relative inline-block">
      <button
        type="button"
        onClick={toggle}
        aria-label={unreadCount > 0 ? `${unreadCount} unread notifications` : "Notifications"}
        aria-expanded={open}
        className={`inline-flex items-center gap-1.5 rounded-xl border border-line bg-white text-[0.8rem] font-semibold text-ink-2 hover:border-lav-300 focus:outline-none focus:ring-2 focus:ring-lav-400 ${
          iconOnly
            ? // A square with no padding of its own: the size comes from the
              // caller's `h-9 w-9`, and `!p-0` is needed because the shared `.btn`
              // rule above sets padding that a bare `p-0` would not override.
              "h-9 w-9 shrink-0 justify-center !p-0"
            : "px-3 py-2"
        } ${className ?? ""} disabled:opacity-50`}
        disabled={loading}
      >
        <Bell className="h-3.5 w-3.5 shrink-0" />
        {unreadCount > 0 && (
          /*
           * The count, when it actually fits.
           *
           * This used to be a fixed `h-2 w-2` dot holding "9+" in 10px type, so
           * any count overflowed a 8px circle. It is now sized by its content —
           * a pill — and the whole badge is replaced by a plain dot when there is
           * no room for digits, which is the icon-only case on a phone.
           */
          <span
            className={
              iconOnly
                ? "h-2 w-2 shrink-0 rounded-full bg-rose-600"
                : "grid h-4 min-w-4 shrink-0 place-items-center rounded-full bg-rose-600 px-1 text-[10px] font-bold leading-none text-white"
            }
            aria-hidden="true"
          >
            {iconOnly ? null : unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
        {iconOnly ? null : <span className="hidden whitespace-nowrap sm:block">Notifications</span>}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-80 rounded-xl border border-line bg-white shadow-xl z-50">
          <div className="px-4 py-3 border-b border-line">
            <p className="text-micro font-semibold text-ink">Notifications</p>
            {unreadCount > 0 && (
              <button
                type="button"
                onClick={markAllRead}
                className="ml-auto text-[0.76rem] font-medium text-lav-700 hover:text-lav-800 underline"
              >
                Mark all read
              </button>
            )}
          </div>

          <div className="max-h-[28rem] overflow-y-auto">
            {notifications.length === 0 ? (
              <div className="px-4 py-8 text-center text-micro text-ink-3">
                <span className="opacity-50">No notifications yet</span>
              </div>
            ) : (
              <div className="divide-y divide-line/50">
                {notifications.map((notification) => (
                  <button
                    key={notification.id}
                    type="button"
                    onClick={() => {
                      void markRead(notification.id);
                    }}
                    className={`w-full text-left px-4 py-3 transition-colors ${
                      notification.read ? "bg-white text-ink-2" : "bg-lav-50/50 text-ink hover:bg-lav-100"
                    }`}
                  >
                    <div className="flex items-start gap-2">
                      <div
                        className={`mt-1 shrink-0 grid h-6 w-6 place-items-center rounded-full ${
                          notification.type === "chat_reply"
                            ? "bg-lav-100 text-lav-600"
                            : notification.type === "new_message"
                              ? "bg-emerald-100 text-emerald-600"
                              : "bg-slate-100 text-slate-600"
                        }`}
                      >
                        <Bell className="h-3 w-3" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-[0.82rem] font-semibold leading-tight">
                          {notification.title}
                          {!notification.read && (
                            <span className="ml-1.5 inline-block h-1.5 w-1.5 rounded-full bg-lav-500" />
                          )}
                        </p>
                        <p className="mt-0.5 text-[0.76rem] leading-relaxed text-ink-3 line-clamp-2">
                          {notification.message}
                        </p>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="px-4 py-2 border-t border-line/50">
            <button
              type="button"
              onClick={() => {
                void markAllRead();
                setOpen(false);
              }}
              className="w-full rounded-lg border border-line bg-white px-3 py-1.5 text-[0.78rem] font-medium text-ink-2 hover:bg-lav-50"
            >
              View all notifications
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
