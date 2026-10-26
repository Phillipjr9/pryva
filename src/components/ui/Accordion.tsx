"use client";

import { useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { ChevronDown } from "@/components/icons";

interface AccordionProps {
  children: ReactNode;
  className?: string;
}

export function Accordion({ children, className }: AccordionProps) {
  return <div className={cn("space-y-2", className)}>{children}</div>;
}

interface AccordionItemProps {
  title: string;
  children: ReactNode;
  defaultOpen?: boolean;
  className?: string;
}

export function AccordionItem({ title, children, defaultOpen = false, className }: AccordionItemProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div className={cn("rounded-xl border border-line bg-white dark:bg-gray-800 dark:border-gray-700", className)}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex w-full items-center justify-between px-4 py-3 text-left"
      >
        <span className="text-[0.95rem] font-semibold text-ink dark:text-gray-100">{title}</span>
        <ChevronDown
          className={cn(
            "h-5 w-5 text-ink-2 transition-transform dark:text-gray-400",
            isOpen && "rotate-180"
          )}
        />
      </button>
      {isOpen && (
        <div className="px-4 pb-4 text-[0.9rem] text-ink-2 leading-relaxed dark:text-gray-400">
          {children}
        </div>
      )}
    </div>
  );
}
