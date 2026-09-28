import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { Alert, AlertDescription } from '@cognite/aura/components';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  override render(): ReactNode {
    if (this.state.error) {
      return (
        <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-8">
          <Alert variant="error" role="alert">
            <AlertDescription>
              Something went wrong: {this.state.error.message}
            </AlertDescription>
          </Alert>
          <button
            className="text-sm text-muted-foreground underline"
            onClick={() => this.setState({ error: null })}
          >
            Try again
          </button>
        </main>
      );
    }
    return this.props.children;
  }
}
