import { HTMLAttributes, ReactNode } from "react";

type PanelProps = HTMLAttributes<HTMLElement> & {
  title?: string;
  description?: string;
  action?: ReactNode;
};

export function Panel({ title, description, action, className = "", children, ...props }: PanelProps) {
  return (
    <section className={`ui-panel ${className}`.trim()} {...props}>
      {title || description || action ? (
        <header className="ui-panel-header">
          <div>
            {title ? <h3>{title}</h3> : null}
            {description ? <p>{description}</p> : null}
          </div>
          {action ? <div className="ui-panel-action">{action}</div> : null}
        </header>
      ) : null}
      <div className="ui-panel-body">{children}</div>
    </section>
  );
}
