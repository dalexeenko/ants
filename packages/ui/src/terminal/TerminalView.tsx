import React from 'react';
import { Platform } from 'react-native';
import { RemoteTerminal, type RemoteTerminalProps } from './RemoteTerminal';

// Lazy-import the xterm.js version only on web, so Metro never sees it.
const XtermTerminal = Platform.OS === 'web'
  ? React.lazy(() => import('./XtermTerminal').then(m => ({ default: m.XtermTerminal })))
  : null;

/**
 * Platform-aware terminal component.
 * - Web/Desktop: uses xterm.js for full terminal emulation
 * - Mobile: uses the Text-based RemoteTerminal fallback
 */
export function TerminalView(props: RemoteTerminalProps) {
  if (XtermTerminal) {
    return (
      <React.Suspense fallback={null}>
        <XtermTerminal {...props} />
      </React.Suspense>
    );
  }

  return <RemoteTerminal {...props} />;
}
