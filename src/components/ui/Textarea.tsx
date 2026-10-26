import { forwardRef, type TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
  hint?: string;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, label, error, hint, id, ...props }, ref) => {
    const textareaId = id || label?.toLowerCase().replace(/\s+/g, "-");

    return (
      <div className="space-y-1.5">
        {label && (
          <label htmlFor={textareaId} className="block text-[0.86rem] font-medium text-ink dark:text-gray-100">
            {label}
          </label>
        )}
        <textarea
          ref={ref}
          id={textareaId}
          className={cn(
            "w-full rounded-xl border bg-white px-4 py-3 text-[0.95rem] text-ink outline-none transition-colors resize-y dark:bg-gray-800 dark:text-gray-100",
            error
              ? "border-red-300 focus:border-red-500 dark:border-red-800 dark:focus:border-red-600"
              : "border-line focus:border-lav-600 dark:border-gray-700 dark:focus:border-lav-500",
            className
          )}
          {...props}
        />
        {error && <p className="text-[0.82rem] text-red-600 dark:text-red-400">{error}</p>}
        {hint && !error && <p className="text-[0.82rem] text-ink-3 dark:text-gray-500">{hint}</p>}
      </div>
    );
  }
);

Textarea.displayName = "Textarea";
