"use client";

import { Loader2 } from "@/components/icons";

interface PaymentLoadingProps {
  show: boolean;
  message?: string;
}

export function PaymentLoading({
  show,
  message = "Processing your payment...",
}: PaymentLoadingProps) {
  if (!show) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="mx-4 max-w-md rounded-2xl bg-white p-8 shadow-2xl animate-in fade-in zoom-in duration-300">
        <div className="text-center">
          {/* Animated Loader */}
          <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-lav-100 animate-pulse">
            <Loader2 className="h-12 w-12 text-lav-600 animate-spin" />
          </div>

          {/* Loading Message */}
          <h2 className="mb-2 text-2xl font-bold text-ink animate-in slide-in-from-bottom duration-500">
            Processing Payment
          </h2>
          <p className="mb-4 text-ink-2 animate-in slide-in-from-bottom duration-500 delay-200">
            {message}
          </p>

          {/* Animated Dots */}
          <div className="flex justify-center gap-2 animate-in fade-in duration-500 delay-300">
            <div className="h-2 w-2 rounded-full bg-lav-600 animate-bounce" style={{ animationDelay: "0ms" }} />
            <div className="h-2 w-2 rounded-full bg-lav-600 animate-bounce" style={{ animationDelay: "150ms" }} />
            <div className="h-2 w-2 rounded-full bg-lav-600 animate-bounce" style={{ animationDelay: "300ms" }} />
          </div>
        </div>
      </div>
    </div>
  );
}
