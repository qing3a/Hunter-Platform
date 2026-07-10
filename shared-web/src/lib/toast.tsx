import { createContext, useContext, useState, useCallback, useMemo, type ReactNode } from 'react';

export type ToastType = 'success' | 'error' | 'info';

export type ToastItem = {
  id: string;
  type: ToastType;
  message: string;
  expiresAt: number;
};

type ToastContextValue = {
  toasts: ToastItem[];
  push: (item: { type: ToastType; message: string; durationMs?: number }) => void;
  dismiss: (id: string) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const dismiss = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const push = useCallback((item: { type: ToastType; message: string; durationMs?: number }) => {
    const id = `toast_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const durationMs = item.durationMs ?? 3000;
    const expiresAt = Date.now() + durationMs;
    setToasts(prev => [...prev, { id, type: item.type, message: item.message, expiresAt }]);
    if (durationMs > 0) {
      setTimeout(() => dismiss(id), durationMs);
    }
  }, [dismiss]);

  // Memoise the context value so consumer components don't re-render on every
  // Provider render. Without this, every push/dismiss creates a new object and
  // forces all consumers (incl. pages) to re-render, which can cause useEffect
  // dependency loops → "stuck loading" symptom.
  const value = useMemo<ToastContextValue>(
    () => ({ toasts, push, dismiss }),
    [toasts, push, dismiss],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error('useToast must be used within <ToastProvider>');
  }
  return ctx;
}