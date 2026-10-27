import { forwardRef, type InputHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  hint?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, label, error, hint, id, ...props }, ref) => {
    const inputId = id || label?.toLowerCase().replace(/\s+/g, "-");

    return (
      <div className="space-y-1.5">
        {label && (
          <label htmlFor={inputId} className="block text-[0.86rem] font-medium text-ink">
            {label}
          </label>
        )}
        <input
          ref={ref}
          id={inputId}
          className={cn(
            "w-full rounded-xl border bg-white px-4 py-3 text-[0.95rem] text-ink outline-none transition-colors",
            error
              ? "border-red-300 focus:border-red-500"
              : "border-line focus:border-lav-600",
            className
          )}
          {...props}
        />
        {error && <p className="text-[0.82rem] text-red-600">{error}</p>}
        {hint && !error && <p className="text-[0.82rem] text-ink-3">{hint}</p>}
      </div>
    );
  }
);

Input.displayName = "Input";
