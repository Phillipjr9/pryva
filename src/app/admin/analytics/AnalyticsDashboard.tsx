"use client";

import { formatNaira } from "@/lib/catalog";
import { Users, ShoppingCart, DollarSign } from "@/components/icons";

interface AnalyticsDashboardProps {
  stats: {
    totalUsers: number;
    totalOrders: number;
    totalRevenue: number;
  };
}

export function AnalyticsDashboard({ stats }: AnalyticsDashboardProps) {
  const cards = [
    {
      label: "Total Users",
      value: stats.totalUsers.toString(),
      icon: Users,
      color: "lav",
    },
    {
      label: "Total Orders",
      value: stats.totalOrders.toString(),
      icon: ShoppingCart,
      color: "peach",
    },
    {
      label: "Total Revenue",
      value: formatNaira(stats.totalRevenue),
      icon: DollarSign,
      color: "mint",
    },
  ];

  return (
    <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
      {cards.map((card) => {
        const Icon = card.icon;
        return (
          <div
            key={card.label}
            className="rounded-2xl border border-line bg-white p-6 dark:bg-gray-800 dark:border-gray-700"
          >
            <div className="flex items-center justify-between mb-4">
              <span
                className={`grid h-12 w-12 place-items-center rounded-xl ${
                  card.color === "lav"
                    ? "bg-lav-100 text-lav-600 dark:bg-lav-900/30 dark:text-lav-400"
                    : card.color === "peach"
                    ? "bg-orange-100 text-orange-600 dark:bg-orange-900/30 dark:text-orange-400"
                    : "bg-green-100 text-green-600 dark:bg-green-900/30 dark:text-green-400"
                }`}
              >
                <Icon className="h-6 w-6" />
              </span>
            </div>
            <p className="text-[0.86rem] text-ink-2 dark:text-gray-400 mb-1">{card.label}</p>
            <p className="text-[2rem] font-bold text-ink dark:text-gray-100">{card.value}</p>
          </div>
        );
      })}
    </div>
  );
}
