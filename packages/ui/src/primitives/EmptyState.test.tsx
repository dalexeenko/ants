import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { EmptyState } from './EmptyState';
import { mockLightTheme } from '../styles/mockTheme';

// Mock useTheme
vi.mock('../styles/theme', () => ({
  useTheme: () => mockLightTheme,
}));

describe('EmptyState', () => {
  it('should render title', () => {
    render(<EmptyState title="No items found" />);
    expect(screen.getByText('No items found')).toBeInTheDocument();
  });

  it('should render description', () => {
    render(
      <EmptyState
        title="No items"
        description="Start by creating your first item"
      />
    );
    expect(screen.getByText('Start by creating your first item')).toBeInTheDocument();
  });

  it('should render with icon', () => {
    render(<EmptyState title="No messages" icon="message" />);
    expect(screen.getByText('No messages')).toBeInTheDocument();
  });

  it('should render action button', () => {
    const onAction = vi.fn();
    render(
      <EmptyState
        title="No items"
        actionLabel="Create Item"
        onAction={onAction}
      />
    );
    
    const button = screen.getByText('Create Item');
    expect(button).toBeInTheDocument();
    
    fireEvent.click(button);
    expect(onAction).toHaveBeenCalled();
  });

  it('should render secondary action button', () => {
    const onSecondaryAction = vi.fn();
    render(
      <EmptyState
        title="No items"
        secondaryActionLabel="Learn More"
        onSecondaryAction={onSecondaryAction}
      />
    );
    
    const button = screen.getByText('Learn More');
    expect(button).toBeInTheDocument();
    
    fireEvent.click(button);
    expect(onSecondaryAction).toHaveBeenCalled();
  });

  it('should render both action buttons', () => {
    const onAction = vi.fn();
    const onSecondaryAction = vi.fn();
    render(
      <EmptyState
        title="No items"
        actionLabel="Create"
        onAction={onAction}
        secondaryActionLabel="Learn More"
        onSecondaryAction={onSecondaryAction}
      />
    );
    
    expect(screen.getByText('Create')).toBeInTheDocument();
    expect(screen.getByText('Learn More')).toBeInTheDocument();
  });

  it('should render in compact mode', () => {
    render(<EmptyState title="No items" compact />);
    expect(screen.getByText('No items')).toBeInTheDocument();
  });

  it('should render with all props', () => {
    const onAction = vi.fn();
    const onSecondaryAction = vi.fn();
    
    render(
      <EmptyState
        icon="folder"
        title="No projects"
        description="Create your first project to get started"
        actionLabel="New Project"
        onAction={onAction}
        secondaryActionLabel="Import"
        onSecondaryAction={onSecondaryAction}
        compact={false}
      />
    );
    
    expect(screen.getByText('No projects')).toBeInTheDocument();
    expect(screen.getByText('Create your first project to get started')).toBeInTheDocument();
    expect(screen.getByText('New Project')).toBeInTheDocument();
    expect(screen.getByText('Import')).toBeInTheDocument();
  });

  it('should not render action button without handler', () => {
    render(
      <EmptyState
        title="No items"
        actionLabel="Create Item"
        // onAction not provided
      />
    );
    
    // Button should not be rendered without handler
    expect(screen.queryByText('Create Item')).not.toBeInTheDocument();
  });
});
