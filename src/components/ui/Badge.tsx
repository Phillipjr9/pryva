import { type ReactNode } from "react";
import { cn } from "@/lib/utils";

interface BadgeProps {
  children: ReactNode;
  variant?: "default" | "success" | "warning" | "error" | "info";
  size?: "sm" | "md";
  className?: string;
}

export function Badge({ children, variant = "default", size = "md", className }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full font-semibold",
        {
          "bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300": variant === "default",
          "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300": variant === "success",
          "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300": variant === "warning",
          "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300": variant === "error",
          "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300": variant === "info",
        },
        {
          "px-2 py-0.5 text-[0.7rem]": size === "sm",
          "px-3 py-1 text-[0.78rem]": size === "md",
        },
        className
      )}
    >
      {children}
    </span>
  );
}
