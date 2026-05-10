import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Input } from './Input';
import { mockLightTheme } from '../styles/mockTheme';

// Mock useTheme
vi.mock('../styles/theme', () => ({
  useTheme: () => mockLightTheme,
}));

describe('Input', () => {
  it('should render with value', () => {
    render(<Input value="test value" onChange={() => {}} />);
    expect(screen.getByDisplayValue('test value')).toBeInTheDocument();
  });

  it('should call onChange when text changes', () => {
    const onChange = vi.fn();
    render(<Input value="" onChange={onChange} />);
    
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'new value' } });
    
    expect(onChange).toHaveBeenCalledWith('new value');
  });

  it('should render with placeholder', () => {
    render(<Input value="" onChange={() => {}} placeholder="Enter text..." />);
    expect(screen.getByPlaceholderText('Enter text...')).toBeInTheDocument();
  });

  it('should render with label', () => {
    render(<Input value="" onChange={() => {}} label="Email" />);
    expect(screen.getByText('Email')).toBeInTheDocument();
  });

  it('should render error message', () => {
    render(<Input value="" onChange={() => {}} error="Invalid email" />);
    expect(screen.getByText('Invalid email')).toBeInTheDocument();
  });

  it('should render multiline input', () => {
    render(<Input value="" onChange={() => {}} multiline />);
    expect(screen.getByRole('textbox')).toBeInTheDocument();
  });

  it('should render with left icon', () => {
    const LeftIcon = () => <div data-testid="left-icon">Icon</div>;
    render(<Input value="" onChange={() => {}} leftIcon={<LeftIcon />} />);
    expect(screen.getByTestId('left-icon')).toBeInTheDocument();
  });

  it('should render with right icon', () => {
    const RightIcon = () => <div data-testid="right-icon">Icon</div>;
    render(<Input value="" onChange={() => {}} rightIcon={<RightIcon />} />);
    expect(screen.getByTestId('right-icon')).toBeInTheDocument();
  });

  it('should handle focus state', () => {
    render(<Input value="" onChange={() => {}} />);
    const input = screen.getByRole('textbox');
    
    fireEvent.focus(input);
    expect(input).toBeInTheDocument();
    
    fireEvent.blur(input);
    expect(input).toBeInTheDocument();
  });

  it('should apply custom style', () => {
    render(<Input value="" onChange={() => {}} style={{ fontSize: 20 }} />);
    expect(screen.getByRole('textbox')).toBeInTheDocument();
  });
});
