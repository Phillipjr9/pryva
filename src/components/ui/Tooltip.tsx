"use client";

import { useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

interface TooltipProps {
  content: string;
  children: ReactNode;
  position?: "top" | "bottom" | "left" | "right";
  className?: string;
}

export function Tooltip({ content, children, position = "top", className }: TooltipProps) {
  const [isVisible, setIsVisible] = useState(false);

  const positionClasses = {
    top: "bottom-full left-1/2 -translate-x-1/2 mb-2",
    bottom: "top-full left-1/2 -translate-x-1/2 mt-2",
    left: "right-full top-1/2 -translate-y-1/2 mr-2",
    right: "left-full top-1/2 -translate-y-1/2 ml-2",
  };

  return (
    <div
      className="relative inline-block"
      onMouseEnter={() => setIsVisible(true)}
      onMouseLeave={() => setIsVisible(false)}
    >
      {children}
      {isVisible && (
        <div
          className={cn(
            "absolute z-50 rounded-lg bg-ink px-3 py-2 text-meta font-medium text-white shadow-lg whitespace-nowrap",
            positionClasses[position],
            className
          )}
        >
          {content}
        </div>
      )}
    </div>
  );
}
