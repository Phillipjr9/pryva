import { forwardRef, type InputHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
  label?: string;
  error?: string;
}

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(
  ({ className, label, error, id, ...props }, ref) => {
    const checkboxId = id || label?.toLowerCase().replace(/\s+/g, "-");

    return (
      <div className="space-y-1">
        <div className="flex items-start gap-2">
          <input
            ref={ref}
            type="checkbox"
            id={checkboxId}
            className={cn(
              "mt-0.5 h-4 w-4 rounded border-line text-lav-600 focus:ring-lav-600 dark:border-gray-600 dark:bg-gray-800 dark:text-lav-500 dark:focus:ring-lav-500",
              error && "border-red-300 dark:border-red-800",
              className
            )}
            {...props}
          />
          {label && (
            <label htmlFor={checkboxId} className="text-[0.86rem] text-ink dark:text-gray-100 cursor-pointer">
              {label}
            </label>
          )}
        </div>
        {error && <p className="text-[0.82rem] text-red-600 dark:text-red-400">{error}</p>}
      </div>
    );
  }
);

Checkbox.displayName = "Checkbox";
