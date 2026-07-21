import * as RadixDialog from "@radix-ui/react-dialog";
import { ReactNode } from "react";
import { X } from "lucide-react";

type DialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  size?: "md" | "lg" | "xl";
};

export function Dialog({ open, onOpenChange, title, description, children, footer, size = "md" }: DialogProps) {
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="ui-dialog-overlay" />
        <RadixDialog.Content className={`ui-dialog-content ui-dialog-${size}`}>
          <header className="ui-dialog-header">
            <div>
              <RadixDialog.Title>{title}</RadixDialog.Title>
              {description ? <RadixDialog.Description>{description}</RadixDialog.Description> : null}
            </div>
            <RadixDialog.Close className="ui-icon-button" aria-label="Close dialog">
              <X size={16} />
            </RadixDialog.Close>
          </header>
          <div className="ui-dialog-body">{children}</div>
          {footer ? <footer className="ui-dialog-footer">{footer}</footer> : null}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
