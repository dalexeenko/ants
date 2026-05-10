import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { Divider } from './Divider';
import { mockLightTheme } from '../styles/mockTheme';

// Mock useTheme
vi.mock('../styles/theme', () => ({
  useTheme: () => mockLightTheme,
}));

describe('Divider', () => {
  it('should render with default orientation (horizontal)', () => {
    const { container } = render(<Divider />);
    expect(container.firstChild).toBeTruthy();
  });

  it('should render horizontal divider', () => {
    const { container } = render(<Divider orientation="horizontal" />);
    expect(container.firstChild).toBeTruthy();
  });

  it('should render vertical divider', () => {
    const { container } = render(<Divider orientation="vertical" />);
    expect(container.firstChild).toBeTruthy();
  });

  it('should render with no spacing', () => {
    const { container } = render(<Divider spacing="none" />);
    expect(container.firstChild).toBeTruthy();
  });

  it('should render with small spacing', () => {
    const { container } = render(<Divider spacing="sm" />);
    expect(container.firstChild).toBeTruthy();
  });

  it('should render with medium spacing (default)', () => {
    const { container } = render(<Divider spacing="md" />);
    expect(container.firstChild).toBeTruthy();
  });

  it('should render with large spacing', () => {
    const { container } = render(<Divider spacing="lg" />);
    expect(container.firstChild).toBeTruthy();
  });

  it('should render vertical with spacing', () => {
    const { container } = render(<Divider orientation="vertical" spacing="lg" />);
    expect(container.firstChild).toBeTruthy();
  });
});
