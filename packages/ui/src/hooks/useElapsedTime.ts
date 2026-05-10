/**
 * useElapsedTime — Hook that returns a formatted elapsed time string
 * and triggers periodic re-renders while the timer is active.
 *
 * Used by ToolCallBlock and SubagentBlock/SubagentsPanel to show
 * live-updating durations for running items.
 */

import { useState, useEffect, useRef } from 'react';

/**
 * Format elapsed milliseconds into a human-readable string.
 * - < 60s: "Xs" (e.g., "12s")
 * - 1-60m: "Xm Ys" (e.g., "3m 45s")
 * - >= 60m: "Xh Ym" (e.g., "1h 23m")
 */
function formatElapsed(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  if (totalSeconds < 60) {
    return `${totalSeconds}s`;
  }
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) {
    return `${minutes}m ${seconds}s`;
  }
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${remainingMinutes}m`;
}

/**
 * Returns a formatted elapsed time string that updates every second
 * while `isRunning` is true. When not running, returns the final duration.
 *
 * @param startedAt - Timestamp when the timer started (ms since epoch)
 * @param completedAt - Timestamp when the timer stopped (ms since epoch), or undefined if still running
 * @param isRunning - Whether the item is currently running
 */
export function useElapsedTime(
  startedAt: number | undefined,
  completedAt: number | undefined,
  isRunning: boolean,
): string {
  const [, setTick] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (isRunning && startedAt) {
      intervalRef.current = setInterval(() => {
        setTick((t) => t + 1);
      }, 1000);

      return () => {
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
          intervalRef.current = null;
        }
      };
    } else {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    }
  }, [isRunning, startedAt]);

  if (!startedAt) return '';

  const endTime = completedAt || (isRunning ? Date.now() : startedAt);
  const elapsed = endTime - startedAt;
  return formatElapsed(elapsed);
}
