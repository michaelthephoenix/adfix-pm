import { ReactNode } from "react";

type PageHeaderProps = {
  title: string;
  description?: string;
  actions?: ReactNode;
  meta?: ReactNode;
};

export function PageHeader({ title, description, actions, meta }: PageHeaderProps) {
  return (
    <header className="ui-page-header">
      <div className="ui-page-heading">
        <div className="ui-page-title-row">
          <h2>{title}</h2>
          {meta ? <div className="ui-page-meta">{meta}</div> : null}
        </div>
        {description ? <p>{description}</p> : null}
      </div>
      {actions ? <div className="ui-page-actions">{actions}</div> : null}
    </header>
  );
}
