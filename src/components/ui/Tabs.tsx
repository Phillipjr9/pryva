"use client";

import { useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

interface TabsProps {
  children: ReactNode;
  defaultValue?: string;
  className?: string;
}

export function Tabs({ children, defaultValue, className }: TabsProps) {
  const [activeTab, setActiveTab] = useState(defaultValue || "");

  return (
    <div className={cn("space-y-4", className)}>
      {typeof children === "function"
        ? children({ activeTab, setActiveTab })
        : children}
    </div>
  );
}

interface TabsListProps {
  children: ReactNode;
  className?: string;
}

export function TabsList({ children, className }: TabsListProps) {
  return (
    <div className={cn("flex gap-2 border-b border-line dark:border-gray-700", className)}>
      {children}
    </div>
  );
}

interface TabsTriggerProps {
  value: string;
  children: ReactNode;
  activeTab: string;
  setActiveTab: (value: string) => void;
  className?: string;
}

export function TabsTrigger({ value, children, activeTab, setActiveTab, className }: TabsTriggerProps) {
  const isActive = activeTab === value;

  return (
    <button
      onClick={() => setActiveTab(value)}
      className={cn(
        "px-4 py-2 text-[0.9rem] font-medium transition-colors",
        isActive
          ? "border-b-2 border-lav-600 text-lav-600 dark:border-lav-400 dark:text-lav-400"
          : "text-ink-2 hover:text-ink dark:text-gray-400 dark:hover:text-gray-100",
        className
      )}
    >
      {children}
    </button>
  );
}

interface TabsContentProps {
  value: string;
  children: ReactNode;
  activeTab: string;
  className?: string;
}

export function TabsContent({ value, children, activeTab, className }: TabsContentProps) {
  if (activeTab !== value) return null;

  return <div className={cn("", className)}>{children}</div>;
}
