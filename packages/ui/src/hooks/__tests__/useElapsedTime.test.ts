import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useElapsedTime } from '../useElapsedTime';

describe('useElapsedTime', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns empty string when startedAt is undefined', () => {
    const { result } = renderHook(() => useElapsedTime(undefined, undefined, false));
    expect(result.current).toBe('');
  });

  it('formats seconds correctly for completed item', () => {
    const now = Date.now();
    const { result } = renderHook(() => useElapsedTime(now - 30000, now, false));
    expect(result.current).toBe('30s');
  });

  it('formats minutes correctly for completed item', () => {
    const now = Date.now();
    const { result } = renderHook(() => useElapsedTime(now - 150000, now, false));
    expect(result.current).toBe('2m 30s');
  });

  it('formats hours correctly for completed item', () => {
    const now = Date.now();
    const { result } = renderHook(() => useElapsedTime(now - 5400000, now, false));
    expect(result.current).toBe('1h 30m');
  });

  it('updates every second when running', () => {
    const startedAt = Date.now();
    const { result } = renderHook(() => useElapsedTime(startedAt, undefined, true));

    expect(result.current).toBe('0s');

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(result.current).toBe('1s');

    act(() => {
      vi.advanceTimersByTime(4000);
    });
    expect(result.current).toBe('5s');
  });

  it('stops updating when isRunning becomes false', () => {
    const startedAt = Date.now();
    const completedAt = startedAt + 10000;
    const { result, rerender } = renderHook(
      ({ isRunning }) => useElapsedTime(startedAt, isRunning ? undefined : completedAt, isRunning),
      { initialProps: { isRunning: true } },
    );

    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(result.current).toBe('5s');

    // Stop running
    rerender({ isRunning: false });
    expect(result.current).toBe('10s');

    // Timer should not continue
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(result.current).toBe('10s');
  });
});
