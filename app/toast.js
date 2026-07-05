"use client";

import { createContext, useCallback, useContext, useRef, useState } from "react";
import { CheckCircle2, XCircle, Info, X } from "lucide-react";
import { cn } from "@/lib/utils";

const ToastContext = createContext(() => {});

/** useToast() -> toast(message, type?) where type is "success" | "error" | "info" */
export function useToast() {
  return useContext(ToastContext);
}

const STYLES = {
  success: { accent: "text-bull", Icon: CheckCircle2, bar: "bg-bull" },
  error: { accent: "text-bear", Icon: XCircle, bar: "bg-bear" },
  info: { accent: "text-primary", Icon: Info, bar: "bg-primary" },
};

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const idRef = useRef(0);

  const dismiss = useCallback((id) => {
    setToasts((cur) => cur.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback(
    (message, type = "info", ttl = 4000) => {
      const id = ++idRef.current;
      setToasts((cur) => [...cur, { id, message, type }]);
      if (ttl) setTimeout(() => dismiss(id), ttl);
      return id;
    },
    [dismiss]
  );

  return (
    <ToastContext.Provider value={toast}>
      {children}
      <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 w-[min(360px,calc(100vw-2rem))] pointer-events-none">
        {toasts.map((t) => {
          const s = STYLES[t.type] || STYLES.info;
          const Icon = s.Icon;
          return (
            <div
              key={t.id}
              role="status"
              className="pointer-events-auto flex items-stretch gap-3 rounded-lg border bg-card text-card-foreground shadow-2xl overflow-hidden animate-toast-in"
            >
              <span className={cn("w-1 shrink-0", s.bar)} />
              <Icon className={cn("mt-3 size-4 shrink-0", s.accent)} aria-hidden="true" />
              <span className="flex-1 py-3 text-sm pr-1 break-words leading-relaxed">{t.message}</span>
              <button
                onClick={() => dismiss(t.id)}
                className="px-3 text-muted-foreground hover:text-foreground transition-colors shrink-0"
                aria-label="Dismiss notification"
              >
                <X className="size-4" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}
