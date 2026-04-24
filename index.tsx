import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import './app.css';
import App from './App';
import ErrorBoundary from './components/ErrorBoundary';
import { installAuthFetchInterceptor } from './services/authInterceptor';
import { installDebugLogger } from './services/debugLogger';

// Debug logger FIRST so it can wrap window.fetch before the auth interceptor
// does — then every request is traced through both layers. Opt-in only:
// visit with `?debug=1` or run `localStorage.setItem('stash_debug','1')`.
installDebugLogger();

// Install BEFORE React renders so no /api/* request can go out before the
// interceptor is active. Currently backends ignore these headers, so this
// change is invisible; Phase B of the auth hardening will start validating
// them route-by-route.
installAuthFetchInterceptor();

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <ErrorBoundary fallbackTitle="The dashboard hit a problem">
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </ErrorBoundary>
  </React.StrictMode>
);