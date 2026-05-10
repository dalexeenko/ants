import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Card } from './Card';
import { Text } from './Text';
import { mockLightTheme } from '../styles/mockTheme';

// Mock useTheme for both Card and Text components
vi.mock('../styles/theme', () => ({
  useTheme: () => mockLightTheme,
}));

describe('Card', () => {
  it('should render children', () => {
    render(
      <Card>
        <Text>Card content</Text>
      </Card>
    );
    expect(screen.getByText('Card content')).toBeInTheDocument();
  });

  it('should render with default variant', () => {
    render(
      <Card>
        <Text>Default</Text>
      </Card>
    );
    expect(screen.getByText('Default')).toBeInTheDocument();
  });

  it('should render with elevated variant', () => {
    render(
      <Card variant="elevated">
        <Text>Elevated</Text>
      </Card>
    );
    expect(screen.getByText('Elevated')).toBeInTheDocument();
  });

  it('should render with outlined variant', () => {
    render(
      <Card variant="outlined">
        <Text>Outlined</Text>
      </Card>
    );
    expect(screen.getByText('Outlined')).toBeInTheDocument();
  });

  it('should render with no padding', () => {
    render(
      <Card padding="none">
        <Text>No padding</Text>
      </Card>
    );
    expect(screen.getByText('No padding')).toBeInTheDocument();
  });

  it('should render with small padding', () => {
    render(
      <Card padding="sm">
        <Text>Small padding</Text>
      </Card>
    );
    expect(screen.getByText('Small padding')).toBeInTheDocument();
  });

  it('should render with medium padding by default', () => {
    render(
      <Card>
        <Text>Medium padding</Text>
      </Card>
    );
    expect(screen.getByText('Medium padding')).toBeInTheDocument();
  });

  it('should render with large padding', () => {
    render(
      <Card padding="lg">
        <Text>Large padding</Text>
      </Card>
    );
    expect(screen.getByText('Large padding')).toBeInTheDocument();
  });

  it('should apply custom style', () => {
    render(
      <Card style={{ marginTop: 20 }}>
        <Text>Styled card</Text>
      </Card>
    );
    expect(screen.getByText('Styled card')).toBeInTheDocument();
  });

  it('should render multiple children', () => {
    render(
      <Card>
        <Text>First</Text>
        <Text>Second</Text>
        <Text>Third</Text>
      </Card>
    );
    expect(screen.getByText('First')).toBeInTheDocument();
    expect(screen.getByText('Second')).toBeInTheDocument();
    expect(screen.getByText('Third')).toBeInTheDocument();
  });
});
