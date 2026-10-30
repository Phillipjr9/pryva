"use client";

import { useId, useState, type InputHTMLAttributes } from "react";
import { Eye, EyeOff } from "@/components/icons";

type PasswordInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type">;

/**
 * A password field with a reveal toggle.
 *
 * Every password input in the app was a bare `type="password"` with no way to
 * check what had been typed. On a phone keyboard that means a mistyped password
 * is discovered only by a failed sign-in — and on the reset and settings forms,
 * only after the new password has already been saved, which is how people lock
 * themselves out of an account they just recovered.
 *
 * `type` is omitted from the props so a caller cannot pin the field to one mode
 * and silently lose the toggle. The button is a real button with an accessible
 * name and a pressed state rather than a decorative icon, because revealing the
 * value is the entire point of it.
 */
export function PasswordInput({ className = "field", id, ...props }: PasswordInputProps) {
  const [revealed, setRevealed] = useState(false);
  const generatedId = useId();
  const inputId = id ?? generatedId;

  return (
    <div className="relative">
      <input
        {...props}
        id={inputId}
        type={revealed ? "text" : "password"}
        // `field` sets padding with a shorthand inside @layer components, so the
        // utility wins and keeps typed text out from under the button.
        className={`${className} pr-11`}
      />
      <button
        type="button"
        onClick={() => setRevealed((value) => !value)}
        aria-pressed={revealed}
        aria-controls={inputId}
        aria-label={revealed ? "Hide password" : "Show password"}
        title={revealed ? "Hide password" : "Show password"}
        // Inset rather than flush to the edge: the app has two field styles
        // (.field at 0.9rem radius, and the reset form's own rounded-xl), and an
        // inset transparent button matches both without guessing a radius.
        className="absolute inset-y-1 right-1 grid w-9 place-items-center rounded-lg text-ink-3 transition-colors hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lav-500"
      >
        {revealed ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  );
}
