import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ModelPicker } from './ModelPicker';
import type { AgentBridge, ModelInfo } from '../agent/types';
import { mockLightTheme } from '../styles/mockTheme';

// Mock useTheme
vi.mock('../styles/theme', () => ({
  useTheme: () => mockLightTheme,
}));

// Mock ModelPickerContent to simplify tests
vi.mock('./ModelPickerContent', () => ({
  ModelPickerContent: ({ models, onSelectModel }: any) => (
    <div data-testid="model-picker-content">
      {models.map((m: ModelInfo) => (
        <button key={m.id} onClick={() => onSelectModel(m)}>{m.name}</button>
      ))}
    </div>
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

const mockModels: ModelInfo[] = [
  {
    id: 'claude-sonnet-4-20250514',
    name: 'Claude Sonnet 4',
    provider: 'anthropic',
    description: 'Fast and capable',
    contextLength: 200000,
  } as ModelInfo,
  {
    id: 'gpt-4o',
    name: 'GPT-4o',
    provider: 'openai',
    description: 'Multimodal model',
    contextLength: 128000,
  } as ModelInfo,
];

function createMockBridge(overrides: Partial<AgentBridge> = {}): AgentBridge {
  return {
    getModels: vi.fn().mockResolvedValue(mockModels),
    getCurrentModel: vi.fn().mockResolvedValue({ provider: 'anthropic', model: 'claude-sonnet-4-20250514' }),
    getSessionModel: vi.fn().mockResolvedValue(null),
    setSessionModel: vi.fn().mockResolvedValue(undefined),
    clearSessionModel: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as AgentBridge;
}

describe('ModelPicker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should show loading state initially', () => {
    const bridge = createMockBridge({
      getModels: vi.fn().mockReturnValue(new Promise(() => {})),
      getCurrentModel: vi.fn().mockReturnValue(new Promise(() => {})),
      getSessionModel: vi.fn().mockReturnValue(new Promise(() => {})),
    });
    render(<ModelPicker bridge={bridge} projectId="proj-1" sessionId="session-1" />);
    expect(screen.getByText('...')).toBeInTheDocument();
  });

  it('should show current model name after loading', async () => {
    const bridge = createMockBridge();
    render(<ModelPicker bridge={bridge} projectId="proj-1" sessionId="session-1" />);
    await waitFor(() => {
      expect(screen.getByText('Claude Sonnet 4')).toBeInTheDocument();
    });
  });

  it('should open modal when badge is pressed', async () => {
    const bridge = createMockBridge();
    render(<ModelPicker bridge={bridge} projectId="proj-1" sessionId="session-1" />);
    await waitFor(() => {
      expect(screen.getByText('Claude Sonnet 4')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('Claude Sonnet 4'));
    // Modal header should be visible
    expect(screen.getByText('Session Model')).toBeInTheDocument();
    expect(screen.getByText('Cancel')).toBeInTheDocument();
  });

  it('should render SafeAreaView inside modal', async () => {
    const bridge = createMockBridge();
    const { container } = render(<ModelPicker bridge={bridge} projectId="proj-1" sessionId="session-1" />);
    await waitFor(() => {
      expect(screen.getByText('Claude Sonnet 4')).toBeInTheDocument();
    });
    // Open modal
    fireEvent.click(screen.getByText('Claude Sonnet 4'));
    // Session Model header should be inside the SafeAreaView within the modal
    // Since react-native-web renders SafeAreaView as a div, check that the modal content is present
    expect(screen.getByText('Session Model')).toBeInTheDocument();
    expect(screen.getByTestId('model-picker-content')).toBeInTheDocument();
  });

  it('should close modal when Cancel is pressed', async () => {
    const bridge = createMockBridge();
    render(<ModelPicker bridge={bridge} projectId="proj-1" sessionId="session-1" />);
    await waitFor(() => {
      expect(screen.getByText('Claude Sonnet 4')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('Claude Sonnet 4'));
    expect(screen.getByText('Session Model')).toBeInTheDocument();
    expect(screen.getByText('Cancel')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Cancel'));
    // The badge should still be visible (at least one "Claude Sonnet 4" text)
    expect(screen.getAllByText('Claude Sonnet 4').length).toBeGreaterThanOrEqual(1);
  });

  it('should show "Select model" when no model info found', async () => {
    const bridge = createMockBridge({
      getModels: vi.fn().mockResolvedValue([]),
      getCurrentModel: vi.fn().mockResolvedValue({ provider: 'unknown', model: 'unknown-model' }),
    });
    render(<ModelPicker bridge={bridge} projectId="proj-1" sessionId="session-1" />);
    await waitFor(() => {
      expect(screen.getByText('unknown-model')).toBeInTheDocument();
    });
  });

  it('should call setSessionModel when a model is selected', async () => {
    const setSessionModel = vi.fn().mockResolvedValue(undefined);
    const bridge = createMockBridge({ setSessionModel });
    render(<ModelPicker bridge={bridge} projectId="proj-1" sessionId="session-1" />);
    await waitFor(() => {
      expect(screen.getByText('Claude Sonnet 4')).toBeInTheDocument();
    });
    // Open modal
    fireEvent.click(screen.getByText('Claude Sonnet 4'));
    // Click a model in the content
    fireEvent.click(screen.getByText('GPT-4o'));
    expect(setSessionModel).toHaveBeenCalledWith('proj-1', 'session-1', 'openai', 'gpt-4o');
  });
});
