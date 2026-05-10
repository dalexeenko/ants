import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CompactionSummaryBlock } from './CompactionSummaryBlock';
import type { Message } from '../agent/types';
import { mockLightTheme } from '../styles/mockTheme';

// Mock useTheme
vi.mock('../styles/theme', () => ({
  useTheme: () => mockLightTheme,
}));

// Mock MarkdownContent
vi.mock('./MarkdownContent', () => ({
  MarkdownContent: ({ content }: { content: string }) => (
    <div data-testid="markdown-content">{content}</div>
  ),
}));

describe('CompactionSummaryBlock', () => {
  const compactionMessage: Message = {
    id: 'compaction-1',
    role: 'user',
    content: '[Conversation Summary]\n\n## Tasks Completed\n- Implemented feature X',
    isCompactionSummary: true,
    createdAt: Date.now(),
  };

  const emptyMessage: Message = {
    id: 'compaction-2',
    role: 'user',
    content: '',
    isCompactionSummary: true,
    createdAt: Date.now(),
  };

  it('should render the header label "Conversation summarized"', () => {
    render(<CompactionSummaryBlock message={compactionMessage} />);
    expect(screen.getByText('Conversation summarized')).toBeInTheDocument();
  });

  it('should be collapsed by default and not show content', () => {
    render(<CompactionSummaryBlock message={compactionMessage} />);
    expect(screen.queryByTestId('markdown-content')).not.toBeInTheDocument();
  });

  it('should expand when header is clicked', () => {
    render(<CompactionSummaryBlock message={compactionMessage} />);

    fireEvent.click(screen.getByText('Conversation summarized'));

    expect(screen.getByTestId('markdown-content')).toBeInTheDocument();
  });

  it('should strip the [Conversation Summary] prefix from displayed content', () => {
    render(<CompactionSummaryBlock message={compactionMessage} />);

    fireEvent.click(screen.getByText('Conversation summarized'));

    const content = screen.getByTestId('markdown-content');
    expect(content.textContent).toBe('## Tasks Completed\n- Implemented feature X');
    expect(content.textContent).not.toContain('[Conversation Summary]');
  });

  it('should collapse when header is clicked again', () => {
    render(<CompactionSummaryBlock message={compactionMessage} />);

    // Expand
    fireEvent.click(screen.getByText('Conversation summarized'));
    expect(screen.getByTestId('markdown-content')).toBeInTheDocument();

    // Collapse
    fireEvent.click(screen.getByText('Conversation summarized'));
    expect(screen.queryByTestId('markdown-content')).not.toBeInTheDocument();
  });

  it('should be expanded when isStreaming is true', () => {
    render(<CompactionSummaryBlock message={compactionMessage} isStreaming={true} />);

    // Content should be visible even though user hasn't clicked
    expect(screen.getByTestId('markdown-content')).toBeInTheDocument();
  });

  it('should show "writing..." label when streaming', () => {
    render(<CompactionSummaryBlock message={compactionMessage} isStreaming={true} />);
    expect(screen.getByText('writing...')).toBeInTheDocument();
  });

  it('should not show "writing..." label when not streaming', () => {
    render(<CompactionSummaryBlock message={compactionMessage} isStreaming={false} />);
    expect(screen.queryByText('writing...')).not.toBeInTheDocument();
  });

  it('should not show content when expanded with empty content', () => {
    render(<CompactionSummaryBlock message={emptyMessage} isStreaming={false} />);

    // Expand
    fireEvent.click(screen.getByText('Conversation summarized'));

    // No markdown content since displayContent is empty
    expect(screen.queryByTestId('markdown-content')).not.toBeInTheDocument();
  });

  it('should handle messages without the summary prefix', () => {
    const messageWithoutPrefix: Message = {
      id: 'compaction-3',
      role: 'user',
      content: 'Some summary content without prefix',
      isCompactionSummary: true,
      createdAt: Date.now(),
    };

    render(<CompactionSummaryBlock message={messageWithoutPrefix} />);

    // Expand
    fireEvent.click(screen.getByText('Conversation summarized'));

    const content = screen.getByTestId('markdown-content');
    expect(content.textContent).toBe('Some summary content without prefix');
  });
});
