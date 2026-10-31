import { describe, it, expect, beforeEach } from "vitest";
import { calculateNextRun, processScheduledOrder, type Frequency } from "@/lib/scheduled-orders";
import { mutatePreviewDatabase } from "@/db";

describe("Scheduled Orders", () => {
  describe("calculateNextRun", () => {
    it("should calculate daily frequency", () => {
      const now = new Date();
      const next = calculateNextRun("daily");
      const diff = next.getTime() - now.getTime();
      const days = diff / (1000 * 60 * 60 * 24);
      expect(days).toBeCloseTo(1, 0);
    });

    it("should calculate weekly frequency", () => {
      const now = new Date();
      const next = calculateNextRun("weekly");
      const diff = next.getTime() - now.getTime();
      const days = diff / (1000 * 60 * 60 * 24);
      expect(days).toBeCloseTo(7, 0);
    });

    it("should calculate biweekly frequency", () => {
      const now = new Date();
      const next = calculateNextRun("biweekly");
      const diff = next.getTime() - now.getTime();
      const days = diff / (1000 * 60 * 60 * 24);
      expect(days).toBeCloseTo(14, 0);
    });

    it("should calculate monthly frequency", () => {
      const now = new Date();
      const next = calculateNextRun("monthly");
      expect(next.getMonth()).toBe((now.getMonth() + 1) % 12);
    });

    it("should handle year rollover for monthly", () => {
      const december = new Date(2024, 11, 15); // December 15, 2024
      const next = calculateNextRun("monthly", december);
      expect(next.getFullYear()).toBe(2025);
      expect(next.getMonth()).toBe(0);
    });

    it("rejects an unknown frequency rather than scheduling immediately", () => {
      expect(() => calculateNextRun("invalid" as Frequency)).toThrow("Invalid frequency");
    });

    it("clamps month-end dates to the final day of the next month", () => {
      const next = calculateNextRun("monthly", new Date(2024, 0, 31));
      expect(next.getFullYear()).toBe(2024);
      expect(next.getMonth()).toBe(1);
      expect(next.getDate()).toBe(29);
    });
  });

  describe("processScheduledOrder", () => {
    const userId = "test-sched-user-1";
    const orderId = "sched-row-1";

    beforeEach(() => {
      mutatePreviewDatabase((draft) => {
        draft.users = [{
          id: userId,
          email: "sched@example.com",
          name: "Sched User",
          walletBalance: 20000,
        } as any];
        draft.scheduledOrders = [{
          id: orderId,
          userId,
          service: "numbers",
          productSlug: "vn-ng",
          frequency: "daily",
          nextRunAt: new Date(Date.now() - 60_000),
          status: "active",
          createdAt: new Date(),
        } as any];
      });
    });

    it("processes a due scheduled order and debits wallet", async () => {
      const dueRow = {
        id: orderId,
        userId,
        service: "numbers",
        productSlug: "vn-ng",
        frequency: "daily" as Frequency,
        nextRunAt: new Date(Date.now() - 60_000),
        status: "active" as const,
        lastRunAt: null,
        lastOrderId: null,
        createdAt: new Date(),
      };

      const result = await processScheduledOrder(dueRow as any);
      expect(result).toBe(true);

      mutatePreviewDatabase((draft) => {
        const user = draft.users.find((u) => u.id === userId);
        expect(user!.walletBalance).toBeLessThan(20000);
        const order = draft.orders.find((o) => o.userId === userId);
        expect(order).toBeDefined();
        expect(order!.provider).toBe("scheduled");
      });
    });

    it("skips scheduled order when not yet due", async () => {
      const futureRow = {
        id: orderId,
        userId,
        service: "numbers",
        productSlug: "vn-ng",
        frequency: "daily" as Frequency,
        nextRunAt: new Date(Date.now() + 86_400_000),
        status: "active" as const,
        lastRunAt: null,
        lastOrderId: null,
        createdAt: new Date(),
      };
      mutatePreviewDatabase((draft) => {
        draft.scheduledOrders[0].nextRunAt = futureRow.nextRunAt;
      });

      const result = await processScheduledOrder(futureRow as any);
      expect(result).toBe(false);
    });

    it("skips scheduled order when paused", async () => {
      const pausedRow = {
        id: orderId,
        userId,
        service: "numbers",
        productSlug: "vn-ng",
        frequency: "daily" as Frequency,
        nextRunAt: new Date(Date.now() - 60_000),
        status: "paused" as const,
        lastRunAt: null,
        lastOrderId: null,
        createdAt: new Date(),
      };
      mutatePreviewDatabase((draft) => {
        draft.scheduledOrders[0].status = "paused";
      });

      const result = await processScheduledOrder(pausedRow as any);
      expect(result).toBe(false);
    });
  });
});
