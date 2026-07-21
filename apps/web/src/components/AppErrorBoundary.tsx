import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button } from "./ui/Button";

type AppErrorBoundaryProps = {
  children: ReactNode;
};

type AppErrorBoundaryState = {
  error: Error | null;
};

export class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): AppErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Adfix interface error", { error, componentStack: info.componentStack });
  }

  private recover = () => {
    this.setState({ error: null });
    window.location.assign("/");
  };

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <main className="fatal-error-page" id="main-content">
        <p className="eyebrow">Recoverable error</p>
        <h1>This page could not be displayed</h1>
        <p>Your work was not deleted. Return to the workspace and try the action again.</p>
        <div className="inline-actions">
          <Button variant="primary" onClick={this.recover}>Return to workspace</Button>
          <Button variant="secondary" onClick={() => window.location.reload()}>Reload page</Button>
        </div>
      </main>
    );
  }
}
