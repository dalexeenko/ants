import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { renderHook } from '@testing-library/react';
import { PlatformProvider, usePlatform, type PlatformAdapter } from './PlatformContext';

describe('PlatformContext', () => {
  describe('usePlatform', () => {
    it('returns default web adapter when no provider is present', () => {
      const { result } = renderHook(() => usePlatform());
      expect(result.current.platform).toBe('web');
      expect(result.current.openDirectoryDialog).toBeUndefined();
      expect(result.current.onShortcut).toBeUndefined();
      expect(result.current.onDeeplink).toBeUndefined();
      expect(result.current.browserView).toBeUndefined();
    });

    it('returns provided adapter when wrapped in PlatformProvider', () => {
      const adapter: PlatformAdapter = {
        platform: 'desktop',
        openDirectoryDialog: async () => '/test/path',
        getDocumentsPath: async () => '/home/user/Documents',
      };

      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <PlatformProvider adapter={adapter}>{children}</PlatformProvider>
      );

      const { result } = renderHook(() => usePlatform(), { wrapper });
      expect(result.current.platform).toBe('desktop');
      expect(result.current.openDirectoryDialog).toBeDefined();
      expect(result.current.getDocumentsPath).toBeDefined();
    });

    it('provides all optional capabilities from a desktop adapter', () => {
      const onShortcut = () => () => {};
      const onDeeplink = () => () => {};
      const onDirectorNavigate = () => () => {};
      const onDirectorSetTheme = () => () => {};
      const browserView = {
        show: async () => {},
        hide: async () => {},
        hideAll: async () => {},
        setBounds: async () => {},
        destroy: async () => {},
        onNavigated: () => () => {},
      };

      const adapter: PlatformAdapter = {
        platform: 'desktop',
        openDirectoryDialog: async () => null,
        getDocumentsPath: async () => '',
        ensureDirectoryExists: async () => {},
        writeFile: async () => {},
        onShortcut,
        onDeeplink,
        onDirectorNavigate,
        onDirectorSetTheme,
        browserView,
      };

      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <PlatformProvider adapter={adapter}>{children}</PlatformProvider>
      );

      const { result } = renderHook(() => usePlatform(), { wrapper });
      expect(result.current.platform).toBe('desktop');
      expect(result.current.onShortcut).toBe(onShortcut);
      expect(result.current.onDeeplink).toBe(onDeeplink);
      expect(result.current.onDirectorNavigate).toBe(onDirectorNavigate);
      expect(result.current.onDirectorSetTheme).toBe(onDirectorSetTheme);
      expect(result.current.browserView).toBe(browserView);
    });

    it('returns mobile adapter correctly', () => {
      const adapter: PlatformAdapter = {
        platform: 'mobile',
      };

      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <PlatformProvider adapter={adapter}>{children}</PlatformProvider>
      );

      const { result } = renderHook(() => usePlatform(), { wrapper });
      expect(result.current.platform).toBe('mobile');
    });
  });

  describe('PlatformProvider', () => {
    it('renders children correctly', () => {
      const adapter: PlatformAdapter = { platform: 'web' };

      render(
        <PlatformProvider adapter={adapter}>
          <div data-testid="child">Hello</div>
        </PlatformProvider>
      );

      expect(screen.getByTestId('child')).toBeInTheDocument();
      expect(screen.getByTestId('child')).toHaveTextContent('Hello');
    });

    it('allows nested providers with the inner one taking precedence', () => {
      const outerAdapter: PlatformAdapter = { platform: 'web' };
      const innerAdapter: PlatformAdapter = { platform: 'desktop' };

      function Reader() {
        const p = usePlatform();
        return <div data-testid="platform">{p.platform}</div>;
      }

      render(
        <PlatformProvider adapter={outerAdapter}>
          <PlatformProvider adapter={innerAdapter}>
            <Reader />
          </PlatformProvider>
        </PlatformProvider>
      );

      expect(screen.getByTestId('platform')).toHaveTextContent('desktop');
    });
  });
});
