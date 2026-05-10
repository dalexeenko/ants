import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { Spinner, LoadingOverlay } from './Spinner';
import { mockLightTheme } from '../styles/mockTheme';

// Mock useTheme
vi.mock('../styles/theme', () => ({
  useTheme: () => mockLightTheme,
}));

describe('Spinner', () => {
  it('should render with default size', () => {
    const { container } = render(<Spinner />);
    expect(container).toBeTruthy();
  });

  it('should render with small size', () => {
    const { container } = render(<Spinner size="small" />);
    expect(container).toBeTruthy();
  });

  it('should render with large size', () => {
    const { container } = render(<Spinner size="large" />);
    expect(container).toBeTruthy();
  });

  it('should render with custom color', () => {
    const { container } = render(<Spinner color="#FF0000" />);
    expect(container).toBeTruthy();
  });
});

describe('LoadingOverlay', () => {
  it('should render when visible', () => {
    const { container } = render(<LoadingOverlay visible={true} />);
    // Should have the overlay and spinner
    expect(container.firstChild).toBeTruthy();
  });

  it('should not render when not visible', () => {
    const { container } = render(<LoadingOverlay visible={false} />);
    // Should return null
    expect(container.firstChild).toBeNull();
  });
});
