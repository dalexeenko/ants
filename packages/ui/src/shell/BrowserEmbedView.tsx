/**
 * BrowserEmbedView — placeholder for an embedded WebContentsView browser.
 *
 * Renders an empty div that acts as the "slot" where the native WebContentsView
 * will be positioned. Uses ResizeObserver and getBoundingClientRect to report
 * its exact pixel position to the main process via the platform adapter, which
 * then calls setBounds() on the corresponding WebContentsView.
 *
 * The WebContentsView is shown/hidden based on whether this component is mounted
 * and the tab is active.
 */
import React, { useEffect, useRef, useCallback } from 'react';
import { View, StyleSheet } from 'react-native';
import { Text, useTheme, useUIStore, createLogger } from '../index';
import { usePlatform } from '../platform/PlatformContext';

const log = createLogger('BrowserEmbedView');

export interface BrowserEmbedViewProps {
  /** The browser instance ID */
  browserId: string;
  /** Whether this tab is currently active/visible */
  isActive: boolean;
}

export function BrowserEmbedView({ browserId, isActive }: BrowserEmbedViewProps) {
  const theme = useTheme();
  const platform = usePlatform();
  const placeholderRef = useRef<HTMLDivElement | null>(null);
  const rafRef = useRef<number | null>(null);

  /**
   * Report the placeholder's screen-space bounds to the main process.
   */
  const reportBounds = useCallback(() => {
    const el = placeholderRef.current;
    if (!el || !platform.browserView) return;

    const rect = el.getBoundingClientRect();
    // Account for devicePixelRatio — Electron setBounds uses physical pixels on some platforms
    // Actually, Electron's setBounds uses CSS pixels (logical), same as getBoundingClientRect
    const bounds = {
      x: Math.round(rect.left),
      y: Math.round(rect.top),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    };

    if (bounds.width > 0 && bounds.height > 0) {
      platform.browserView.setBounds(browserId, bounds);
    }
  }, [browserId, platform.browserView]);

  /**
   * Show/hide the WebContentsView based on active state.
   */
  useEffect(() => {
    if (!platform.browserView) return;

    if (isActive) {
      // Small delay to let the DOM settle before reporting bounds
      requestAnimationFrame(() => {
        reportBounds();
        platform.browserView!.show(browserId);
      });
    } else {
      platform.browserView.hide(browserId);
    }

    return () => {
      // Hide when unmounting
      platform.browserView?.hide(browserId);
    };
  }, [browserId, isActive, reportBounds, platform.browserView]);

  /**
   * Track the placeholder's position and size with ResizeObserver.
   */
  useEffect(() => {
    const el = placeholderRef.current;
    if (!el || !isActive) return;

    const observer = new ResizeObserver(() => {
      // Debounce with rAF to avoid spamming IPC
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(reportBounds);
    });

    observer.observe(el);

    // Also report on scroll (the bounds may shift)
    const handleScroll = () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(reportBounds);
    };
    window.addEventListener('scroll', handleScroll, true);

    // Also report on window resize
    window.addEventListener('resize', handleScroll);

    return () => {
      observer.disconnect();
      window.removeEventListener('scroll', handleScroll, true);
      window.removeEventListener('resize', handleScroll);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [isActive, reportBounds]);

  /**
   * Clean up the WebContentsView when this component unmounts entirely
   * (e.g., browser tab closed by user).
   */
  useEffect(() => {
    return () => {
      // Don't destroy — the main process manages lifecycle via browser events.
      // Just hide when unmounting.
      platform.browserView?.hide(browserId);
    };
  }, [browserId, platform.browserView]);

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.bg.secondary }]}>
      {/* Toolbar */}
      <View style={[styles.toolbar, { borderBottomColor: theme.colors.border.light }]}>
        <Text style={[styles.toolbarText, { color: theme.colors.text.secondary }]}>
          Browser: {browserId.slice(0, 8)}
        </Text>
        <View style={styles.toolbarRight}>
          <View style={[styles.statusDot, { backgroundColor: theme.colors.success }]} />
          <Text style={[styles.statusText, { color: theme.colors.text.muted }]}>
            embedded
          </Text>
        </View>
      </View>

      {/* Placeholder div — the WebContentsView overlays this exact region */}
      <div
        ref={placeholderRef}
        style={{
          flex: 1,
          minHeight: 0,
          // Transparent so the WebContentsView shows through
          backgroundColor: 'transparent',
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  toolbarText: {
    fontSize: 12,
    fontFamily: 'monospace',
  },
  toolbarRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  statusText: {
    fontSize: 11,
  },
});
