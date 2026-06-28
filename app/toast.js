"use client";

import { createContext, useCallback, useContext, useRef, useState } from "react";

const ToastContext = createContext(() => {});

/** useToast() -> toast(message, type?) where type is "success" | "error" | "info" */
export function useToast() {
  return useContext(ToastContext);
}

const STYLES = {
  success: { bar: "bg-bull", icon: "✓", text: "text-bull" },
  error: { bar: "bg-bear", icon: "✕", text: "text-bear" },
  info: { bar: "bg-accent", icon: "ℹ", text: "text-accent" },
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
          return (
            <div
              key={t.id}
              role="status"
              className="pointer-events-auto flex items-start gap-3 rounded-lg border border-border bg-panel shadow-2xl overflow-hidden animate-toast-in"
            >
              <span className={`w-1 self-stretch ${s.bar}`} />
              <span className={`pt-3 text-sm font-bold ${s.text}`}>{s.icon}</span>
              <span className="flex-1 py-3 text-sm text-ink pr-1 break-words">{t.message}</span>
              <button
                onClick={() => dismiss(t.id)}
                className="px-3 py-3 text-muted hover:text-ink text-sm shrink-0"
                aria-label="Dismiss"
              >
                ✕
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}
