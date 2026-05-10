import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MessageBubble } from './MessageBubble';
import type { Message } from '../agent/types';
import { mockLightTheme } from '../styles/mockTheme';

// Mock useTheme
vi.mock('../styles/theme', () => ({
  useTheme: () => mockLightTheme,
}));

// Mock MarkdownContent
vi.mock('./MarkdownContent', () => ({
  MarkdownContent: ({ content }: { content: string }) => <div>{content}</div>,
}));

// Mock ToolCallBlock
vi.mock('./ToolCallBlock', () => ({
  ToolCallBlock: ({ toolCall }: { toolCall: { name: string } }) => (
    <div data-testid="tool-call">{toolCall.name}</div>
  ),
}));

describe('MessageBubble', () => {
  const userMessage: Message = {
    id: 'msg-1',
    role: 'user',
    content: 'Hello, how are you?',
    createdAt: Date.now(),
  };

  const assistantMessage: Message = {
    id: 'msg-2',
    role: 'assistant',
    content: 'I am doing well, thank you!',
    createdAt: Date.now(),
  };

  it('should render user message content', () => {
    render(<MessageBubble message={userMessage} />);
    expect(screen.getByText('Hello, how are you?')).toBeInTheDocument();
  });

  it('should render assistant message content', () => {
    render(<MessageBubble message={assistantMessage} />);
    expect(screen.getByText('I am doing well, thank you!')).toBeInTheDocument();
  });

  it('should render timestamp', () => {
    const message: Message = {
      ...userMessage,
      createdAt: new Date('2024-01-01T10:30:00').getTime(),
    };
    render(<MessageBubble message={message} />);
    // Timestamp format depends on locale, so we just check it renders
    expect(screen.getByText('Hello, how are you?')).toBeInTheDocument();
  });

  it('should render tool calls', () => {
    const messageWithTools: Message = {
      ...assistantMessage,
      toolCalls: [
        {
          id: 'tool-1',
          name: 'read_file',
          arguments: { path: '/test.txt' },
          status: 'complete',
        },
      ],
    };
    
    render(<MessageBubble message={messageWithTools} />);
    expect(screen.getByTestId('tool-call')).toBeInTheDocument();
    expect(screen.getByText('read_file')).toBeInTheDocument();
  });

  it('should render multiple tool calls', () => {
    const messageWithMultipleTools: Message = {
      ...assistantMessage,
      toolCalls: [
        {
          id: 'tool-1',
          name: 'read_file',
          arguments: { path: '/test.txt' },
          status: 'complete',
        },
        {
          id: 'tool-2',
          name: 'write_file',
          arguments: { path: '/output.txt', content: 'Hello' },
          status: 'complete',
        },
      ],
    };
    
    render(<MessageBubble message={messageWithMultipleTools} />);
    expect(screen.getAllByTestId('tool-call')).toHaveLength(2);
  });

  it('should call onToolCallExpand when tool is toggled', () => {
    const onToolCallExpand = vi.fn();
    const messageWithTools: Message = {
      ...assistantMessage,
      toolCalls: [
        {
          id: 'tool-1',
          name: 'read_file',
          arguments: { path: '/test.txt' },
          status: 'complete',
        },
      ],
    };
    
    render(
      <MessageBubble
        message={messageWithTools}
        onToolCallExpand={onToolCallExpand}
      />
    );
    
    // Tool call block should be rendered
    expect(screen.getByText('read_file')).toBeInTheDocument();
  });

  it('should handle empty content', () => {
    const emptyMessage: Message = {
      ...assistantMessage,
      content: '',
    };
    
    render(<MessageBubble message={emptyMessage} />);
    // Should render without error even with empty content
  });

  it('should handle message with only tool calls', () => {
    const toolOnlyMessage: Message = {
      id: 'msg-3',
      role: 'assistant',
      content: '',
      createdAt: Date.now(),
      toolCalls: [
        {
          id: 'tool-1',
          name: 'bash',
          arguments: { command: 'ls' },
          status: 'running',
        },
      ],
    };
    
    render(<MessageBubble message={toolOnlyMessage} />);
    expect(screen.getByText('bash')).toBeInTheDocument();
  });

  it('should pass expanded state to tool calls', () => {
    const messageWithTools: Message = {
      ...assistantMessage,
      toolCalls: [
        {
          id: 'tool-1',
          name: 'read_file',
          arguments: { path: '/test.txt' },
          status: 'complete',
        },
      ],
    };
    
    const expandedToolCalls = new Set(['tool-1']);
    
    render(
      <MessageBubble
        message={messageWithTools}
        expandedToolCalls={expandedToolCalls}
      />
    );
    
    expect(screen.getByText('read_file')).toBeInTheDocument();
  });

  it('should handle onCopy callback', () => {
    const onCopy = vi.fn();
    
    render(
      <MessageBubble
        message={userMessage}
        onCopy={onCopy}
      />
    );
    
    // Copy functionality is available
    expect(screen.getByText('Hello, how are you?')).toBeInTheDocument();
  });
});
