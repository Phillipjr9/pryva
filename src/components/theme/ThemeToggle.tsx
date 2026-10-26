"use client";

import { useTheme } from "./ThemeProvider";
import { Sun, Moon, Monitor } from "@/components/icons";

interface ThemeToggleProps {
  variant?: "icon" | "full";
  className?: string;
}

export function ThemeToggle({ variant = "icon", className = "" }: ThemeToggleProps) {
  const { theme, setTheme } = useTheme();

  if (variant === "icon") {
    return (
      <button
        onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
        className={`grid h-10 w-10 place-items-center rounded-full border border-line bg-white/70 text-ink transition-colors hover:bg-white dark:bg-gray-800 dark:border-gray-700 dark:text-gray-100 ${className}`}
        aria-label="Toggle theme"
      >
        {theme === "dark" ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
      </button>
    );
  }

  return (
    <div className={`flex items-center gap-1 rounded-full border border-line bg-white/70 p-1 dark:bg-gray-800 dark:border-gray-700 ${className}`}>
      <button
        onClick={() => setTheme("light")}
        className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[0.82rem] font-medium transition-colors ${
          theme === "light"
            ? "bg-lav-100 text-lav-700 dark:bg-lav-900/30 dark:text-lav-300"
            : "text-ink-2 hover:text-ink dark:text-gray-400 dark:hover:text-gray-100"
        }`}
        aria-label="Light theme"
      >
        <Sun className="h-4 w-4" />
        Light
      </button>
      <button
        onClick={() => setTheme("dark")}
        className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[0.82rem] font-medium transition-colors ${
          theme === "dark"
            ? "bg-lav-100 text-lav-700 dark:bg-lav-900/30 dark:text-lav-300"
            : "text-ink-2 hover:text-ink dark:text-gray-400 dark:hover:text-gray-100"
        }`}
        aria-label="Dark theme"
      >
        <Moon className="h-4 w-4" />
        Dark
      </button>
      <button
        onClick={() => setTheme("system")}
        className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[0.82rem] font-medium transition-colors ${
          theme === "system"
            ? "bg-lav-100 text-lav-700 dark:bg-lav-900/30 dark:text-lav-300"
            : "text-ink-2 hover:text-ink dark:text-gray-400 dark:hover:text-gray-100"
        }`}
        aria-label="System theme"
      >
        <Monitor className="h-4 w-4" />
        System
      </button>
    </div>
  );
}
