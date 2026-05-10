import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';

// Global error handlers to catch unhandled errors
window.addEventListener('error', (event) => {
  console.error('Unhandled error:', event.error);
});

window.addEventListener('unhandledrejection', (event) => {
  console.error('Unhandled promise rejection:', event.reason);
});

// Suppress React Native Web's "Unexpected text node" warning in development
// This is a known issue with React Native Web where fragments or conditional
// rendering can sometimes produce transient text nodes during re-renders
const originalConsoleError = console.error;
console.error = (...args: unknown[]) => {
  if (typeof args[0] === 'string' && args[0].includes('Unexpected text node')) {
    return; // Suppress this specific warning
  }
  originalConsoleError.apply(console, args);
};

// Clear old zustand persist storage - backend is now the source of truth
// This prevents duplicate projects from appearing after removing persist middleware
localStorage.removeItem('openmgr-project-store');

const container = document.getElementById('root');
if (!container) {
  throw new Error('Root element not found');
}

const root = createRoot(container);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
