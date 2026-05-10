import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { ToastContainer } from './ToastContainer';
import { useUIStore } from '../store/uiStore';

// Mock the theme module
vi.mock('../styles/theme', async () => {
  const React = await import('react');
  const { mockLightTheme } = await import('../styles/mockTheme');
  return {
    ThemeContext: React.createContext(mockLightTheme),
    useTheme: () => mockLightTheme,
  };
});

// Mock Spinner
vi.mock('../primitives/Spinner', () => ({
  Spinner: () => <div data-testid="spinner">loading</div>,
}));

describe('ToastContainer', () => {
  beforeEach(() => {
    useUIStore.setState({ toasts: [] });
  });

  it('renders nothing when there are no toasts', () => {
    const { container } = render(<ToastContainer />);
    expect(container.firstChild).toBeNull();
  });

  it('renders toast messages', () => {
    useUIStore.setState({
      toasts: [
        { id: 't1', message: 'Success!', type: 'success' },
        { id: 't2', message: 'Error occurred', type: 'error' },
      ],
    });

    render(<ToastContainer />);
    expect(screen.getByText('Success!')).toBeInTheDocument();
    expect(screen.getByText('Error occurred')).toBeInTheDocument();
  });

  it('shows dismiss button for non-loading toasts', () => {
    useUIStore.setState({
      toasts: [{ id: 't1', message: 'Test toast', type: 'info' }],
    });

    render(<ToastContainer />);
    // The dismiss button renders "×"
    expect(screen.getByText('×')).toBeInTheDocument();
  });

  it('removes toast when dismiss button is clicked', () => {
    useUIStore.setState({
      toasts: [{ id: 't1', message: 'Test toast', type: 'info' }],
    });

    render(<ToastContainer />);

    fireEvent.click(screen.getByText('×'));
    expect(useUIStore.getState().toasts.find(t => t.id === 't1')).toBeUndefined();
  });

  it('shows spinner for loading toasts', () => {
    useUIStore.setState({
      toasts: [{ id: 't1', message: 'Loading...', type: 'info', loading: true }],
    });

    render(<ToastContainer />);
    expect(screen.getByTestId('spinner')).toBeInTheDocument();
    // Loading toasts should NOT have a dismiss button
    expect(screen.queryByText('×')).not.toBeInTheDocument();
  });
});
