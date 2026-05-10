import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { Switch } from './Switch';
import { mockLightTheme } from '../styles/mockTheme';

// Mock useTheme
vi.mock('../styles/theme', () => ({
  useTheme: () => mockLightTheme,
}));

describe('Switch', () => {
  it('should render in off state', () => {
    const { container } = render(
      <Switch value={false} onValueChange={() => {}} />
    );
    expect(container).toBeTruthy();
  });

  it('should render in on state', () => {
    const { container } = render(
      <Switch value={true} onValueChange={() => {}} />
    );
    expect(container).toBeTruthy();
  });

  it('should call onValueChange when clicked', () => {
    const onValueChange = vi.fn();
    const { container } = render(
      <Switch value={false} onValueChange={onValueChange} />
    );
    
    // Click on the switch container
    const switchElement = container.firstElementChild;
    if (switchElement) {
      fireEvent.click(switchElement);
      expect(onValueChange).toHaveBeenCalledWith(true);
    }
  });

  it('should toggle from on to off', () => {
    const onValueChange = vi.fn();
    const { container } = render(
      <Switch value={true} onValueChange={onValueChange} />
    );
    
    const switchElement = container.firstElementChild;
    if (switchElement) {
      fireEvent.click(switchElement);
      expect(onValueChange).toHaveBeenCalledWith(false);
    }
  });

  it('should accept custom track colors', () => {
    const { container } = render(
      <Switch
        value={true}
        onValueChange={() => {}}
        trackColor={{ false: '#FF0000', true: '#00FF00' }}
      />
    );
    expect(container).toBeTruthy();
  });

  it('should accept custom thumb color', () => {
    const { container } = render(
      <Switch
        value={false}
        onValueChange={() => {}}
        thumbColor="#FFFF00"
      />
    );
    expect(container).toBeTruthy();
  });
});
