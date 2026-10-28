/**
 * Support-message statuses.
 *
 * Shared by the admin inbox page (server), its status control (client) and the
 * API route. This must not live in the `"use client"` component: a server
 * component importing a non-component value across that boundary receives a
 * client-reference proxy instead of the array, which fails at build time.
 */
export const MESSAGE_STATUSES = ["open", "in_progress", "resolved", "closed"] as const;

export type MessageStatus = (typeof MESSAGE_STATUSES)[number];

export const MESSAGE_STATUS_LABELS: Record<MessageStatus, string> = {
  open: "Open",
  in_progress: "In progress",
  resolved: "Resolved",
  closed: "Closed",
};

export function isMessageStatus(value: unknown): value is MessageStatus {
  return typeof value === "string" && (MESSAGE_STATUSES as readonly string[]).includes(value);
}
