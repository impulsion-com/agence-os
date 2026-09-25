"use client";

import { createContext, useCallback, useContext, useState, type ReactNode } from "react";

interface ToastItem {
  id: number;
  msg: string;
  error?: boolean;
  action?: { label: string; run: () => void };
}

const Ctx = createContext<(msg: string, opt?: { error?: boolean; action?: ToastItem["action"] }) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const toast = useCallback((msg: string, opt: { error?: boolean; action?: ToastItem["action"] } = {}) => {
    const id = Date.now() + Math.random();
    setItems((s) => [...s.slice(-3), { id, msg, ...opt }]);
    setTimeout(() => setItems((s) => s.filter((x) => x.id !== id)), opt.action ? 6000 : 3500);
  }, []);
  return (
    <Ctx.Provider value={toast}>
      {children}
      <div className="toasts" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`toast${t.error ? " error" : ""}`}>
            <span>{t.msg}</span>
            {t.action && (
              <button
                onClick={() => {
                  t.action!.run();
                  setItems((s) => s.filter((x) => x.id !== t.id));
                }}
              >
                {t.action.label}
              </button>
            )}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export const useToast = () => useContext(Ctx);
