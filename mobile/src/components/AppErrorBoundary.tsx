import { Component, type ErrorInfo, type ReactNode } from 'react';

import { ErrorState } from '@/components/Feedback';
import { Screen } from '@/ui/Screen';

/**
 * AppErrorBoundary — the last line of defence above the navigator.
 *
 * A render error anywhere below lands on the generic ErrorState instead of a
 * blank screen; its retry button clears the caught error so the tree mounts
 * again from scratch.
 */
export interface AppErrorBoundaryProps {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class AppErrorBoundary extends Component<AppErrorBoundaryProps, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // ponytail: console only; hook a crash reporter here when one is wired.
    console.error(error, info.componentStack);
  }

  reset = () => this.setState({ error: null });

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <Screen bottomInset>
        <ErrorState kind="generic" onRetry={this.reset} />
      </Screen>
    );
  }
}
