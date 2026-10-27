"use client";

import { createContext, useContext, useEffect, useSyncExternalStore, type ReactNode } from "react";

type Theme = "light" | "dark" | "system";

interface ThemeContextType {
  theme: Theme;
  resolvedTheme: "light" | "dark";
  setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);
const themeListeners = new Set<() => void>();
let fallbackTheme: Theme = "system";

function readTheme(): Theme {
  if (typeof window === "undefined") return "system";
  try {
    const stored = localStorage.getItem("pryva-theme");
    return stored === "light" || stored === "dark" || stored === "system" ? stored : fallbackTheme;
  } catch {
    return fallbackTheme;
  }
}

function subscribeTheme(onChange: () => void): () => void {
  themeListeners.add(onChange);
  window.addEventListener("storage", onChange);
  return () => {
    themeListeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}

function subscribeSystemTheme(onChange: () => void): () => void {
  if (!window.matchMedia) return () => {};
  const query = window.matchMedia("(prefers-color-scheme: dark)");
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

function systemIsDark(): boolean {
  return typeof window !== "undefined" && Boolean(window.matchMedia?.("(prefers-color-scheme: dark)").matches);
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const theme = useSyncExternalStore<Theme>(subscribeTheme, readTheme, () => "system");
  const prefersDark = useSyncExternalStore(subscribeSystemTheme, systemIsDark, () => false);
  const resolvedTheme: "light" | "dark" = theme === "system" ? (prefersDark ? "dark" : "light") : theme;

  useEffect(() => {
    document.documentElement.classList.toggle("dark", resolvedTheme === "dark");
  }, [resolvedTheme]);

  function setTheme(next: Theme) {
    fallbackTheme = next;
    try {
      localStorage.setItem("pryva-theme", next);
    } catch {
      // The in-memory fallback still lets the user change themes this session.
    }
    themeListeners.forEach((listener) => listener());
  }

  return (
    <ThemeContext.Provider value={{ theme, resolvedTheme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("useTheme must be used within a ThemeProvider");
  return context;
}
