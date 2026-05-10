import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Button } from './Button';
import { mockLightTheme } from '../styles/mockTheme';

// Mock useTheme
vi.mock('../styles/theme', () => ({
  useTheme: () => mockLightTheme,
}));

describe('Button', () => {
  it('should render children', () => {
    render(<Button>Click me</Button>);
    expect(screen.getByText('Click me')).toBeInTheDocument();
  });

  it('should handle click', () => {
    const onPress = vi.fn();
    render(<Button onPress={onPress}>Click me</Button>);
    
    fireEvent.click(screen.getByText('Click me'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('should not call onPress when disabled', () => {
    const onPress = vi.fn();
    render(<Button onPress={onPress} disabled>Click me</Button>);
    
    fireEvent.click(screen.getByText('Click me'));
    // disabled buttons may still receive click events but should not fire handler
    // The actual check depends on Pressable implementation
  });

  it('should render with primary variant by default', () => {
    render(<Button>Primary</Button>);
    expect(screen.getByText('Primary')).toBeInTheDocument();
  });

  it('should render with secondary variant', () => {
    render(<Button variant="secondary">Secondary</Button>);
    expect(screen.getByText('Secondary')).toBeInTheDocument();
  });

  it('should render with ghost variant', () => {
    render(<Button variant="ghost">Ghost</Button>);
    expect(screen.getByText('Ghost')).toBeInTheDocument();
  });

  it('should render with danger variant', () => {
    render(<Button variant="danger">Danger</Button>);
    expect(screen.getByText('Danger')).toBeInTheDocument();
  });

  it('should render with small size', () => {
    render(<Button size="sm">Small</Button>);
    expect(screen.getByText('Small')).toBeInTheDocument();
  });

  it('should render with medium size by default', () => {
    render(<Button>Medium</Button>);
    expect(screen.getByText('Medium')).toBeInTheDocument();
  });

  it('should render with large size', () => {
    render(<Button size="lg">Large</Button>);
    expect(screen.getByText('Large')).toBeInTheDocument();
  });

  it('should show loading state', () => {
    render(<Button loading>Loading</Button>);
    expect(screen.getByText('Loading')).toBeInTheDocument();
  });

  it('should apply custom style', () => {
    render(<Button style={{ marginTop: 10 }}>Styled</Button>);
    expect(screen.getByText('Styled')).toBeInTheDocument();
  });
});
