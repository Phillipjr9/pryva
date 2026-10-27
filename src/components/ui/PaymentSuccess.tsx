"use client";

import { useEffect } from "react";
import { CheckCircle } from "@/components/icons";
import { fireConfetti } from "@/components/ui/Confetti";

interface PaymentSuccessProps {
  show: boolean;
  title?: string;
  message?: string;
  redirectUrl?: string;
  redirectDelay?: number;
  onRedirect?: () => void;
}

export function PaymentSuccess({
  show,
  title = "Payment Successful!",
  message = "Your order has been processed successfully.",
  redirectUrl = "/dashboard",
  redirectDelay = 2000,
  onRedirect,
}: PaymentSuccessProps) {
  useEffect(() => {
    if (show) {
      // Fire confetti celebration
      fireConfetti();

      // Redirect after delay
      const timer = setTimeout(() => {
        if (onRedirect) {
          onRedirect();
        } else {
          window.location.href = redirectUrl;
        }
      }, redirectDelay);

      return () => clearTimeout(timer);
    }
  }, [show, redirectUrl, redirectDelay, onRedirect]);

  if (!show) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="mx-4 max-w-md rounded-2xl bg-white p-8 shadow-2xl animate-in fade-in zoom-in duration-300">
        <div className="text-center">
          {/* Animated Checkmark */}
          <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-emerald-100 animate-in zoom-in duration-500 delay-200">
            <CheckCircle className="h-12 w-12 text-emerald-600 animate-in fade-in duration-500 delay-300" />
          </div>

          {/* Success Message */}
          <h2 className="mb-2 text-2xl font-bold text-ink animate-in slide-in-from-bottom duration-500 delay-400">
            {title}
          </h2>
          <p className="mb-6 text-ink-2 animate-in slide-in-from-bottom duration-500 delay-500">
            {message}
          </p>

          {/* Redirect Notice */}
          <div className="animate-in fade-in duration-500 delay-700">
            <p className="text-sm text-ink-3 mb-3">
              Redirecting to your dashboard...
            </p>
            <div className="mx-auto h-1 w-32 overflow-hidden rounded-full bg-gray-200">
              <div className="h-full bg-lav-600 animate-progress" />
            </div>
          </div>
        </div>
      </div>

      <style jsx>{`
        @keyframes progress {
          from {
            width: 0%;
          }
          to {
            width: 100%;
          }
        }
        .animate-progress {
          animation: progress ${redirectDelay}ms ease-out forwards;
        }
      `}</style>
    </div>
  );
}
