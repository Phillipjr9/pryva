import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md" | "lg";
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "primary", size = "md", loading, disabled, children, ...props }, ref) => {
    return (
      <button
        ref={ref}
        disabled={disabled || loading}
        className={cn(
          "inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed",
          {
            "bg-lav-600 text-white hover:bg-lav-700 dark:bg-lav-500 dark:hover:bg-lav-600": variant === "primary",
            "border border-line bg-white text-ink hover:bg-cream dark:bg-gray-800 dark:border-gray-700 dark:text-gray-100 dark:hover:bg-gray-700": variant === "secondary",
            "text-ink-2 hover:bg-cream hover:text-ink dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-100": variant === "ghost",
            "bg-red-600 text-white hover:bg-red-700 dark:bg-red-500 dark:hover:bg-red-600": variant === "danger",
          },
          {
            "px-3 py-1.5 text-[0.82rem]": size === "sm",
            "px-4 py-2 text-[0.9rem]": size === "md",
            "px-6 py-3 text-[1rem]": size === "lg",
          },
          className
        )}
        {...props}
      >
        {loading && (
          <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        )}
        {children}
      </button>
    );
  }
);

Button.displayName = "Button";
