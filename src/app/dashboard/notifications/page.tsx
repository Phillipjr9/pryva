import { requireUser } from "@/lib/auth";
import { db } from "@/db";
import { notifications } from "@/db/schema";
import { and, count, eq, desc } from "drizzle-orm";
import { Bell, Check, Clock } from "@/components/icons";
import { MarkAllReadButton } from "./MarkAllReadButton";

export const dynamic = "force-dynamic";

export default async function NotificationsPage() {
  const user = await requireUser("/dashboard/notifications");

  const userNotifications = await db
    .select()
    .from(notifications)
    .where(eq(notifications.userId, user.id))
    .orderBy(desc(notifications.createdAt))
    .limit(100);

  const [unread] = await db.select({ value: count() }).from(notifications).where(and(eq(notifications.userId, user.id), eq(notifications.read, 0)));
  const unreadCount = Number(unread?.value ?? 0);

  return (
    <div className="grid gap-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-[1.5rem] font-medium tracking-tight text-ink sm:text-[1.7rem]">Notifications</h1>
          <p className="mt-1 text-[0.86rem] text-ink-2">
            {unreadCount > 0
              ? `You have ${unreadCount} unread notification${unreadCount === 1 ? "" : "s"}`
              : "All caught up! No unread notifications"}
          </p>
        </div>
        {unreadCount > 0 && <MarkAllReadButton />}
      </div>

      {userNotifications.length === 0 ? (
        <div className="rounded-[1.5rem] border border-line bg-[#fffdfa] p-12 text-center">
          <Bell className="mx-auto h-16 w-16 text-ink-3 mb-4" />
          <h2 className="text-[1.1rem] font-semibold text-ink mb-2">No notifications yet</h2>
          <p className="text-[0.9rem] text-ink-2 max-w-md mx-auto">
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
                  <div
                    className={`mt-1 grid h-9 w-9 shrink-0 place-items-center rounded-full ${
                      notification.type === "success"
                        ? "bg-emerald-100 text-emerald-600"
                        : notification.type === "warning"
                        ? "bg-amber-100 text-amber-600"
                        : notification.type === "error"
                        ? "bg-red-100 text-red-600"
                        : "bg-lav-100 text-lav-600"
                    }`}
                  >
                    <Bell className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="text-[0.88rem] font-semibold text-ink">
                          {notification.title}
                          {!notification.read && (
                            <span className="ml-2 inline-block h-2 w-2 rounded-full bg-lav-500" />
                          )}
                        </p>
                        <p className="mt-0.5 text-[0.82rem] text-ink-2">{notification.message}</p>
                      </div>
                    </div>
                    <div className="mt-2 flex items-center gap-3 text-meta text-ink-3">
                      <span className="flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {new Date(notification.createdAt).toLocaleString("en-NG", {
                          day: "numeric",
                          month: "short",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                      {notification.read && (
                        <span className="flex items-center gap-1">
                          <Check className="h-3 w-3" />
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
