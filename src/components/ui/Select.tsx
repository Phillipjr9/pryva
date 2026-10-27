import { forwardRef, type SelectHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  error?: string;
  hint?: string;
  options?: { value: string; label: string }[];
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, label, error, hint, id, options, children, ...props }, ref) => {
    const selectId = id || label?.toLowerCase().replace(/\s+/g, "-");

    return (
      <div className="space-y-1.5">
        {label && (
          <label htmlFor={selectId} className="block text-[0.86rem] font-medium text-ink">
            {label}
          </label>
        )}
        <select
          ref={ref}
          id={selectId}
          className={cn(
            "w-full rounded-xl border bg-white px-4 py-3 text-[0.95rem] text-ink outline-none transition-colors",
            error
              ? "border-red-300 focus:border-red-500"
              : "border-line focus:border-lav-600",
            className
          )}
          {...props}
        >
          {children ?? options?.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        {error && <p className="text-[0.82rem] text-red-600">{error}</p>}
        {hint && !error && <p className="text-[0.82rem] text-ink-3">{hint}</p>}
      </div>
    );
  }
);

Select.displayName = "Select";
