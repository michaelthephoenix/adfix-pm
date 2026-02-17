import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";

type ToastKind = "success" | "error" | "info";

type ToastItem = {
  id: number;
  message: string;
  kind: ToastKind;
};

type ConfirmState = {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  resolve: (value: boolean) => void;
} | null;

type UIContextValue = {
  toast: (message: string, kind?: ToastKind) => void;
  success: (message: string) => void;
  error: (message: string) => void;
  confirm: (input: {
    title: string;
    message: string;
    confirmLabel?: string;
    cancelLabel?: string;
  }) => Promise<boolean>;
};

const UIContext = createContext<UIContextValue | undefined>(undefined);

export function UIProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [confirmState, setConfirmState] = useState<ConfirmState>(null);
  const confirmButtonRef = useRef<HTMLButtonElement | null>(null);

  const toast = (message: string, kind: ToastKind = "info") => {
    const id = Date.now() + Math.floor(Math.random() * 1000);
    setToasts((previous) => [...previous, { id, message, kind }]);
    setTimeout(() => {
      setToasts((previous) => previous.filter((item) => item.id !== id));
    }, 3200);
  };

  const confirm: UIContextValue["confirm"] = (input) =>
    new Promise<boolean>((resolve) => {
      setConfirmState({
        title: input.title,
        message: input.message,
        confirmLabel: input.confirmLabel ?? "Confirm",
        cancelLabel: input.cancelLabel ?? "Cancel",
        resolve
      });
    });

  const value = useMemo<UIContextValue>(
    () => ({
      toast,
      success: (message) => toast(message, "success"),
      error: (message) => toast(message, "error"),
      confirm
    }),
    []
  );

  useEffect(() => {
    if (!confirmState) return;
    confirmButtonRef.current?.focus();
  }, [confirmState]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (!confirmState) return;
      confirmState.resolve(false);
      setConfirmState(null);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [confirmState]);

  return (
    <UIContext.Provider value={value}>
      {children}
      <div className="toast-stack" aria-live="polite">
        {toasts.map((item) => (
          <div key={item.id} className={`toast toast-${item.kind}`}>
            {item.message}
          </div>
        ))}
      </div>
      {confirmState ? (
        <div className="modal-backdrop" role="presentation">
          <div className="confirm-card" role="dialog" aria-modal="true" aria-labelledby="confirm-dialog-title">
            <h3 id="confirm-dialog-title">{confirmState.title}</h3>
            <p className="muted">{confirmState.message}</p>
            <div className="inline-actions">
              <button
                ref={confirmButtonRef}
                type="button"
                className="primary-button"
                onClick={() => {
                  confirmState.resolve(true);
                  setConfirmState(null);
                }}
              >
                {confirmState.confirmLabel}
              </button>
              <button
                type="button"
                className="ghost-button"
                onClick={() => {
                  confirmState.resolve(false);
                  setConfirmState(null);
                }}
              >
                {confirmState.cancelLabel}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </UIContext.Provider>
  );
}

export function useUI() {
  const context = useContext(UIContext);
  if (!context) {
    throw new Error("useUI must be used within UIProvider");
  }
  return context;
}
