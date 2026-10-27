"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle, Clock } from "@/components/icons";

type State = "idle" | "verifying" | "credited" | "pending" | "failed";

/**
 * Handles the redirect back from Paystack.
 *
 * The `?topup=success` flag is only a hint — real credit comes from
 * /api/wallet/topup/verify, which asks Paystack whether the charge actually
 * succeeded. That call is idempotent, so a refresh is harmless.
 */
export function TopUpReturn({
  status,
  reference,
}: {
  status?: string;
  reference?: string;
}) {
  const router = useRouter();
  const [state, setState] = useState<State>(status === "success" ? "verifying" : "idle");
  const [message, setMessage] = useState<string>("");
  const attempted = useRef(false);

  useEffect(() => {
    if (status !== "success" || attempted.current) return;
    attempted.current = true;

    if (!reference) {
      setState("pending");
      setMessage("We're confirming your payment. Your balance updates in a moment.");
      router.refresh();
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        const response = await fetch("/api/wallet/topup/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reference }),
        });
        const data = (await response.json()) as {
          ok?: boolean;
          credited?: boolean;
          reason?: string;
          error?: string;
        };

        if (cancelled) return;

        if (response.ok && data.ok) {
          setState(data.credited === false && data.reason === "already_credited" ? "credited" : "credited");
          setMessage(
            data.credited === false
              ? "This payment was already added to your wallet."
              : "Payment confirmed — your wallet has been funded.",
          );
        } else if (response.status === 402) {
          setState("failed");
          setMessage(data.error ?? "That payment wasn't successful.");
        } else {
          setState("pending");
          setMessage(
            data.error ??
              "We couldn't confirm the payment yet. If you were charged, it lands in your wallet automatically.",
          );
        }
      } catch {
        if (!cancelled) {
          setState("pending");
          setMessage("We couldn't confirm the payment yet. If you were charged, it lands automatically.");
        }
      } finally {
        router.refresh();
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [status, reference, router]);

  if (state === "idle") return null;

  const tone =
    state === "credited"
      ? "border-emerald-200 bg-emerald-50 text-emerald-900"
      : state === "failed"
        ? "border-red-200 bg-red-50 text-red-900"
        : "border-lav-200 bg-lav-50 text-lav-900";

  return (
    <div className={`flex items-start gap-3 rounded-2xl border px-4 py-3 text-[0.84rem] ${tone}`}>
      {state === "credited" ? (
        <CheckCircle className="mt-0.5 h-4 w-4 shrink-0" />
      ) : (
        <Clock className="mt-0.5 h-4 w-4 shrink-0" />
      )}
      <p>
        {state === "verifying" ? "Confirming your payment with the bank…" : message}
      </p>
    </div>
  );
}
