import { Component, type ReactNode } from 'react';
import { useRouteError, isRouteErrorResponse } from 'react-router-dom';

/**
 * Class-based error boundary for catching render errors in child components.
 */
interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<
  { children: ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: '2rem' }}>
          <h2>Something went wrong</h2>
          <p style={{ color: 'var(--text-muted)', marginTop: '0.5rem' }}>
            {this.state.error?.message || 'An unexpected error occurred.'}
          </p>
          <button
            className="btn"
            style={{ marginTop: '1rem' }}
            onClick={() => this.setState({ hasError: false, error: null })}
          >
            Try Again
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

/**
 * Route-level error element for react-router errorElement prop.
 * Displays route errors (404s, thrown responses, etc.) with a friendly UI.
 */
export function RouteErrorBoundary() {
  const error = useRouteError();

  let title = 'Something went wrong';
  let message = 'An unexpected error occurred.';

  if (isRouteErrorResponse(error)) {
    title = `${error.status} ${error.statusText}`;
    message = error.data?.message || error.statusText;
  } else if (error instanceof Error) {
    message = error.message;
  }

  return (
    <div style={{ padding: '2rem' }}>
      <h2>{title}</h2>
      <p style={{ color: 'var(--text-muted)', marginTop: '0.5rem' }}>
        {message}
      </p>
      <button
        className="btn"
        style={{ marginTop: '1rem' }}
        onClick={() => window.location.reload()}
      >
        Reload Page
      </button>
    </div>
  );
}
