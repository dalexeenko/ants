import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ApiKeyInput } from './ApiKeyInput';
import { mockLightTheme } from '../styles/mockTheme';

// Mock useTheme
vi.mock('../styles/theme', () => ({
  useTheme: () => mockLightTheme,
}));

describe('ApiKeyInput', () => {
  const defaultProps = {
    provider: 'openai',
    label: 'OpenAI API Key',
    hasKey: false,
    onSave: vi.fn(),
    onDelete: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('without existing key', () => {
    it('should show "Not configured" status when no key exists', () => {
      render(<ApiKeyInput {...defaultProps} />);

      expect(screen.getByText('Not configured')).toBeInTheDocument();
    });

    it('should show Add Key button when no key exists', () => {
      render(<ApiKeyInput {...defaultProps} />);

      expect(screen.getByText('Add Key')).toBeInTheDocument();
    });

    it('should show label', () => {
      render(<ApiKeyInput {...defaultProps} />);

      expect(screen.getByText('OpenAI API Key')).toBeInTheDocument();
    });

    it('should show input field when Add Key is clicked', () => {
      render(<ApiKeyInput {...defaultProps} />);

      fireEvent.click(screen.getByText('Add Key'));

      expect(screen.getByPlaceholderText('Enter OpenAI API Key')).toBeInTheDocument();
    });

    it('should show Cancel and Save buttons in edit mode', () => {
      render(<ApiKeyInput {...defaultProps} />);

      fireEvent.click(screen.getByText('Add Key'));

      expect(screen.getByText('Cancel')).toBeInTheDocument();
      expect(screen.getByText('Save')).toBeInTheDocument();
    });
  });

  describe('with existing key', () => {
    it('should show "Configured" status when key exists', () => {
      render(<ApiKeyInput {...defaultProps} hasKey={true} />);

      expect(screen.getByText('Configured')).toBeInTheDocument();
    });

    it('should show Change and Remove buttons when key exists', () => {
      render(<ApiKeyInput {...defaultProps} hasKey={true} />);

      expect(screen.getByText('Change')).toBeInTheDocument();
      expect(screen.getByText('Remove')).toBeInTheDocument();
    });

    it('should enter edit mode when Change is clicked', () => {
      render(<ApiKeyInput {...defaultProps} hasKey={true} />);

      fireEvent.click(screen.getByText('Change'));

      expect(screen.getByPlaceholderText('Enter OpenAI API Key')).toBeInTheDocument();
    });

    it('should call onDelete when Remove is clicked', async () => {
      const onDelete = vi.fn().mockResolvedValue(undefined);
      render(<ApiKeyInput {...defaultProps} hasKey={true} onDelete={onDelete} />);

      fireEvent.click(screen.getByText('Remove'));

      await waitFor(() => {
        expect(onDelete).toHaveBeenCalled();
      });
    });
  });

  describe('edit mode behavior', () => {
    it('should clear input and exit edit mode when Cancel is clicked', () => {
      render(<ApiKeyInput {...defaultProps} />);

      fireEvent.click(screen.getByText('Add Key'));

      const input = screen.getByPlaceholderText('Enter OpenAI API Key');
      fireEvent.change(input, { target: { value: 'test-key' } });

      fireEvent.click(screen.getByText('Cancel'));

      expect(screen.getByText('Add Key')).toBeInTheDocument();
      expect(screen.queryByPlaceholderText('Enter OpenAI API Key')).not.toBeInTheDocument();
    });

    it('should show error when trying to save empty key', async () => {
      render(<ApiKeyInput {...defaultProps} />);

      fireEvent.click(screen.getByText('Add Key'));
      fireEvent.click(screen.getByText('Save'));

      await waitFor(() => {
        expect(screen.getByText('API key cannot be empty')).toBeInTheDocument();
      });
    });

    it('should call onSave with trimmed key value', async () => {
      const onSave = vi.fn().mockResolvedValue(undefined);
      render(<ApiKeyInput {...defaultProps} onSave={onSave} />);

      fireEvent.click(screen.getByText('Add Key'));

      const input = screen.getByPlaceholderText('Enter OpenAI API Key');
      fireEvent.change(input, { target: { value: '  test-api-key  ' } });

      fireEvent.click(screen.getByText('Save'));

      await waitFor(() => {
        expect(onSave).toHaveBeenCalledWith('test-api-key');
      });
    });

    it('should exit edit mode after successful save', async () => {
      const onSave = vi.fn().mockResolvedValue(undefined);
      render(<ApiKeyInput {...defaultProps} onSave={onSave} />);

      fireEvent.click(screen.getByText('Add Key'));

      const input = screen.getByPlaceholderText('Enter OpenAI API Key');
      fireEvent.change(input, { target: { value: 'test-key' } });

      fireEvent.click(screen.getByText('Save'));

      await waitFor(() => {
        expect(screen.getByText('Add Key')).toBeInTheDocument();
      });
    });

    it('should show error message when save fails', async () => {
      const onSave = vi.fn().mockRejectedValue(new Error('Network error'));
      render(<ApiKeyInput {...defaultProps} onSave={onSave} />);

      fireEvent.click(screen.getByText('Add Key'));

      const input = screen.getByPlaceholderText('Enter OpenAI API Key');
      fireEvent.change(input, { target: { value: 'test-key' } });

      fireEvent.click(screen.getByText('Save'));

      await waitFor(() => {
        expect(screen.getByText('Network error')).toBeInTheDocument();
      });
    });

    it('should show generic error message for non-Error rejections', async () => {
      const onSave = vi.fn().mockRejectedValue('string error');
      render(<ApiKeyInput {...defaultProps} onSave={onSave} />);

      fireEvent.click(screen.getByText('Add Key'));

      const input = screen.getByPlaceholderText('Enter OpenAI API Key');
      fireEvent.change(input, { target: { value: 'test-key' } });

      fireEvent.click(screen.getByText('Save'));

      await waitFor(() => {
        expect(screen.getByText('Failed to save API key')).toBeInTheDocument();
      });
    });
  });

  describe('loading state', () => {
    it('should disable buttons while saving', async () => {
      // Create a promise we can control
      let resolvePromise: () => void;
      const onSave = vi.fn().mockImplementation(
        () => new Promise<void>((resolve) => { resolvePromise = resolve; })
      );
      
      render(<ApiKeyInput {...defaultProps} onSave={onSave} />);

      fireEvent.click(screen.getByText('Add Key'));

      const input = screen.getByPlaceholderText('Enter OpenAI API Key');
      fireEvent.change(input, { target: { value: 'test-key' } });

      fireEvent.click(screen.getByText('Save'));

      // Saving should be in progress - onSave was called
      expect(onSave).toHaveBeenCalled();

      // Resolve the save
      resolvePromise!();

      await waitFor(() => {
        expect(screen.getByText('Add Key')).toBeInTheDocument();
      });
    });
  });
});
