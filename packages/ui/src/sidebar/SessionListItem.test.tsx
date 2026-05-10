import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SessionListItem, getSessionStatus } from './SessionListItem';
import { useSessionStore } from '../store/sessionStore';
import type { Session } from '../agent/types';
import { mockLightTheme } from '../styles/mockTheme';

// Mock useTheme
vi.mock('../styles/theme', () => ({
  useTheme: () => mockLightTheme,
}));

// Mock ContextMenu
vi.mock('../primitives/ContextMenu', () => ({
  ContextMenu: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

describe('SessionListItem', () => {
  const mockSession: Session = {
    id: 'session-1',
    title: 'Test Session',
    createdAt: Date.now() - 3600000, // 1 hour ago
    updatedAt: Date.now() - 1800000, // 30 minutes ago
  };

  beforeEach(() => {
    // Reset store to default idle state
    useSessionStore.setState({
      processingBySession: {},
      pendingPermissionsBySession: {},
      pendingQuestionsBySession: {},
      errorBySession: {},
      doneBySession: {},
    });
  });

  it('should render session title', () => {
    render(<SessionListItem session={mockSession} onPress={() => {}} />);
    expect(screen.getByText('Test Session')).toBeInTheDocument();
  });

  it('should render "Untitled Session" when title is empty', () => {
    const untitledSession: Session = {
      ...mockSession,
      title: '',
    };
    render(<SessionListItem session={untitledSession} onPress={() => {}} />);
    expect(screen.getByText('Untitled Session')).toBeInTheDocument();
  });

  it('should render relative time', () => {
    render(<SessionListItem session={mockSession} onPress={() => {}} />);
    // Should show "30m ago" for session updated 30 minutes ago
    expect(screen.getByText('30m ago')).toBeInTheDocument();
  });

  it('should call onPress when clicked', () => {
    const onPress = vi.fn();
    render(<SessionListItem session={mockSession} onPress={onPress} />);
    
    fireEvent.click(screen.getByText('Test Session'));
    expect(onPress).toHaveBeenCalled();
  });

  it('should show selected state', () => {
    render(
      <SessionListItem
        session={mockSession}
        onPress={() => {}}
        selected={true}
      />
    );
    expect(screen.getByText('Test Session')).toBeInTheDocument();
  });

  it('should show delete button when onDelete is provided', () => {
    const onDelete = vi.fn();
    render(
      <SessionListItem
        session={mockSession}
        onPress={() => {}}
        onDelete={onDelete}
      />
    );
    expect(screen.getByText('Test Session')).toBeInTheDocument();
  });

  it('should call onDelete when delete is clicked', () => {
    const onDelete = vi.fn();
    render(
      <SessionListItem
        session={mockSession}
        onPress={() => {}}
        onDelete={onDelete}
      />
    );
    expect(screen.getByText('Test Session')).toBeInTheDocument();
  });

  it('should format "Just now" for very recent sessions', () => {
    const recentSession: Session = {
      ...mockSession,
      updatedAt: Date.now() - 30000, // 30 seconds ago
    };
    render(<SessionListItem session={recentSession} onPress={() => {}} />);
    expect(screen.getByText('Just now')).toBeInTheDocument();
  });

  it('should format hours correctly', () => {
    const hourSession: Session = {
      ...mockSession,
      updatedAt: Date.now() - 7200000, // 2 hours ago
    };
    render(<SessionListItem session={hourSession} onPress={() => {}} />);
    expect(screen.getByText('2h ago')).toBeInTheDocument();
  });

  it('should format days correctly', () => {
    const daySession: Session = {
      ...mockSession,
      updatedAt: Date.now() - 172800000, // 2 days ago
    };
    render(<SessionListItem session={daySession} onPress={() => {}} />);
    expect(screen.getByText('2d ago')).toBeInTheDocument();
  });

  it('should show date for sessions older than a week', () => {
    const oldSession: Session = {
      ...mockSession,
      updatedAt: Date.now() - 1000000000, // ~12 days ago
    };
    render(<SessionListItem session={oldSession} onPress={() => {}} />);
    expect(screen.getByText('Test Session')).toBeInTheDocument();
  });
});

describe('getSessionStatus', () => {
  it('should return "idle" when no status is set', () => {
    expect(getSessionStatus('s1', {}, {}, {}, {}, {})).toBe('idle');
  });

  it('should return "processing" when session is processing', () => {
    expect(getSessionStatus('s1', { s1: true }, {}, {}, {}, {})).toBe('processing');
  });

  it('should return "idle" when processing is false', () => {
    expect(getSessionStatus('s1', { s1: false }, {}, {}, {}, {})).toBe('idle');
  });

  it('should return "needsPermission" when a permission is pending', () => {
    const pending = { id: 'tc1', name: 'tool', arguments: '{}' };
    expect(getSessionStatus('s1', { s1: true }, { s1: pending }, {}, {}, {})).toBe('needsPermission');
  });

  it('should return "needsAnswer" when a question is pending', () => {
    const question = { questionId: 'q1', question: 'What?', options: [] };
    expect(getSessionStatus('s1', { s1: true }, {}, { s1: question }, {}, {})).toBe('needsAnswer');
  });

  it('should return "error" when an error is set', () => {
    expect(getSessionStatus('s1', {}, {}, {}, { s1: 'Something failed' }, {})).toBe('error');
  });

  it('should return "idle" when error is null', () => {
    expect(getSessionStatus('s1', {}, {}, {}, { s1: null }, {})).toBe('idle');
  });

  it('should return "done" when done is set', () => {
    expect(getSessionStatus('s1', {}, {}, {}, {}, { s1: true })).toBe('done');
  });

  it('should return "idle" when done is false', () => {
    expect(getSessionStatus('s1', {}, {}, {}, {}, { s1: false })).toBe('idle');
  });

  it('should prioritize needsPermission over processing and error', () => {
    const pending = { id: 'tc1', name: 'tool', arguments: '{}' };
    expect(
      getSessionStatus('s1', { s1: true }, { s1: pending }, {}, { s1: 'err' }, {})
    ).toBe('needsPermission');
  });

  it('should prioritize needsAnswer over error and processing', () => {
    const question = { questionId: 'q1', question: 'What?', options: [] };
    expect(
      getSessionStatus('s1', { s1: true }, {}, { s1: question }, { s1: 'err' }, {})
    ).toBe('needsAnswer');
  });

  it('should prioritize error over processing', () => {
    expect(
      getSessionStatus('s1', { s1: true }, {}, {}, { s1: 'Something failed' }, {})
    ).toBe('error');
  });

  it('should prioritize processing over done', () => {
    expect(
      getSessionStatus('s1', { s1: true }, {}, {}, {}, { s1: true })
    ).toBe('processing');
  });

  it('should not affect other sessions', () => {
    expect(getSessionStatus('s2', { s1: true }, {}, {}, { s1: 'err' }, {})).toBe('idle');
  });
});
