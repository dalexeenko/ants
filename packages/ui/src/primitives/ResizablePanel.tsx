/**
 * ResizablePanel - A panel that can be resized by dragging its edge.
 * 
 * Supports collapsing when dragged below a threshold.
 * 
 * Performance optimization:
 * - Uses local state for smooth visual resize during drag
 * - Debounces parent state updates to prevent main content re-renders
 * - Only the sidebar reflows during drag, main content updates after pause
 */

import React, { useCallback, useRef, useEffect, useState } from 'react';
import { View, StyleSheet, Platform } from 'react-native';
import { useTheme } from '../styles/theme';

/** Delay in ms before committing width changes to parent layout */
const RESIZE_COMMIT_DELAY = 200;

export interface ResizablePanelProps {
  /** Current width of the panel (from parent state) */
  width: number;
  /** Minimum width before collapsing */
  minWidth: number;
  /** Width threshold - if dragged below this, panel collapses */
  collapseThreshold: number;
  /** Whether the panel is currently collapsed */
  collapsed: boolean;
  /** Which side the resize handle is on */
  handleSide: 'left' | 'right';
  /** Called when width changes (debounced during drag) */
  onWidthChange: (width: number) => void;
  /** Called when panel should collapse/expand */
  onCollapsedChange: (collapsed: boolean) => void;
  /** Panel content */
  children: React.ReactNode;
  /** Additional styles for the container */
  style?: any;
  /** Test ID for the panel container */
  testID?: string;
}

export function ResizablePanel({
  width,
  minWidth,
  collapseThreshold,
  collapsed,
  handleSide,
  onWidthChange,
  onCollapsedChange,
  children,
  style,
  testID,
}: ResizablePanelProps): React.ReactElement | null {
  const { colors } = useTheme();
  const isDragging = useRef(false);
  const startX = useRef(0);
  const startWidth = useRef(0);
  const commitTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  
  // Local visual width - updates immediately during drag for smooth feedback
  const [localWidth, setLocalWidth] = useState(width);
  const [isDraggingState, setIsDraggingState] = useState(false);
  
  // Sync local width with prop when not dragging
  useEffect(() => {
    if (!isDraggingState) {
      setLocalWidth(width);
    }
  }, [width, isDraggingState]);

  // Only works on web
  if (Platform.OS !== 'web') {
    return collapsed ? null : (
      <View style={[{ width }, style]} testID={testID}>
        {children}
      </View>
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const getDocument = () => (typeof globalThis !== 'undefined' ? (globalThis as any).document : null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any  
  const getWindow = () => (typeof globalThis !== 'undefined' ? (globalThis as any).window : null);

  const scheduleCommit = useCallback((newWidth: number) => {
    // Clear any pending commit
    if (commitTimeoutRef.current) {
      clearTimeout(commitTimeoutRef.current);
    }
    
    // Schedule the commit after a delay
    commitTimeoutRef.current = setTimeout(() => {
      onWidthChange(newWidth);
      commitTimeoutRef.current = null;
    }, RESIZE_COMMIT_DELAY);
  }, [onWidthChange]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDragging.current = true;
    setIsDraggingState(true);
    startX.current = e.clientX;
    startWidth.current = localWidth;
    
    // Add cursor style to body during drag
    const doc = getDocument();
    if (doc?.body) {
      doc.body.style.cursor = 'col-resize';
      doc.body.style.userSelect = 'none';
    }
  }, [localWidth]);

  useEffect(() => {
    const win = getWindow();
    const doc = getDocument();
    if (!win) return;

    const handleMouseMove = (e: { clientX: number }) => {
      if (!isDragging.current) return;

      const delta = handleSide === 'right' 
        ? e.clientX - startX.current 
        : startX.current - e.clientX;
      
      const newWidth = startWidth.current + delta;

      // Check if we should collapse
      if (newWidth < collapseThreshold) {
        // Clear any pending commits
        if (commitTimeoutRef.current) {
          clearTimeout(commitTimeoutRef.current);
          commitTimeoutRef.current = null;
        }
        onCollapsedChange(true);
        isDragging.current = false;
        setIsDraggingState(false);
        if (doc?.body) {
          doc.body.style.cursor = '';
          doc.body.style.userSelect = '';
        }
        return;
      }

      // Clamp to minimum width
      const clampedWidth = Math.max(newWidth, minWidth);
      
      // Update local state immediately for smooth visual feedback
      setLocalWidth(clampedWidth);
      
      // Schedule debounced parent update
      scheduleCommit(clampedWidth);
    };

    const handleMouseUp = () => {
      if (isDragging.current) {
        isDragging.current = false;
        
        // Commit final width immediately on mouse up
        if (commitTimeoutRef.current) {
          clearTimeout(commitTimeoutRef.current);
          commitTimeoutRef.current = null;
        }
        
        // Get the current local width for the final commit
        // We need to use a ref or the state value directly
        setLocalWidth((currentWidth) => {
          onWidthChange(currentWidth);
          return currentWidth;
        });
        
        setIsDraggingState(false);
        
        if (doc?.body) {
          doc.body.style.cursor = '';
          doc.body.style.userSelect = '';
        }
      }
    };

    // Use window events to track mouse even when it leaves the handle
    win.addEventListener('mousemove', handleMouseMove);
    win.addEventListener('mouseup', handleMouseUp);

    return () => {
      win.removeEventListener('mousemove', handleMouseMove);
      win.removeEventListener('mouseup', handleMouseUp);
      // Clean up any pending timeouts
      if (commitTimeoutRef.current) {
        clearTimeout(commitTimeoutRef.current);
      }
    };
  }, [handleSide, minWidth, collapseThreshold, onWidthChange, onCollapsedChange, scheduleCommit]);

  if (collapsed) {
    return null;
  }

  // Use local width for smooth visual feedback during drag
  const displayWidth = localWidth;

  return (
    <View style={[styles.container, { width: displayWidth }, style]} testID={testID}>
      {/* Resize handle */}
      <View
        style={[
          styles.handle,
          handleSide === 'left' ? styles.handleLeft : styles.handleRight,
          { backgroundColor: 'transparent' },
        ]}
        // @ts-ignore - web only event
        onMouseDown={handleMouseDown}
      >
        <View 
          style={[
            styles.handleIndicator,
            { backgroundColor: colors.border.light },
            isDraggingState && styles.handleIndicatorActive,
          ]} 
        />
      </View>
      
      {/* Content */}
      <View style={styles.content}>
        {children}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'relative',
    flexDirection: 'row',
  },
  content: {
    flex: 1,
    overflow: 'hidden',
  },
  handle: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 8,
    zIndex: 10,
    cursor: 'col-resize',
    alignItems: 'center',
    justifyContent: 'center',
  } as any,
  handleLeft: {
    left: -4,
  },
  handleRight: {
    right: -4,
  },
  handleIndicator: {
    width: 1,
    height: '100%',
  },
  handleIndicatorActive: {
    width: 2,
    opacity: 0.8,
  },
});
