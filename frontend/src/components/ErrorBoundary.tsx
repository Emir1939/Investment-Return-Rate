import React from 'react';

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('ErrorBoundary caught:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          style={{
            minHeight: '100vh',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            alignItems: 'center',
            background: '#0d0d0d',
            color: '#f5f5f5',
            fontFamily: 'Inter, sans-serif',
            padding: '40px',
          }}
        >
          <h2 style={{ marginBottom: '16px', color: '#ef5350' }}>
            Something went wrong
          </h2>
          <p style={{ color: '#a0a0a0', marginBottom: '24px', maxWidth: '500px', textAlign: 'center' }}>
            {this.state.error?.message || 'An unexpected error occurred.'}
          </p>
          <button
            onClick={() => {
              this.setState({ hasError: false, error: null });
              window.location.href = '/market';
            }}
            style={{
              padding: '10px 24px',
              border: '1px solid #444',
              borderRadius: '8px',
              background: '#1a1a1a',
              color: '#f5f5f5',
              cursor: 'pointer',
              fontSize: '14px',
            }}
          >
            Go to Market
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
