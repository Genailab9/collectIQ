"use client";

import { ReactNode, createContext, useCallback, useContext, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Button } from "@/components/ui/button";

type ToastVariant = "success" | "error" | "info" | "warning";

type ToastItem = {
  id: string;
  title: string;
  description?: string;
  variant: ToastVariant;
  actionLabel?: string;
  onAction?: () => void;
};

type ToastContextValue = {
  showToast: (toast: Omit<ToastItem, "id">) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

function toastBg(variant: ToastVariant): string {
  if (variant === "success") return "border-emerald-400/60 bg-emerald-500/15 text-emerald-100";
  if (variant === "error") return "border-red-400/60 bg-red-500/15 text-red-100";
  if (variant === "warning") return "border-amber-400/60 bg-amber-500/15 text-amber-100";
  return "border-blue-400/60 bg-blue-500/15 text-blue-100";
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const showToast = useCallback((toast: Omit<ToastItem, "id">) => {
    const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    setToasts((prev) => [...prev, { ...toast, id }]);
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3500);
  }, []);

  const value = useMemo(() => ({ showToast }), [showToast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-50 space-y-2">
        <AnimatePresence initial={false}>
          {toasts.map((toast) => (
            <motion.div
              key={toast.id}
              initial={{ opacity: 0, x: 24, y: 8 }}
              animate={{ opacity: 1, x: 0, y: 0 }}
              exit={{ opacity: 0, x: 16, y: 8 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
              className={`pointer-events-auto w-[340px] rounded-xl border px-3 py-2 shadow-lg backdrop-blur-md ${toastBg(toast.variant)}`}
            >
              <div className="text-sm font-semibold">{toast.title}</div>
              {toast.description ? (
                <div className="mt-1 text-xs opacity-95">{toast.description}</div>
              ) : null}
              <div className="mt-2 flex justify-end gap-2">
                {toast.actionLabel && toast.onAction ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      toast.onAction?.();
                      setToasts((prev) => prev.filter((t) => t.id !== toast.id));
                    }}
                  >
                    {toast.actionLabel}
                  </Button>
                ) : null}
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setToasts((prev) => prev.filter((t) => t.id !== toast.id))}
                >
                  Dismiss
                </Button>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error("useToast must be used within ToastProvider.");
  }
  return ctx;
}

