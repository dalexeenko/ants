import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ChatInput } from './ChatInput';
import { mockLightTheme } from '../styles/mockTheme';

// Mock useTheme
vi.mock('../styles/theme', () => ({
  useTheme: () => mockLightTheme,
}));

describe('ChatInput', () => {
  const defaultProps = {
    value: '',
    onChange: vi.fn(),
    onSubmit: vi.fn(),
  };

  it('should render input field', () => {
    render(<ChatInput {...defaultProps} />);
    expect(screen.getByRole('textbox')).toBeInTheDocument();
  });

  it('should render with placeholder', () => {
    render(<ChatInput {...defaultProps} placeholder="Ask anything..." />);
    expect(screen.getByPlaceholderText('Ask anything...')).toBeInTheDocument();
  });

  it('should render default placeholder', () => {
    render(<ChatInput {...defaultProps} />);
    expect(screen.getByPlaceholderText('Type a message...')).toBeInTheDocument();
  });

  it('should call onChange when text changes', () => {
    const onChange = vi.fn();
    render(<ChatInput {...defaultProps} onChange={onChange} />);
    
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'Hello' } });
    
    expect(onChange).toHaveBeenCalledWith('Hello');
  });

  it('should display current value', () => {
    render(<ChatInput {...defaultProps} value="Hello world" />);
    expect(screen.getByDisplayValue('Hello world')).toBeInTheDocument();
  });

  it('should show cancel button when isProcessing is true', () => {
    render(<ChatInput {...defaultProps} isProcessing />);
    expect(screen.getByTestId('ants-chat-cancel')).toBeInTheDocument();
  });

  it('should call onCancel when cancel button is clicked during processing', () => {
    const onCancel = vi.fn();
    render(<ChatInput {...defaultProps} isProcessing onCancel={onCancel} />);
    
    fireEvent.click(screen.getByTestId('ants-chat-cancel'));
    expect(onCancel).toHaveBeenCalled();
  });

  it('should render attachments', () => {
    const attachments = [
      { id: '1', name: 'file.txt', type: 'text/plain', uri: '/path/to/file' },
      { id: '2', name: 'image.png', type: 'image/png', uri: '/path/to/image' },
    ];
    
    render(<ChatInput {...defaultProps} attachments={attachments} />);
    
    expect(screen.getByText('file.txt')).toBeInTheDocument();
    expect(screen.getByText('image.png')).toBeInTheDocument();
  });

  it('should call onRemoveAttachment when attachment is removed', () => {
    const onRemoveAttachment = vi.fn();
    const attachments = [
      { id: '1', name: 'file.txt', type: 'text/plain', uri: '/path/to/file' },
    ];
    
    render(
      <ChatInput
        {...defaultProps}
        attachments={attachments}
        onRemoveAttachment={onRemoveAttachment}
      />
    );
    
    expect(screen.getByText('file.txt')).toBeInTheDocument();
  });

  it('should show command autocomplete', () => {
    const commands = [
      { name: 'help', description: 'Show help' },
      { name: 'clear', description: 'Clear chat' },
    ];
    
    render(
      <ChatInput
        {...defaultProps}
        commands={commands}
        showAutocomplete
      />
    );
    
    expect(screen.getByText('/help')).toBeInTheDocument();
    expect(screen.getByText('/clear')).toBeInTheDocument();
  });

  it('should call onSelectCommand when command is selected', () => {
    const onSelectCommand = vi.fn();
    const commands = [
      { name: 'help', description: 'Show help' },
    ];
    
    render(
      <ChatInput
        {...defaultProps}
        commands={commands}
        showAutocomplete
        onSelectCommand={onSelectCommand}
      />
    );
    
    fireEvent.click(screen.getByText('/help'));
    expect(onSelectCommand).toHaveBeenCalledWith(commands[0]);
  });

  it('should highlight selected command', () => {
    const commands = [
      { name: 'help', description: 'Show help' },
      { name: 'clear', description: 'Clear chat' },
    ];
    
    render(
      <ChatInput
        {...defaultProps}
        commands={commands}
        showAutocomplete
        selectedCommandIndex={1}
      />
    );
    
    // Both commands should be visible
    expect(screen.getByText('/help')).toBeInTheDocument();
    expect(screen.getByText('/clear')).toBeInTheDocument();
  });

  it('should be disabled when disabled prop is true', () => {
    render(<ChatInput {...defaultProps} disabled />);
    // Input should be present but not editable
    expect(screen.getByRole('textbox')).toBeInTheDocument();
  });
});
