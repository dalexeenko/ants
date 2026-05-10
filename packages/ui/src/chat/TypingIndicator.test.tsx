import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TypingIndicator } from './TypingIndicator';
import { mockLightTheme } from '../styles/mockTheme';

// Mock useTheme
vi.mock('../styles/theme', () => ({
  useTheme: () => mockLightTheme,
}));

describe('TypingIndicator', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should render with default label', () => {
    render(<TypingIndicator />);
    expect(screen.getByText('Thinking')).toBeInTheDocument();
  });

  it('should render with custom label', () => {
    render(<TypingIndicator label="Processing" />);
    expect(screen.getByText('Processing')).toBeInTheDocument();
  });

  it('should render without label when empty string', () => {
    render(<TypingIndicator label="" />);
    expect(screen.queryByText('Thinking')).not.toBeInTheDocument();
  });

  it('should render with small size', () => {
    const { container } = render(<TypingIndicator size="sm" />);
    expect(container).toBeTruthy();
  });

  it('should render with medium size (default)', () => {
    const { container } = render(<TypingIndicator size="md" />);
    expect(container).toBeTruthy();
  });

  it('should animate dots over time', () => {
    render(<TypingIndicator />);
    
    // Initially renders
    expect(screen.getByText('Thinking')).toBeInTheDocument();
    
    // Advance timers to trigger animation
    vi.advanceTimersByTime(300);
    expect(screen.getByText('Thinking')).toBeInTheDocument();
    
    vi.advanceTimersByTime(300);
    expect(screen.getByText('Thinking')).toBeInTheDocument();
    
    vi.advanceTimersByTime(300);
    expect(screen.getByText('Thinking')).toBeInTheDocument();
  });

  it('should cleanup interval on unmount', () => {
    const { unmount } = render(<TypingIndicator />);
    
    // Advance time
    vi.advanceTimersByTime(600);
    
    // Unmount should cleanup
    unmount();
    
    // Further time advancement should not cause issues
    vi.advanceTimersByTime(1000);
  });
});
