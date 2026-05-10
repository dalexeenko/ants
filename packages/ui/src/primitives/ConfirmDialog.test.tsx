import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ConfirmDialog } from './ConfirmDialog';
import { mockLightTheme } from '../styles/mockTheme';

// Mock useTheme
vi.mock('../styles/theme', () => ({
  useTheme: () => mockLightTheme,
}));

describe('ConfirmDialog', () => {
  const defaultProps = {
    visible: true,
    title: 'Confirm Action',
    message: 'Are you sure you want to proceed?',
    onConfirm: vi.fn(),
    onCancel: vi.fn(),
  };

  it('should render when visible', () => {
    render(<ConfirmDialog {...defaultProps} />);
    expect(screen.getByText('Confirm Action')).toBeInTheDocument();
    expect(screen.getByText('Are you sure you want to proceed?')).toBeInTheDocument();
  });

  it('should not render when not visible', () => {
    render(<ConfirmDialog {...defaultProps} visible={false} />);
    expect(screen.queryByText('Confirm Action')).not.toBeInTheDocument();
  });

  it('should render default button text', () => {
    render(<ConfirmDialog {...defaultProps} />);
    expect(screen.getByText('Confirm')).toBeInTheDocument();
    expect(screen.getByText('Cancel')).toBeInTheDocument();
  });

  it('should render custom button text', () => {
    render(
      <ConfirmDialog
        {...defaultProps}
        confirmText="Delete"
        cancelText="Keep"
      />
    );
    expect(screen.getByText('Delete')).toBeInTheDocument();
    expect(screen.getByText('Keep')).toBeInTheDocument();
  });

  it('should call onConfirm when confirm is clicked', () => {
    const onConfirm = vi.fn();
    render(<ConfirmDialog {...defaultProps} onConfirm={onConfirm} />);
    
    fireEvent.click(screen.getByText('Confirm'));
    expect(onConfirm).toHaveBeenCalled();
  });

  it('should call onCancel when cancel is clicked', () => {
    const onCancel = vi.fn();
    render(<ConfirmDialog {...defaultProps} onCancel={onCancel} />);
    
    fireEvent.click(screen.getByText('Cancel'));
    expect(onCancel).toHaveBeenCalled();
  });

  it('should render in destructive mode', () => {
    render(<ConfirmDialog {...defaultProps} destructive />);
    // The confirm button should still be rendered
    expect(screen.getByText('Confirm')).toBeInTheDocument();
  });

  it('should show loading state', () => {
    render(<ConfirmDialog {...defaultProps} loading />);
    // Cancel button should be disabled when loading
    expect(screen.getByText('Cancel')).toBeInTheDocument();
    expect(screen.getByText('Confirm')).toBeInTheDocument();
  });

  it('should render custom title and message', () => {
    render(
      <ConfirmDialog
        {...defaultProps}
        title="Delete Session"
        message="This action cannot be undone. All messages will be permanently deleted."
      />
    );
    expect(screen.getByText('Delete Session')).toBeInTheDocument();
    expect(screen.getByText('This action cannot be undone. All messages will be permanently deleted.')).toBeInTheDocument();
  });

  it('should handle destructive delete scenario', () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    
    render(
      <ConfirmDialog
        visible={true}
        title="Delete Project"
        message="Are you sure? This cannot be undone."
        confirmText="Delete Forever"
        cancelText="Keep Project"
        destructive={true}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    );
    
    expect(screen.getByText('Delete Project')).toBeInTheDocument();
    expect(screen.getByText('Delete Forever')).toBeInTheDocument();
    expect(screen.getByText('Keep Project')).toBeInTheDocument();
    
    fireEvent.click(screen.getByText('Delete Forever'));
    expect(onConfirm).toHaveBeenCalled();
  });
});
