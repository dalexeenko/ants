import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Badge } from './Badge';
import { mockLightTheme } from '../styles/mockTheme';

// Mock useTheme
vi.mock('../styles/theme', () => ({
  useTheme: () => mockLightTheme,
}));

describe('Badge', () => {
  // Note: Badge uses CSS text-transform: uppercase, but the DOM text content
  // remains as provided. We test the actual text content.
  
  it('should render children', () => {
    render(<Badge>New</Badge>);
    expect(screen.getByText('New')).toBeInTheDocument();
  });

  it('should render with default variant', () => {
    render(<Badge>Default</Badge>);
    expect(screen.getByText('Default')).toBeInTheDocument();
  });

  it('should render with primary variant', () => {
    render(<Badge variant="primary">Primary</Badge>);
    expect(screen.getByText('Primary')).toBeInTheDocument();
  });

  it('should render with secondary variant', () => {
    render(<Badge variant="secondary">Secondary</Badge>);
    expect(screen.getByText('Secondary')).toBeInTheDocument();
  });

  it('should render with success variant', () => {
    render(<Badge variant="success">Success</Badge>);
    expect(screen.getByText('Success')).toBeInTheDocument();
  });

  it('should render with warning variant', () => {
    render(<Badge variant="warning">Warning</Badge>);
    expect(screen.getByText('Warning')).toBeInTheDocument();
  });

  it('should render with error variant', () => {
    render(<Badge variant="error">Error</Badge>);
    expect(screen.getByText('Error')).toBeInTheDocument();
  });

  it('should render with small size', () => {
    render(<Badge size="sm">Small</Badge>);
    expect(screen.getByText('Small')).toBeInTheDocument();
  });

  it('should render with medium size by default', () => {
    render(<Badge>Medium</Badge>);
    expect(screen.getByText('Medium')).toBeInTheDocument();
  });

  it('should render number children', () => {
    render(<Badge>42</Badge>);
    expect(screen.getByText('42')).toBeInTheDocument();
  });
});
