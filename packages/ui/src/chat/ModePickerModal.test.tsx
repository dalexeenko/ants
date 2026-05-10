import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { ModePickerModal } from './ModePickerModal';
import type { AgentBridge, AgentMode } from '../agent/types';
import { mockLightTheme } from '../styles/mockTheme';

// Mock useTheme
vi.mock('../styles/theme', () => ({
  useTheme: () => mockLightTheme,
}));

// Mock sessionStore — each test can set initial state via mockAutoComplete/mockLoopCount/mockProcessing
let mockAutoComplete = false;
let mockLoopCount = 0;
let mockProcessing = false;
const mockSetAutoComplete = vi.fn();
const mockResetAutoCompleteLoop = vi.fn();

vi.mock('../store/sessionStore', () => ({
  useSessionStore: Object.assign(
    (selector: (state: any) => any) => {
      const state = {
        autoCompleteBySession: { 'session-1': mockAutoComplete },
        autoCompleteLoopBySession: { 'session-1': mockLoopCount },
        processingBySession: { 'session-1': mockProcessing },
      };
      return selector(state);
    },
    {
      getState: () => ({
        setAutoComplete: mockSetAutoComplete,
        resetAutoCompleteLoop: mockResetAutoCompleteLoop,
      }),
    },
  ),
}));

// Mock logger
vi.mock('../utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

function createMockBridge(overrides: Partial<AgentBridge> = {}): AgentBridge {
  return {
    getSessionMode: vi.fn().mockResolvedValue('build' as AgentMode),
    setSessionMode: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as AgentBridge;
}

describe('ModePickerModal', () => {
  beforeEach(() => {
    mockAutoComplete = false;
    mockLoopCount = 0;
    mockProcessing = false;
    vi.clearAllMocks();
  });

  it('should show loading state initially', () => {
    // Use a never-resolving promise to keep it in loading state
    const bridge = createMockBridge({
      getSessionMode: vi.fn().mockReturnValue(new Promise(() => {})),
    });
    render(<ModePickerModal bridge={bridge} projectId="proj-1" sessionId="session-1" />);
    expect(screen.getByText('...')).toBeInTheDocument();
  });

  it('should show "Build" label after loading in build mode', async () => {
    const bridge = createMockBridge();
    render(<ModePickerModal bridge={bridge} projectId="proj-1" sessionId="session-1" />);
    await waitFor(() => {
      expect(screen.getByText('Build')).toBeInTheDocument();
    });
  });

  it('should show "Plan" label after loading in plan mode', async () => {
    const bridge = createMockBridge({
      getSessionMode: vi.fn().mockResolvedValue('plan'),
    });
    render(<ModePickerModal bridge={bridge} projectId="proj-1" sessionId="session-1" />);
    await waitFor(() => {
      expect(screen.getByText('Plan')).toBeInTheDocument();
    });
  });

  it('should show "Build (Auto)" when auto-complete is enabled', async () => {
    mockAutoComplete = true;
    const bridge = createMockBridge();
    render(<ModePickerModal bridge={bridge} projectId="proj-1" sessionId="session-1" />);
    await waitFor(() => {
      expect(screen.getByText('Build (Auto)')).toBeInTheDocument();
    });
  });

  it('should show "Plan (Auto)" when in plan mode with auto-complete', async () => {
    mockAutoComplete = true;
    const bridge = createMockBridge({
      getSessionMode: vi.fn().mockResolvedValue('plan'),
    });
    render(<ModePickerModal bridge={bridge} projectId="proj-1" sessionId="session-1" />);
    await waitFor(() => {
      expect(screen.getByText('Plan (Auto)')).toBeInTheDocument();
    });
  });

  it('should open modal when trigger button is pressed', async () => {
    const bridge = createMockBridge();
    render(<ModePickerModal bridge={bridge} projectId="proj-1" sessionId="session-1" />);
    await waitFor(() => {
      expect(screen.getByText('Build')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('Build'));
    // Modal should show Mode section label and auto-complete label
    expect(screen.getByText('Mode')).toBeInTheDocument();
    expect(screen.getByText('Auto-complete')).toBeInTheDocument();
  });

  it('should show Plan and Build options in modal', async () => {
    const bridge = createMockBridge();
    render(<ModePickerModal bridge={bridge} projectId="proj-1" sessionId="session-1" />);
    await waitFor(() => {
      expect(screen.getByText('Build')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('Build'));
    // Both mode options should be visible (Plan and Build in the segmented control)
    // "Build" appears in both the trigger and the mode option
    expect(screen.getByText('Plan')).toBeInTheDocument();
    expect(screen.getByText('Full tool access')).toBeInTheDocument();
  });

  it('should switch mode to plan when Plan option is pressed', async () => {
    const setModeFn = vi.fn().mockResolvedValue(undefined);
    const bridge = createMockBridge({
      setSessionMode: setModeFn,
    });
    render(<ModePickerModal bridge={bridge} projectId="proj-1" sessionId="session-1" />);
    await waitFor(() => {
      expect(screen.getByText('Build')).toBeInTheDocument();
    });
    // Open modal
    fireEvent.click(screen.getByText('Build'));
    // Click Plan option
    fireEvent.click(screen.getByText('Plan'));
    expect(setModeFn).toHaveBeenCalledWith('proj-1', 'session-1', 'plan');
  });

  it('should show description for plan mode', async () => {
    const bridge = createMockBridge({
      getSessionMode: vi.fn().mockResolvedValue('plan'),
    });
    render(<ModePickerModal bridge={bridge} projectId="proj-1" sessionId="session-1" />);
    await waitFor(() => {
      expect(screen.getByText('Plan')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('Plan'));
    expect(screen.getByText('Read-only operations only')).toBeInTheDocument();
  });

  it('should toggle auto-complete on', async () => {
    mockAutoComplete = false;
    const bridge = createMockBridge();
    render(<ModePickerModal bridge={bridge} projectId="proj-1" sessionId="session-1" />);
    await waitFor(() => {
      expect(screen.getByText('Build')).toBeInTheDocument();
    });
    // Open modal
    fireEvent.click(screen.getByText('Build'));
    // Click the Off toggle
    fireEvent.click(screen.getByText('Off'));
    expect(mockSetAutoComplete).toHaveBeenCalledWith('session-1', true);
  });

  it('should toggle auto-complete off and reset loop', async () => {
    mockAutoComplete = true;
    const bridge = createMockBridge();
    render(<ModePickerModal bridge={bridge} projectId="proj-1" sessionId="session-1" />);
    await waitFor(() => {
      expect(screen.getByText('Build (Auto)')).toBeInTheDocument();
    });
    // Open modal
    fireEvent.click(screen.getByText('Build (Auto)'));
    // Click the On toggle
    fireEvent.click(screen.getByText('On'));
    expect(mockSetAutoComplete).toHaveBeenCalledWith('session-1', false);
    expect(mockResetAutoCompleteLoop).toHaveBeenCalledWith('session-1');
  });

  it('should show loop count badge when auto-complete is active and processing', async () => {
    mockAutoComplete = true;
    mockLoopCount = 3;
    mockProcessing = true;
    const bridge = createMockBridge();
    render(<ModePickerModal bridge={bridge} projectId="proj-1" sessionId="session-1" />);
    await waitFor(() => {
      expect(screen.getByText('Build (Auto)')).toBeInTheDocument();
    });
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('should not show loop count badge when not processing', async () => {
    mockAutoComplete = true;
    mockLoopCount = 3;
    mockProcessing = false;
    const bridge = createMockBridge();
    render(<ModePickerModal bridge={bridge} projectId="proj-1" sessionId="session-1" />);
    await waitFor(() => {
      expect(screen.getByText('Build (Auto)')).toBeInTheDocument();
    });
    expect(screen.queryByText('3')).not.toBeInTheDocument();
  });

  it('should call getSessionMode on mount', async () => {
    const getModeFn = vi.fn().mockResolvedValue('build');
    const bridge = createMockBridge({
      getSessionMode: getModeFn,
    });
    render(<ModePickerModal bridge={bridge} projectId="proj-1" sessionId="session-1" />);
    await waitFor(() => {
      expect(getModeFn).toHaveBeenCalledWith('proj-1', 'session-1');
    });
  });

  it('should show auto-complete description text', async () => {
    const bridge = createMockBridge();
    render(<ModePickerModal bridge={bridge} projectId="proj-1" sessionId="session-1" />);
    await waitFor(() => {
      expect(screen.getByText('Build')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('Build'));
    expect(screen.getByText('Continue when todos or phases remain')).toBeInTheDocument();
  });
});
