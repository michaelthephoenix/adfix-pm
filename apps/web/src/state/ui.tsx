import * as AlertDialog from "@radix-ui/react-alert-dialog";
import { createContext, useContext, useMemo, useState } from "react";
import { CircleHelp, TriangleAlert, Trash2 } from "lucide-react";

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
  tone: "default" | "warning" | "danger";
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
    tone?: "default" | "warning" | "danger";
  }) => Promise<boolean>;
};

const UIContext = createContext<UIContextValue | undefined>(undefined);

export function UIProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [confirmState, setConfirmState] = useState<ConfirmState>(null);

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
        tone: input.tone ?? "default",
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

  const resolveConfirmation = (confirmed: boolean) => {
    confirmState?.resolve(confirmed);
    setConfirmState(null);
  };

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
      <AlertDialog.Root
        open={Boolean(confirmState)}
        onOpenChange={(open) => { if (!open && confirmState) resolveConfirmation(false); }}
      >
        <AlertDialog.Portal>
          <AlertDialog.Overlay className="modal-backdrop" />
          {confirmState ? (
          <AlertDialog.Content className={`confirm-card confirm-${confirmState.tone}`}>
            <div className="confirm-heading">
              <span className="confirm-icon" aria-hidden="true">
                {confirmState.tone === "danger" ? <Trash2 size={18} /> : confirmState.tone === "warning" ? <TriangleAlert size={18} /> : <CircleHelp size={18} />}
              </span>
              <div>
                <AlertDialog.Title>{confirmState.title}</AlertDialog.Title>
                <AlertDialog.Description>{confirmState.message}</AlertDialog.Description>
              </div>
            </div>
            <div className="confirm-actions">
              <AlertDialog.Cancel
                type="button"
                className="ghost-button"
                onClick={() => resolveConfirmation(false)}
              >
                {confirmState.cancelLabel}
              </AlertDialog.Cancel>
              <AlertDialog.Action
                type="button"
                className={confirmState.tone === "danger" ? "confirm-button confirm-button-danger" : confirmState.tone === "warning" ? "confirm-button confirm-button-warning" : "primary-button"}
                onClick={() => resolveConfirmation(true)}
              >
                {confirmState.confirmLabel}
              </AlertDialog.Action>
            </div>
          </AlertDialog.Content>
          ) : null}
        </AlertDialog.Portal>
      </AlertDialog.Root>
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
