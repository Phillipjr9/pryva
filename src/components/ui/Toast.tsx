"use client";

import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { CheckCircle, XCircle, AlertCircle, Info, Close } from "@/components/icons";

type ToastType = "success" | "error" | "warning" | "info";

interface Toast {
  id: string;
  type: ToastType;
  message: string;
  duration?: number;
}

interface ToastContextType {
  toasts: Toast[];
  addToast: (toast: Omit<Toast, "id">) => void;
  removeToast: (id: string) => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

const TOAST_EVENT = "pryva:toast";

type ToastPayload = { type: ToastType; message: string; duration?: number };

function emitToast(payload: ToastPayload) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<ToastPayload>(TOAST_EVENT, { detail: payload }));
}

/**
 * Imperative toast helper. Works from anywhere — including event handlers in
 * components that never rendered the provider — because it goes through a DOM
 * event that ToastProvider listens for.
 */
export const toast = {
  success: (message: string, duration?: number) => emitToast({ type: "success", message, duration }),
  error: (message: string, duration?: number) => emitToast({ type: "error", message, duration }),
  warning: (message: string, duration?: number) => emitToast({ type: "warning", message, duration }),
  info: (message: string, duration?: number) => emitToast({ type: "info", message, duration }),
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const addToast = useCallback((toast: Omit<Toast, "id">) => {
    const id = Math.random().toString(36).substring(2);
    const newToast = { ...toast, id };
    setToasts((prev) => [...prev, newToast]);

    const duration = toast.duration || 5000;
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, duration);
  }, []);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  useEffect(() => {
    function onToast(event: Event) {
      const detail = (event as CustomEvent<ToastPayload>).detail;
      if (detail?.message) addToast({ type: detail.type, message: detail.message, duration: detail.duration });
    }
    window.addEventListener(TOAST_EVENT, onToast);
    return () => window.removeEventListener(TOAST_EVENT, onToast);
  }, [addToast]);

  return (
    <ToastContext.Provider value={{ toasts, addToast, removeToast }}>
      {children}
      <ToastContainer toasts={toasts} removeToast={removeToast} />
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used within a ToastProvider");
  }
  return context;
}

interface ToastContainerProps {
  toasts: Toast[];
  removeToast: (id: string) => void;
}

function ToastContainer({ toasts, removeToast }: ToastContainerProps) {
  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-[200] flex flex-col gap-2 max-w-sm">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onClose={() => removeToast(toast.id)} />
      ))}
    </div>
  );
}

interface ToastItemProps {
  toast: Toast;
  onClose: () => void;
}

function ToastItem({ toast, onClose }: ToastItemProps) {
  const icons = {
    success: CheckCircle,
    error: XCircle,
    warning: AlertCircle,
    info: Info,
  };

  const Icon = icons[toast.type];

  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-xl border p-4 shadow-lg animate-in slide-in-from-right",
        {
          "border-green-200 bg-green-50": toast.type === "success",
          "border-red-200 bg-red-50": toast.type === "error",
          "border-yellow-200 bg-yellow-50": toast.type === "warning",
          "border-blue-200 bg-blue-50": toast.type === "info",
        }
      )}
    >
      <Icon
        className={cn("h-5 w-5 shrink-0 mt-0.5", {
          "text-green-600": toast.type === "success",
          "text-red-600": toast.type === "error",
          "text-yellow-600": toast.type === "warning",
          "text-blue-600": toast.type === "info",
        })}
      />
      <p
        className={cn("flex-1 text-[0.86rem]", {
          "text-green-700": toast.type === "success",
          "text-red-700": toast.type === "error",
          "text-yellow-700": toast.type === "warning",
          "text-blue-700": toast.type === "info",
        })}
      >
        {toast.message}
      </p>
      <button
        onClick={onClose}
        className={cn("shrink-0 rounded-lg p-1 hover:bg-black/5", {
          "text-green-600": toast.type === "success",
          "text-red-600": toast.type === "error",
          "text-yellow-600": toast.type === "warning",
          "text-blue-600": toast.type === "info",
        })}
      >
        <Close className="h-4 w-4" />
      </button>
    </div>
  );
}
