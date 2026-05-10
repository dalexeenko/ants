import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Text } from './Text';

describe('Text', () => {
  it('should render children', () => {
    render(<Text>Hello World</Text>);
    expect(screen.getByText('Hello World')).toBeInTheDocument();
  });

  it('should apply variant styles', () => {
    render(<Text variant="heading">Heading</Text>);
    expect(screen.getByText('Heading')).toBeInTheDocument();
  });

  it('should apply color prop', () => {
    render(<Text color="muted">Muted text</Text>);
    expect(screen.getByText('Muted text')).toBeInTheDocument();
  });

  it('should apply weight prop', () => {
    render(<Text weight="bold">Bold text</Text>);
    expect(screen.getByText('Bold text')).toBeInTheDocument();
  });

  it('should apply custom styles', () => {
    render(<Text style={{ marginTop: 10 }}>Styled text</Text>);
    expect(screen.getByText('Styled text')).toBeInTheDocument();
  });
});
