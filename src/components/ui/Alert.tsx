import { type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { CheckCircle, AlertCircle, Info, XCircle } from "@/components/icons";

interface AlertProps {
  variant?: "success" | "error" | "warning" | "info";
  title?: string;
  children: ReactNode;
  className?: string;
}

export function Alert({ variant = "info", title, children, className }: AlertProps) {
  const icons = {
    success: CheckCircle,
    error: XCircle,
    warning: AlertCircle,
    info: Info,
  };

  const Icon = icons[variant];

  return (
    <div
      className={cn(
        "rounded-xl border p-4",
        {
          "border-green-200 bg-green-50": variant === "success",
          "border-red-200 bg-red-50": variant === "error",
          "border-yellow-200 bg-yellow-50": variant === "warning",
          "border-blue-200 bg-blue-50": variant === "info",
        },
        className
      )}
    >
      <div className="flex gap-3">
        <Icon
          className={cn("h-5 w-5 shrink-0", {
            "text-green-600": variant === "success",
            "text-red-600": variant === "error",
            "text-yellow-600": variant === "warning",
            "text-blue-600": variant === "info",
          })}
        />
        <div className="flex-1">
          {title && (
            <p
              className={cn("text-[0.9rem] font-semibold mb-1", {
                "text-green-700": variant === "success",
                "text-red-700": variant === "error",
                "text-yellow-700": variant === "warning",
                "text-blue-700": variant === "info",
              })}
            >
              {title}
            </p>
          )}
          <div
            className={cn("text-[0.86rem]", {
              "text-green-600": variant === "success",
              "text-red-600": variant === "error",
              "text-yellow-600": variant === "warning",
              "text-blue-600": variant === "info",
            })}
          >
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}
