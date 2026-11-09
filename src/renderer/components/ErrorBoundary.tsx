// Keeps one broken workspace from blanking the whole window: the sidebar, top bar and Save keep
// working, and the page shows what went wrong with a way back.

import { Component, type ReactNode } from "react";

interface Props { children: ReactNode; resetKey: string; onBack(): void }
interface State { error: Error | null; key: string }

export class WorkspaceErrorBoundary extends Component<Props, State> {
  state: State = { error: null, key: this.props.resetKey };

  static getDerivedStateFromError(error: unknown): Partial<State> {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    // Switching to another workspace gives it a fresh start.
    return props.resetKey !== state.key ? { error: null, key: props.resetKey } : null;
  }

  componentDidCatch(error: unknown) {
    console.error("Workspace crashed:", error);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="page" data-testid="workspace-error" role="alert">
        <h2>This page ran into a problem</h2>
        <p>{this.state.error.message}</p>
        <p>Your project is still open and can be saved. Undo (Ctrl+Z) may remove the change that caused this.</p>
        <p>
          <button className="btn primary" onClick={() => this.setState({ error: null })}>Try again</button>{" "}
          <button className="btn plain" onClick={this.props.onBack}>Go to Home</button>
        </p>
      </div>
    );
  }
}
