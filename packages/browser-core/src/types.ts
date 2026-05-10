/**
 * Core browser controller types for Ants Agent.
 *
 * These types define the interface between the agent's browser tools
 * and platform-specific browser implementations (Puppeteer, Electron, React Native WebView).
 */
import { z } from "zod";

// ============================================================================
// Zod Schemas (for tool parameter validation)
// ============================================================================

export const BrowserCreateOptionsSchema = z.object({
  url: z.string().url().optional().describe("Initial URL to navigate to"),
  visible: z.boolean().optional().describe("Whether the browser should be visible"),
  width: z.number().positive().optional().describe("Viewport width"),
  height: z.number().positive().optional().describe("Viewport height"),
}).optional();

export const ScreenshotOptionsSchema = z.object({
  format: z.enum(["png", "jpeg", "webp"]).optional().describe("Image format"),
  quality: z.number().min(0).max(100).optional().describe("JPEG/WebP quality"),
  fullPage: z.boolean().optional().describe("Capture full scrollable page"),
}).optional();

export const ClickOptionsSchema = z.object({
  button: z.enum(["left", "right", "middle"]).optional().describe("Mouse button"),
  clickCount: z.number().positive().optional().describe("Number of clicks"),
  delay: z.number().nonnegative().optional().describe("Delay between mousedown/mouseup"),
}).optional();

export const TypeOptionsSchema = z.object({
  delay: z.number().nonnegative().optional().describe("Delay between key presses"),
  clear: z.boolean().optional().describe("Clear input first"),
}).optional();

export const WaitOptionsSchema = z.object({
  timeout: z.number().positive().optional().describe("Timeout in milliseconds"),
}).optional();

export const ScrollOptionsSchema = z.object({
  selector: z.string().optional().describe("Selector to scroll to"),
  x: z.number().optional().describe("X position to scroll to"),
  y: z.number().optional().describe("Y position to scroll to"),
});

// ============================================================================
// TypeScript Interfaces
// ============================================================================

/**
 * Represents a browser instance managed by the agent.
 */
export interface BrowserInstance {
  /** Unique identifier for this browser instance */
  id: string;
  /** Current URL */
  url: string;
  /** Page title */
  title: string;
  /** Whether the browser is currently loading */
  loading: boolean;
  /** Whether the browser can go back */
  canGoBack: boolean;
  /** Whether the browser can go forward */
  canGoForward: boolean;
  /**
   * Platform-specific view object for embedding.
   * - Puppeteer: `puppeteer.Page`
   * - Electron: `Electron.WebContents` or `BrowserView`
   * - React Native: `WebView` ref
   */
  view: unknown;
  /** Creation timestamp */
  createdAt: number;
}

/**
 * Options for creating a new browser instance.
 */
export interface BrowserCreateOptions {
  /** Initial URL to navigate to */
  url?: string;
  /** Whether the browser should be visible (for headed mode) */
  visible?: boolean;
  /** Viewport width */
  width?: number;
  /** Viewport height */
  height?: number;
  /** User agent string */
  userAgent?: string;
  /** Additional headers to send with requests */
  headers?: Record<string, string>;
}

/**
 * Result of a screenshot operation.
 */
export interface ScreenshotResult {
  /** Base64-encoded image data */
  data: string;
  /** Image format */
  format: "png" | "jpeg" | "webp";
  /** Image width */
  width: number;
  /** Image height */
  height: number;
}

/**
 * Options for taking a screenshot.
 */
export interface ScreenshotOptions {
  /** Image format (default: png) */
  format?: "png" | "jpeg" | "webp";
  /** JPEG/WebP quality (0-100) */
  quality?: number;
  /** Whether to capture the full scrollable page */
  fullPage?: boolean;
  /** Clip to a specific region */
  clip?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

/**
 * Element information returned by queries.
 */
export interface ElementInfo {
  /** Whether the element exists */
  exists: boolean;
  /** Element tag name */
  tagName?: string;
  /** Element text content */
  textContent?: string;
  /** Element inner HTML */
  innerHTML?: string;
  /** Element attributes */
  attributes?: Record<string, string>;
  /** Bounding box */
  boundingBox?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  /** Whether the element is visible */
  visible?: boolean;
  /** Index signature for compatibility with Record<string, unknown> */
  [key: string]: unknown;
}

/**
 * Options for waiting operations.
 */
export interface WaitOptions {
  /** Timeout in milliseconds */
  timeout?: number;
}

/**
 * Options for click operations.
 */
export interface ClickOptions {
  /** Mouse button */
  button?: "left" | "right" | "middle";
  /** Number of clicks */
  clickCount?: number;
  /** Delay between mousedown and mouseup in ms */
  delay?: number;
}

/**
 * Options for type operations.
 */
export interface TypeOptions {
  /** Delay between key presses in ms */
  delay?: number;
  /** Whether to clear the input first */
  clear?: boolean;
}

/**
 * Browser controller interface.
 *
 * Implemented by platform-specific packages to provide browser automation.
 * The agent's browser tools call these methods to control browser instances.
 */
export interface BrowserController {
  /** Platform identifier */
  readonly platform: string;

  /**
   * Create a new browser instance.
   * Emits a "browser.created" event with the instance.
   */
  create(options?: BrowserCreateOptions): Promise<BrowserInstance>;

  /**
   * Close a browser instance.
   * Emits a "browser.closed" event.
   */
  close(browserId: string): Promise<void>;

  /**
   * Close all browser instances.
   */
  closeAll(): Promise<void>;

  /**
   * Get a browser instance by ID.
   */
  get(browserId: string): BrowserInstance | undefined;

  /**
   * Get all browser instances.
   */
  getAll(): BrowserInstance[];

  /**
   * Navigate to a URL.
   * Emits a "browser.navigated" event when complete.
   */
  navigate(browserId: string, url: string, options?: WaitOptions): Promise<void>;

  /**
   * Go back in history.
   */
  goBack(browserId: string, options?: WaitOptions): Promise<void>;

  /**
   * Go forward in history.
   */
  goForward(browserId: string, options?: WaitOptions): Promise<void>;

  /**
   * Reload the page.
   */
  reload(browserId: string, options?: WaitOptions): Promise<void>;

  /**
   * Get the current URL.
   */
  getUrl(browserId: string): Promise<string>;

  /**
   * Get the page title.
   */
  getTitle(browserId: string): Promise<string>;

  /**
   * Get the page HTML content.
   */
  getContent(browserId: string): Promise<string>;

  /**
   * Take a screenshot.
   */
  screenshot(browserId: string, options?: ScreenshotOptions): Promise<ScreenshotResult>;

  /**
   * Click on an element.
   */
  click(browserId: string, selector: string, options?: ClickOptions): Promise<void>;

  /**
   * Type text into an element.
   */
  type(browserId: string, selector: string, text: string, options?: TypeOptions): Promise<void>;

  /**
   * Select an option from a dropdown.
   */
  select(browserId: string, selector: string, value: string | string[]): Promise<void>;

  /**
   * Check or uncheck a checkbox.
   */
  check(browserId: string, selector: string, checked: boolean): Promise<void>;

  /**
   * Focus an element.
   */
  focus(browserId: string, selector: string): Promise<void>;

  /**
   * Hover over an element.
   */
  hover(browserId: string, selector: string): Promise<void>;

  /**
   * Scroll to an element or position.
   */
  scroll(browserId: string, options: { selector?: string; x?: number; y?: number }): Promise<void>;

  /**
   * Query an element for information.
   */
  querySelector(browserId: string, selector: string): Promise<ElementInfo>;

  /**
   * Query all matching elements.
   */
  querySelectorAll(browserId: string, selector: string): Promise<ElementInfo[]>;

  /**
   * Wait for an element to appear.
   */
  waitForSelector(browserId: string, selector: string, options?: WaitOptions): Promise<ElementInfo>;

  /**
   * Wait for navigation to complete.
   */
  waitForNavigation(browserId: string, options?: WaitOptions): Promise<void>;

  /**
   * Execute JavaScript in the page context.
   */
  evaluate<T = unknown>(browserId: string, script: string, ...args: unknown[]): Promise<T>;

  // --------------------------------------------------------------------------
  // Screencast (CDP-based live streaming)
  // --------------------------------------------------------------------------

  /**
   * Start streaming screencast frames for a browser instance.
   * Frames are delivered via the onEvent callback as "browser.screencast.frame" events.
   * Call ackScreencastFrame() for each received frame to request the next one.
   */
  startScreencast?(browserId: string, options?: ScreencastOptions): Promise<void>;

  /**
   * Stop screencast streaming for a browser instance.
   */
  stopScreencast?(browserId: string): Promise<void>;

  /**
   * Acknowledge a screencast frame. Must be called for each frame to receive the next one.
   */
  ackScreencastFrame?(browserId: string, sessionId: number): Promise<void>;

  /**
   * Send a mouse event to the browser page (for remote interaction).
   */
  sendMouseEvent?(browserId: string, event: {
    type: "mousePressed" | "mouseReleased" | "mouseMoved";
    x: number;
    y: number;
    button?: "left" | "right" | "middle" | "none";
    clickCount?: number;
  }): Promise<void>;

  /**
   * Send a keyboard event to the browser page (for remote interaction).
   */
  sendKeyEvent?(browserId: string, event: {
    type: "keyDown" | "keyUp" | "char";
    key?: string;
    text?: string;
    code?: string;
    modifiers?: number;
  }): Promise<void>;

  /**
   * Get the CDP WebSocket endpoint URL for the underlying browser.
   * Returns null if the browser hasn't been launched yet.
   */
  getWSEndpoint?(): string | null;

  // --------------------------------------------------------------------------
  // User Interaction Callbacks
  // --------------------------------------------------------------------------

  /**
   * Set callback for when user navigates (not the agent).
   * Enables bidirectional control.
   */
  onUserNavigation?(callback: (browserId: string, url: string) => void): void;

  /**
   * Set callback for console messages from the page.
   */
  onConsole?(callback: (browserId: string, type: string, message: string) => void): void;

  /**
   * Set callback for page errors.
   */
  onError?(callback: (browserId: string, error: string) => void): void;
}

/**
 * Options for creating a browser controller.
 */
export interface BrowserControllerOptions {
  /**
   * Callback when a browser instance is created.
   * App can use this to embed/display the browser view.
   */
  onBrowserCreated?: (instance: BrowserInstance) => void;

  /**
   * Callback when a browser instance is closed.
   */
  onBrowserClosed?: (browserId: string) => void;

  /**
   * Callback for browser events.
   * Can be used to forward events to the agent.
   */
  onEvent?: (event: BrowserEvent) => void;

  /**
   * Enable bidirectional control (user can interact with browser,
   * agent sees those changes).
   * @default true
   */
  bidirectional?: boolean;

  /**
   * Default timeout for operations in milliseconds.
   * @default 30000
   */
  defaultTimeout?: number;
}

// ============================================================================
// Browser Events
// ============================================================================

export interface BrowserCreatedEvent {
  type: "browser.created";
  browserId: string;
  url: string;
  view: unknown;
}

export interface BrowserNavigatedEvent {
  type: "browser.navigated";
  browserId: string;
  url: string;
  title: string;
  /** Whether navigation was initiated by user (not agent) */
  userInitiated: boolean;
}

export interface BrowserLoadingEvent {
  type: "browser.loading";
  browserId: string;
  loading: boolean;
}

export interface BrowserClosedEvent {
  type: "browser.closed";
  browserId: string;
}

export interface BrowserScreenshotEvent {
  type: "browser.screenshot";
  browserId: string;
  data: string;
  format: string;
}

export interface BrowserConsoleEvent {
  type: "browser.console";
  browserId: string;
  level: "log" | "warn" | "error" | "info" | "debug";
  message: string;
}

export interface BrowserErrorEvent {
  type: "browser.error";
  browserId: string;
  error: string;
}

export interface BrowserScreencastStartedEvent {
  type: "browser.screencast.started";
  browserId: string;
}

export interface BrowserScreencastStoppedEvent {
  type: "browser.screencast.stopped";
  browserId: string;
}

export interface BrowserScreencastFrameEvent {
  type: "browser.screencast.frame";
  browserId: string;
  /** Base64-encoded JPEG frame data */
  data: string;
  metadata: {
    offsetTop: number;
    pageScaleFactor: number;
    deviceWidth: number;
    deviceHeight: number;
    scrollOffsetX: number;
    scrollOffsetY: number;
    timestamp?: number;
  };
  /** CDP session ID for frame acknowledgment */
  sessionId: number;
}

export type BrowserEvent =
  | BrowserCreatedEvent
  | BrowserNavigatedEvent
  | BrowserLoadingEvent
  | BrowserClosedEvent
  | BrowserScreenshotEvent
  | BrowserConsoleEvent
  | BrowserErrorEvent
  | BrowserScreencastStartedEvent
  | BrowserScreencastStoppedEvent
  | BrowserScreencastFrameEvent;

// ============================================================================
// Screencast Options
// ============================================================================

/**
 * Options for CDP Page.startScreencast.
 */
export interface ScreencastOptions {
  /** Image format (default: jpeg) */
  format?: "jpeg" | "png";
  /** JPEG quality 0-100 (default: 40) */
  quality?: number;
  /** Maximum width in pixels (default: 1280) */
  maxWidth?: number;
  /** Maximum height in pixels (default: 720) */
  maxHeight?: number;
  /**
   * Send every Nth frame (default: 30 at 60fps compositor = ~2fps).
   * Lower = more frames. Set to 12 for ~5fps during interaction.
   */
  everyNthFrame?: number;
}
