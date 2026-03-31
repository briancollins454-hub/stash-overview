import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface Props {
    children: ReactNode;
    fallbackTitle?: string;
}

interface State {
    hasError: boolean;
    error: Error | null;
}

class ErrorBoundary extends Component<Props, State> {
    state: State = { hasError: false, error: null };

    static getDerivedStateFromError(error: Error): State {
        return { hasError: true, error };
    }

    componentDidCatch(error: Error, info: ErrorInfo) {
        console.error('[ErrorBoundary]', error, info.componentStack);
    }

    handleReset = () => {
        this.setState({ hasError: false, error: null });
    };

    render() {
        if (this.state.hasError) {
            return (
                <div className="flex flex-col items-center justify-center p-8 text-center bg-red-50 border border-red-200 rounded-2xl m-4">
                    <AlertTriangle className="w-10 h-10 text-red-500 mb-3" />
                    <h3 className="text-sm font-bold uppercase tracking-widest text-red-700 mb-1">
                        {this.props.fallbackTitle || 'Something went wrong'}
                    </h3>
                    <p className="text-xs text-red-500 mb-4 max-w-md">
                        {this.state.error?.message || 'An unexpected error occurred in this section.'}
                    </p>
                    <button
                        onClick={this.handleReset}
                        className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-xl text-xs font-bold uppercase tracking-widest hover:bg-red-700 transition-colors"
                    >
                        <RefreshCw className="w-3 h-3" />
                        Try Again
                    </button>
                </div>
            );
        }

        return this.props.children;
    }
}

export default ErrorBoundary;
