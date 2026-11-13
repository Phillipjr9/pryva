import { requireUser } from "@/lib/identity/auth";
import { db } from "@/db";
import { notifications } from "@/db/schema";
import { and, count, eq, desc } from "drizzle-orm";

import { MarkAllReadButton } from "./MarkAllReadButton";

export const dynamic = "force-dynamic";

/** One page of notifications; older ones are counted but not listed. */
const NOTIFICATION_PAGE_SIZE = 100;

export default async function NotificationsPage() {
  const user = await requireUser("/dashboard/notifications");

  // Newest first, with the id as a tiebreak so two notifications written in the
  // same millisecond keep a stable order between visits.
  const userNotifications = await db
    .select()
    .from(notifications)
    .where(eq(notifications.userId, user.id))
    .orderBy(desc(notifications.createdAt), desc(notifications.id))
    .limit(NOTIFICATION_PAGE_SIZE);

  const [unread] = await db.select({ value: count() }).from(notifications).where(and(eq(notifications.userId, user.id), eq(notifications.read, 0)));
  const unreadCount = Number(unread?.value ?? 0);
  // The list is a bounded window, not the whole history: say so rather than let
  // a long-lived account believe its oldest notifications were deleted.
  const [stored] = await db.select({ value: count() }).from(notifications).where(eq(notifications.userId, user.id));
  const totalCount = Number(stored?.value ?? 0);

  return (
    <div className="grid gap-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-[1.5rem] font-medium tracking-tight text-ink sm:text-[1.7rem]">Notifications</h1>
          <p className="mt-1 text-[0.875rem] text-ink-2">
            {unreadCount > 0
              ? `You have ${unreadCount} unread notification${unreadCount === 1 ? "" : "s"}`
              : "All caught up! No unread notifications"}
          </p>
        </div>
        {unreadCount > 0 && <MarkAllReadButton />}
      </div>

      {totalCount > userNotifications.length && (
        <p className="text-meta text-ink-3">
          Showing the newest {userNotifications.length.toLocaleString("en-NG")} of{" "}
          {totalCount.toLocaleString("en-NG")} notifications. Older ones are archived rather than deleted.
        </p>
      )}

      {userNotifications.length === 0 ? (
        <div className="rounded-[1.5rem] border border-line bg-[#fffdfa] p-12 text-center">

          <h2 className="text-[1.125rem] font-semibold text-ink mb-2">No notifications yet</h2>
          <p className="text-[0.875rem] text-ink-2 max-w-md mx-auto">
There are no notifications stored for this account.
          </p>
        </div>
      ) : (
        <div className="rounded-[1.5rem] border border-line bg-[#fffdfa] overflow-hidden">
          <div className="divide-y divide-line">
            {userNotifications.map((notification) => (
              <div
                key={notification.id}
                className={`p-4 transition-colors ${
                  notification.read ? "bg-white" : "bg-lav-50/30"
                }`}
              >
                <div className="flex items-start gap-3">

                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="text-[0.875rem] font-semibold text-ink">
                          {notification.title}
                          {!notification.read && (
                            <span className="ml-2 text-micro font-semibold text-lav-700">Unread</span>
                          )}
                        </p>
                        <p className="mt-0.5 text-[0.8125rem] text-ink-2">{notification.message}</p>
                      </div>
                    </div>
                    <div className="mt-2 flex items-center gap-3 text-meta text-ink-3">
                      <span className="flex items-center gap-1">

                        {new Date(notification.createdAt).toLocaleString("en-NG", {
                          day: "numeric",
                          month: "short",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                      {notification.read && (
                        <span className="flex items-center gap-1">

                          Read
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
