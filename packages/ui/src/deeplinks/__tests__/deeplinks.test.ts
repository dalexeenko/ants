import { describe, it, expect } from 'vitest';
import {
  parseDeeplink,
  buildDeeplink,
  DEEPLINK_SCHEME,
  DEEPLINK_PREFIX,
  type DeeplinkRoute,
  type BuildableDeeplinkRoute,
  type SettingsSectionId,
  createDeeplinkHandler,
} from '../index';

// ============ parseDeeplink Tests ============

describe('parseDeeplink', () => {
  describe('home route', () => {
    it('should parse ants:// as home', () => {
      const route = parseDeeplink('ants://');
      expect(route).toEqual({ type: 'home' });
    });

    it('should return unknown for ants:/// (triple slash)', () => {
      // ants:/// has an extra slash that produces a "//" pathname, which
      // doesn't match any known route
      const route = parseDeeplink('ants:///');
      expect(route.type).toBe('unknown');
    });

    it('should parse bare "/" path as home', () => {
      const route = parseDeeplink('/');
      expect(route).toEqual({ type: 'home' });
    });
  });

  describe('project route', () => {
    it('should parse project URL', () => {
      const route = parseDeeplink('ants://project/abc-123');
      expect(route).toEqual({ type: 'project', projectId: 'abc-123' });
    });

    it('should decode URL-encoded project IDs', () => {
      const route = parseDeeplink('ants://project/my%20project');
      expect(route).toEqual({ type: 'project', projectId: 'my project' });
    });

    it('should parse project from path-only format', () => {
      const route = parseDeeplink('/project/proj-1');
      expect(route).toEqual({ type: 'project', projectId: 'proj-1' });
    });
  });

  describe('session route', () => {
    it('should parse session URL', () => {
      const route = parseDeeplink('ants://project/proj-1/session/sess-1');
      expect(route).toEqual({
        type: 'session',
        projectId: 'proj-1',
        sessionId: 'sess-1',
      });
    });

    it('should decode URL-encoded IDs in session route', () => {
      const route = parseDeeplink('ants://project/p%201/session/s%202');
      expect(route).toEqual({
        type: 'session',
        projectId: 'p 1',
        sessionId: 's 2',
      });
    });
  });

  describe('project-settings route', () => {
    it('should parse project settings URL', () => {
      const route = parseDeeplink('ants://project/proj-1/settings');
      expect(route).toEqual({
        type: 'project-settings',
        projectId: 'proj-1',
      });
    });

    it('should decode URL-encoded project ID in settings', () => {
      const route = parseDeeplink('ants://project/my%20proj/settings');
      expect(route).toEqual({
        type: 'project-settings',
        projectId: 'my proj',
      });
    });
  });

  describe('settings route', () => {
    it('should parse settings URL without section', () => {
      const route = parseDeeplink('ants://settings');
      expect(route).toEqual({ type: 'settings' });
    });

    it('should parse settings URL with section', () => {
      const route = parseDeeplink('ants://settings/authentication');
      expect(route).toEqual({
        type: 'settings',
        section: 'authentication',
      });
    });

    it.each([
      'general',
      'authentication',
      'remote-servers',
      'mcp-servers',
      'permissions',
      'theme',
    ] as SettingsSectionId[])('should parse settings/%s section', (section) => {
      const route = parseDeeplink(`ants://settings/${section}`);
      expect(route).toEqual({ type: 'settings', section });
    });

    it('should parse settings from path-only', () => {
      const route = parseDeeplink('/settings/general');
      expect(route).toEqual({ type: 'settings', section: 'general' });
    });
  });

  describe('auth-callback route', () => {
    it('should parse auth callback with code', () => {
      const route = parseDeeplink('ants://auth/callback?code=abc123');
      expect(route).toEqual({
        type: 'auth-callback',
        code: 'abc123',
        state: undefined,
      });
    });

    it('should parse auth callback with code and state', () => {
      const route = parseDeeplink('ants://auth/callback?code=abc&state=xyz');
      expect(route).toEqual({
        type: 'auth-callback',
        code: 'abc',
        state: 'xyz',
      });
    });

    it('should return unknown for auth callback without code', () => {
      const route = parseDeeplink('ants://auth/callback');
      expect(route.type).toBe('unknown');
    });

    it('should return unknown for auth callback with empty code', () => {
      const route = parseDeeplink('ants://auth/callback?code=');
      // Empty string is falsy, so this falls through to unknown
      expect(route.type).toBe('unknown');
    });
  });

  describe('connect route', () => {
    it('should parse connect URL with url param', () => {
      const route = parseDeeplink('ants://connect?url=https://server.example.com');
      expect(route).toEqual({
        type: 'connect',
        url: 'https://server.example.com',
        name: undefined,
      });
    });

    it('should parse connect URL with url and name params', () => {
      const route = parseDeeplink(
        'ants://connect?url=https://server.com&name=My%20Server',
      );
      expect(route).toEqual({
        type: 'connect',
        url: 'https://server.com',
        name: 'My Server',
      });
    });

    it('should return unknown for connect without url param', () => {
      const route = parseDeeplink('ants://connect');
      expect(route.type).toBe('unknown');
    });
  });

  describe('open route', () => {
    it('should parse open URL with path param', () => {
      const route = parseDeeplink('ants://open?path=/home/user/project');
      expect(route).toEqual({
        type: 'open',
        path: '/home/user/project',
      });
    });

    it('should return unknown for open without path param', () => {
      const route = parseDeeplink('ants://open');
      expect(route.type).toBe('unknown');
    });

    it('should handle URL-encoded paths', () => {
      const route = parseDeeplink('ants://open?path=%2Fhome%2Fuser%2Fmy%20project');
      expect(route).toEqual({
        type: 'open',
        path: '/home/user/my project',
      });
    });
  });

  describe('unknown / invalid routes', () => {
    it('should return unknown for unrecognized path', () => {
      const route = parseDeeplink('ants://some/random/path');
      expect(route).toEqual({
        type: 'unknown',
        url: 'ants://some/random/path',
      });
    });

    it('should return unknown for completely invalid URL', () => {
      const route = parseDeeplink('not a valid url at all !!!');
      expect(route).toEqual({
        type: 'unknown',
        url: 'not a valid url at all !!!',
      });
    });

    it('should return unknown for empty string', () => {
      const route = parseDeeplink('');
      // Empty string → URL constructor may throw or create empty path
      expect(route.type).toBe('unknown');
    });

    it('should handle http:// URLs (non-scheme)', () => {
      const route = parseDeeplink('http://ants/project/abc');
      expect(route).toEqual({ type: 'project', projectId: 'abc' });
    });

    it('should return unknown for deeply nested unrecognized paths', () => {
      const route = parseDeeplink('ants://project/abc/session/def/extra');
      expect(route.type).toBe('unknown');
    });
  });
});

// ============ buildDeeplink Tests ============

describe('buildDeeplink', () => {
  it('should build home URL', () => {
    const url = buildDeeplink({ type: 'home' });
    expect(url).toBe('ants://');
  });

  it('should build project URL', () => {
    const url = buildDeeplink({ type: 'project', projectId: 'proj-1' });
    expect(url).toBe('ants://project/proj-1');
  });

  it('should encode special characters in project ID', () => {
    const url = buildDeeplink({ type: 'project', projectId: 'my project' });
    expect(url).toBe('ants://project/my%20project');
  });

  it('should build session URL', () => {
    const url = buildDeeplink({
      type: 'session',
      projectId: 'proj-1',
      sessionId: 'sess-1',
    });
    expect(url).toBe('ants://project/proj-1/session/sess-1');
  });

  it('should build project-settings URL', () => {
    const url = buildDeeplink({ type: 'project-settings', projectId: 'proj-1' });
    expect(url).toBe('ants://project/proj-1/settings');
  });

  it('should build settings URL without section', () => {
    const url = buildDeeplink({ type: 'settings' });
    expect(url).toBe('ants://settings');
  });

  it('should build settings URL with section', () => {
    const url = buildDeeplink({ type: 'settings', section: 'authentication' });
    expect(url).toBe('ants://settings/authentication');
  });

  it('should build auth-callback URL with code only', () => {
    const url = buildDeeplink({ type: 'auth-callback', code: 'mycode' });
    expect(url).toBe('ants://auth/callback?code=mycode');
  });

  it('should build auth-callback URL with code and state', () => {
    const url = buildDeeplink({
      type: 'auth-callback',
      code: 'mycode',
      state: 'mystate',
    });
    expect(url).toContain('code=mycode');
    expect(url).toContain('state=mystate');
    expect(url).toMatch(/^ants:\/\/auth\/callback\?/);
  });

  it('should build connect URL with url only', () => {
    const url = buildDeeplink({
      type: 'connect',
      url: 'https://server.com',
    });
    expect(url).toContain('url=https');
    expect(url).toMatch(/^ants:\/\/connect\?/);
  });

  it('should build connect URL with url and name', () => {
    const url = buildDeeplink({
      type: 'connect',
      url: 'https://server.com',
      name: 'My Server',
    });
    expect(url).toContain('url=');
    expect(url).toContain('name=My+Server');
    expect(url).toMatch(/^ants:\/\/connect\?/);
  });

  it('should build open URL', () => {
    const url = buildDeeplink({ type: 'open', path: '/home/user/project' });
    expect(url).toBe('ants://open?path=%2Fhome%2Fuser%2Fproject');
  });

  it('should encode spaces in open path', () => {
    const url = buildDeeplink({ type: 'open', path: '/my project' });
    expect(url).toContain('path=%2Fmy%20project');
  });
});

// ============ Round-trip Tests (build → parse) ============

describe('round-trip: buildDeeplink → parseDeeplink', () => {
  const roundTrip = (route: BuildableDeeplinkRoute): DeeplinkRoute => {
    const url = buildDeeplink(route);
    return parseDeeplink(url);
  };

  it('should round-trip home', () => {
    expect(roundTrip({ type: 'home' })).toEqual({ type: 'home' });
  });

  it('should round-trip project', () => {
    const route: BuildableDeeplinkRoute = { type: 'project', projectId: 'proj-123' };
    expect(roundTrip(route)).toEqual(route);
  });

  it('should round-trip project with special chars', () => {
    const route: BuildableDeeplinkRoute = { type: 'project', projectId: 'hello world' };
    expect(roundTrip(route)).toEqual(route);
  });

  it('should round-trip session', () => {
    const route: BuildableDeeplinkRoute = {
      type: 'session',
      projectId: 'proj-1',
      sessionId: 'sess-1',
    };
    expect(roundTrip(route)).toEqual(route);
  });

  it('should round-trip project-settings', () => {
    const route: BuildableDeeplinkRoute = {
      type: 'project-settings',
      projectId: 'proj-1',
    };
    expect(roundTrip(route)).toEqual(route);
  });

  it('should round-trip settings without section', () => {
    const route: BuildableDeeplinkRoute = { type: 'settings' };
    // parseDeeplink returns { type: 'settings' } without section
    expect(roundTrip(route)).toEqual({ type: 'settings' });
  });

  it('should round-trip settings with section', () => {
    const route: BuildableDeeplinkRoute = {
      type: 'settings',
      section: 'remote-servers',
    };
    expect(roundTrip(route)).toEqual(route);
  });

  it('should round-trip auth-callback', () => {
    const route: BuildableDeeplinkRoute = {
      type: 'auth-callback',
      code: 'authcode123',
      state: 'statevalue',
    };
    expect(roundTrip(route)).toEqual(route);
  });

  it('should round-trip auth-callback without state', () => {
    const route: BuildableDeeplinkRoute = {
      type: 'auth-callback',
      code: 'authcode123',
    };
    const result = roundTrip(route);
    expect(result).toEqual({
      type: 'auth-callback',
      code: 'authcode123',
      state: undefined,
    });
  });

  it('should round-trip connect', () => {
    const route: BuildableDeeplinkRoute = {
      type: 'connect',
      url: 'https://my-server.com:8080',
    };
    const result = roundTrip(route);
    expect(result.type).toBe('connect');
    expect((result as any).url).toBe('https://my-server.com:8080');
  });

  it('should round-trip connect with name', () => {
    const route: BuildableDeeplinkRoute = {
      type: 'connect',
      url: 'https://server.com',
      name: 'Production',
    };
    const result = roundTrip(route);
    expect(result.type).toBe('connect');
    expect((result as any).url).toBe('https://server.com');
    expect((result as any).name).toBe('Production');
  });

  it('should round-trip open', () => {
    const route: BuildableDeeplinkRoute = {
      type: 'open',
      path: '/home/user/my-project',
    };
    expect(roundTrip(route)).toEqual(route);
  });

  it('should round-trip open with spaces in path', () => {
    const route: BuildableDeeplinkRoute = {
      type: 'open',
      path: '/home/user/my project',
    };
    expect(roundTrip(route)).toEqual(route);
  });
});

// ============ Constants Tests ============

describe('constants', () => {
  it('should export correct scheme', () => {
    expect(DEEPLINK_SCHEME).toBe('ants');
  });

  it('should export correct prefix', () => {
    expect(DEEPLINK_PREFIX).toBe('ants://');
  });
});

// ============ createDeeplinkHandler Tests ============

describe('createDeeplinkHandler', () => {
  it('should parse URL and call handler with route', () => {
    const handler = vi.fn();
    const processUrl = createDeeplinkHandler(handler);

    processUrl('ants://project/abc');

    expect(handler).toHaveBeenCalledWith({
      type: 'project',
      projectId: 'abc',
    });
  });

  it('should handle async handlers', async () => {
    const handler = vi.fn().mockResolvedValue(undefined);
    const processUrl = createDeeplinkHandler(handler);

    await processUrl('ants://settings');

    expect(handler).toHaveBeenCalledWith({ type: 'settings' });
  });

  it('should pass unknown routes to handler', () => {
    const handler = vi.fn();
    const processUrl = createDeeplinkHandler(handler);

    processUrl('ants://garbage/path');

    expect(handler).toHaveBeenCalledWith({
      type: 'unknown',
      url: 'ants://garbage/path',
    });
  });
});
