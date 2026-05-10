/**
 * Sandbox browser controller using Playwright with bundled Chromium.
 *
 * This launches an isolated browser instance using Playwright's bundled
 * Chromium, providing a clean browser session without any user data.
 */
import { chromium } from "playwright";
import type { Browser, BrowserContext, Page, CDPSession } from "playwright";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import type {
  BrowserController,
  BrowserInstance,
  BrowserCreateOptions,
  BrowserControllerOptions,
  ScreenshotOptions,
  ScreenshotResult,
  ElementInfo,
  WaitOptions,
  ClickOptions,
  TypeOptions,
  BrowserEvent,
  ScreencastOptions,
} from "@ants/agent-browser-core";

/** Setup event for tracking installation progress */
export interface SetupEvent {
  type: "setup.start" | "setup.progress" | "setup.complete" | "setup.error";
  component: string;
  message: string;
  progress?: number;
  error?: string;
}

/**
 * Options for creating a sandbox browser controller.
 */
export interface SandboxControllerOptions extends BrowserControllerOptions {
  /**
   * Run browser in headless mode.
   * @default false (sandbox browsers are visible by default)
   */
  headless?: boolean;

  /**
   * Default viewport dimensions.
   */
  defaultViewport?: { width: number; height: number };

  /**
   * Callback for setup events (e.g., browser download progress).
   */
  onSetupEvent?: (event: SetupEvent) => void;
}

interface BrowserState {
  instance: BrowserInstance;
  context: BrowserContext;
  page: Page;
  cdpSession?: CDPSession;
  screencastActive?: boolean;
}

let idCounter = 0;
function generateBrowserId(): string {
  return `sandbox-${Date.now()}-${++idCounter}`;
}

let browsersInstalled = false;

/**
 * Ensure Playwright browsers are installed.
 * This is called automatically on first browser creation.
 */
async function ensureBrowsersInstalled(onSetupEvent?: (event: SetupEvent) => void): Promise<void> {
  if (browsersInstalled) return;

  console.log('[browser-sandbox] Checking if browsers are installed...');
  
  // Get the expected browser path
  const execPath = chromium.executablePath();
  console.log('[browser-sandbox] Expected browser path:', execPath);

  // Check if the browser executable actually exists
  if (existsSync(execPath)) {
    console.log('[browser-sandbox] Browser already installed');
    browsersInstalled = true;
    return;
  }

  console.log('[browser-sandbox] Browser not installed, starting download...');

  // Browsers not installed, install them
  onSetupEvent?.({
    type: "setup.start",
    component: "browser",
    message: "Downloading browser (first-time setup)...",
  });

  try {
    await new Promise<void>((resolve, reject) => {
      console.log('[browser-sandbox] Spawning playwright install...');
      const child = spawn('npx', ['playwright', 'install', 'chromium'], {
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: true,
      });

      let lastProgress = 0;

      // Parse output for download progress
      const handleOutput = (data: Buffer) => {
        const text = data.toString();
        console.log('[browser-sandbox] Output:', text);
        
        // Playwright outputs progress like "Downloading Chromium 123.0.6312.4 (playwright build v1140) from https://... - 45.2 Mb / 150 Mb"
        const progressMatch = text.match(/(\d+(?:\.\d+)?)\s*(?:Mb|MB)\s*\/\s*(\d+(?:\.\d+)?)\s*(?:Mb|MB)/i);
        if (progressMatch && progressMatch[1] && progressMatch[2]) {
          const current = parseFloat(progressMatch[1]);
          const total = parseFloat(progressMatch[2]);
          const progress = current / total;
          
          // Only emit if progress changed significantly
          if (progress - lastProgress >= 0.05 || progress >= 0.99) {
            lastProgress = progress;
            onSetupEvent?.({
              type: "setup.progress",
              component: "browser",
              message: "Downloading browser...",
              progress,
            });
          }
        }
      };

      child.stdout?.on('data', handleOutput);
      child.stderr?.on('data', handleOutput);

      const timeout = setTimeout(() => {
        child.kill();
        reject(new Error('Browser installation timed out after 5 minutes'));
      }, 300000);

      child.on('close', (code) => {
        clearTimeout(timeout);
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`Installation process exited with code ${code}`));
        }
      });

      child.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });

    browsersInstalled = true;
    onSetupEvent?.({
      type: "setup.complete",
      component: "browser",
      message: "Browser download complete",
    });
  } catch (installError) {
    const errorMsg = installError instanceof Error ? installError.message : String(installError);
    onSetupEvent?.({
      type: "setup.error",
      component: "browser",
      message: "Failed to download browser",
      error: errorMsg,
    });
    throw new Error(
      `Failed to install Playwright browsers. Please run 'npx playwright install chromium' manually. ` +
      `Error: ${errorMsg}`
    );
  }
}

/**
 * Sandbox browser controller using Playwright with bundled Chromium.
 *
 * Creates isolated browser sessions for automated tasks.
 * Each browser instance has its own context (cookies, storage, etc.).
 *
 * @example
 * ```typescript
 * import { SandboxBrowserController } from "@ants/agent-browser-sandbox";
 *
 * const controller = new SandboxBrowserController({
 *   headless: false,
 *   onBrowserCreated: (instance) => {
 *     console.log("Browser created:", instance.id);
 *   },
 * });
 *
 * const instance = await controller.create({ url: "https://example.com" });
 * ```
 */
export class SandboxBrowserController implements BrowserController {
  readonly platform = "sandbox";
  private options: SandboxControllerOptions;
  private browser: Browser | null = null;
  private browsers: Map<string, BrowserState> = new Map();
  private defaultTimeout: number;

  // Event callbacks
  private onBrowserCreated?: (instance: BrowserInstance) => void;
  private onBrowserClosed?: (browserId: string) => void;
  private onEvent?: (event: BrowserEvent) => void;
  private userNavigationCallback?: (browserId: string, url: string) => void;
  private consoleCallback?: (browserId: string, type: string, message: string) => void;
  private errorCallback?: (browserId: string, error: string) => void;

  constructor(options: SandboxControllerOptions = {}) {
    this.options = options;
    this.defaultTimeout = options.defaultTimeout ?? 30000;
    this.onBrowserCreated = options.onBrowserCreated;
    this.onBrowserClosed = options.onBrowserClosed;
    this.onEvent = options.onEvent;
  }

  private emitEvent(event: BrowserEvent): void {
    this.onEvent?.(event);
  }

  private async ensureBrowser(): Promise<Browser> {
    if (!this.browser) {
      // Ensure browsers are installed on first use
      await ensureBrowsersInstalled(this.options.onSetupEvent);

      this.browser = await chromium.launch({
        headless: this.options.headless ?? false,
      });
    }
    return this.browser;
  }

  private getState(browserId: string): BrowserState {
    const state = this.browsers.get(browserId);
    if (!state) {
      throw new Error(`Browser not found: ${browserId}`);
    }
    return state;
  }

  private async updateInstanceState(state: BrowserState): Promise<void> {
    const { page, instance } = state;
    try {
      instance.url = page.url();
      instance.title = await page.title();
    } catch {
      // Page might be navigating
    }
  }

  // --------------------------------------------------------------------------
  // Lifecycle
  // --------------------------------------------------------------------------

  async create(options: BrowserCreateOptions = {}): Promise<BrowserInstance> {
    const browser = await this.ensureBrowser();

    // Create isolated context for this browser instance
    const contextOptions: Parameters<Browser["newContext"]>[0] = {};

    if (options.width && options.height) {
      contextOptions.viewport = { width: options.width, height: options.height };
    } else if (this.options.defaultViewport) {
      contextOptions.viewport = this.options.defaultViewport;
    }

    if (options.userAgent) {
      contextOptions.userAgent = options.userAgent;
    }
    if (options.headers) {
      contextOptions.extraHTTPHeaders = options.headers;
    }

    const context = await browser.newContext(contextOptions);
    const page = await context.newPage();
    const id = generateBrowserId();

    const instance: BrowserInstance = {
      id,
      url: "about:blank",
      title: "",
      loading: false,
      canGoBack: false,
      canGoForward: false,
      view: page,
      createdAt: Date.now(),
    };

    const state: BrowserState = { instance, context, page };
    this.browsers.set(id, state);

    // Set up event listeners
    this.setupPageListeners(state);

    // Navigate to initial URL
    if (options.url) {
      await page.goto(options.url, { waitUntil: "domcontentloaded" });
      await this.updateInstanceState(state);
    }

    this.onBrowserCreated?.(instance);
    this.emitEvent({
      type: "browser.created",
      browserId: id,
      url: instance.url,
      view: page,
    });

    return instance;
  }

  private setupPageListeners(state: BrowserState): void {
    const { page, instance } = state;
    const browserId = instance.id;

    // Navigation events
    page.on("framenavigated", async (frame) => {
      if (frame === page.mainFrame()) {
        await this.updateInstanceState(state);
        this.emitEvent({
          type: "browser.navigated",
          browserId,
          url: instance.url,
          title: instance.title,
          userInitiated: false,
        });
        this.userNavigationCallback?.(browserId, instance.url);
      }
    });

    // Loading state
    page.on("load", () => {
      instance.loading = false;
      this.emitEvent({ type: "browser.loading", browserId, loading: false });
    });

    // Console messages
    page.on("console", (msg) => {
      const type = msg.type();
      const text = msg.text();
      this.consoleCallback?.(browserId, type, text);
      this.emitEvent({
        type: "browser.console",
        browserId,
        level: type as "log" | "warn" | "error" | "info" | "debug",
        message: text,
      });
    });

    // Page errors
    page.on("pageerror", (error) => {
      const message = error.message;
      this.errorCallback?.(browserId, message);
      this.emitEvent({ type: "browser.error", browserId, error: message });
    });
  }

  async close(browserId: string): Promise<void> {
    const state = this.browsers.get(browserId);
    if (state) {
      await state.context.close(); // Closes page and context together
      this.browsers.delete(browserId);
      this.onBrowserClosed?.(browserId);
      this.emitEvent({ type: "browser.closed", browserId });
    }
  }

  async closeAll(): Promise<void> {
    const ids = [...this.browsers.keys()];
    for (const id of ids) {
      await this.close(id);
    }
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }

  /**
   * Shutdown the controller and close the browser.
   */
  async shutdown(): Promise<void> {
    await this.closeAll();
  }

  get(browserId: string): BrowserInstance | undefined {
    return this.browsers.get(browserId)?.instance;
  }

  getAll(): BrowserInstance[] {
    return [...this.browsers.values()].map((s) => s.instance);
  }

  // --------------------------------------------------------------------------
  // Navigation
  // --------------------------------------------------------------------------

  async navigate(browserId: string, url: string, options?: WaitOptions): Promise<void> {
    const { page, instance } = this.getState(browserId);
    instance.loading = true;
    this.emitEvent({ type: "browser.loading", browserId, loading: true });

    await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: options?.timeout ?? this.defaultTimeout,
    });
    instance.loading = false;
    await this.updateInstanceState(this.getState(browserId));
  }

  async goBack(browserId: string, options?: WaitOptions): Promise<void> {
    const { page } = this.getState(browserId);
    await page.goBack({
      waitUntil: "domcontentloaded",
      timeout: options?.timeout ?? this.defaultTimeout,
    });
    await this.updateInstanceState(this.getState(browserId));
  }

  async goForward(browserId: string, options?: WaitOptions): Promise<void> {
    const { page } = this.getState(browserId);
    await page.goForward({
      waitUntil: "domcontentloaded",
      timeout: options?.timeout ?? this.defaultTimeout,
    });
    await this.updateInstanceState(this.getState(browserId));
  }

  async reload(browserId: string, options?: WaitOptions): Promise<void> {
    const { page } = this.getState(browserId);
    await page.reload({
      waitUntil: "domcontentloaded",
      timeout: options?.timeout ?? this.defaultTimeout,
    });
    await this.updateInstanceState(this.getState(browserId));
  }

  // --------------------------------------------------------------------------
  // Page Information
  // --------------------------------------------------------------------------

  async getUrl(browserId: string): Promise<string> {
    const { page } = this.getState(browserId);
    return page.url();
  }

  async getTitle(browserId: string): Promise<string> {
    const { page } = this.getState(browserId);
    return page.title();
  }

  async getContent(browserId: string): Promise<string> {
    const { page } = this.getState(browserId);
    return page.content();
  }

  async screenshot(browserId: string, options?: ScreenshotOptions): Promise<ScreenshotResult> {
    const { page } = this.getState(browserId);
    const format = options?.format ?? "png";

    const screenshotOptions: Parameters<Page["screenshot"]>[0] = {
      type: format === "webp" ? "png" : format, // Playwright doesn't support webp
      fullPage: options?.fullPage,
      ...(options?.quality && format === "jpeg" ? { quality: options.quality } : {}),
      ...(options?.clip ? { clip: options.clip } : {}),
    };

    const buffer = await page.screenshot(screenshotOptions);
    const data = buffer.toString("base64");
    const viewport = page.viewportSize();

    this.emitEvent({
      type: "browser.screenshot",
      browserId,
      data,
      format,
    });

    return {
      data,
      format,
      width: options?.clip?.width ?? viewport?.width ?? 0,
      height: options?.clip?.height ?? viewport?.height ?? 0,
    };
  }

  // --------------------------------------------------------------------------
  // Element Interaction
  // --------------------------------------------------------------------------

  async click(browserId: string, selector: string, options?: ClickOptions): Promise<void> {
    const { page } = this.getState(browserId);
    await page.click(selector, {
      button: options?.button,
      clickCount: options?.clickCount,
      delay: options?.delay,
    });
  }

  async type(browserId: string, selector: string, text: string, options?: TypeOptions): Promise<void> {
    const { page } = this.getState(browserId);
    if (options?.clear) {
      await page.fill(selector, ""); // Playwright's way to clear
    }
    await page.type(selector, text, { delay: options?.delay });
  }

  async select(browserId: string, selector: string, value: string | string[]): Promise<void> {
    const { page } = this.getState(browserId);
    const values = Array.isArray(value) ? value : [value];
    await page.selectOption(selector, values);
  }

  async check(browserId: string, selector: string, checked: boolean): Promise<void> {
    const { page } = this.getState(browserId);
    if (checked) {
      await page.check(selector);
    } else {
      await page.uncheck(selector);
    }
  }

  async focus(browserId: string, selector: string): Promise<void> {
    const { page } = this.getState(browserId);
    await page.focus(selector);
  }

  async hover(browserId: string, selector: string): Promise<void> {
    const { page } = this.getState(browserId);
    await page.hover(selector);
  }

  async scroll(browserId: string, options: { selector?: string; x?: number; y?: number }): Promise<void> {
    const { page } = this.getState(browserId);
    if (options.selector) {
      await page.locator(options.selector).scrollIntoViewIfNeeded();
    } else {
      await page.evaluate(
        ([x, y]) => {
          window.scrollTo({ left: x ?? 0, top: y ?? 0, behavior: "smooth" });
        },
        [options.x, options.y]
      );
    }
  }

  // --------------------------------------------------------------------------
  // Element Queries
  // --------------------------------------------------------------------------

  async querySelector(browserId: string, selector: string): Promise<ElementInfo> {
    const { page } = this.getState(browserId);

    const info = await page.evaluate((sel) => {
      const element = document.querySelector(sel);
      if (!element) {
        return { exists: false };
      }

      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      const attributes: Record<string, string> = {};
      for (const attr of element.attributes) {
        attributes[attr.name] = attr.value;
      }

      return {
        exists: true,
        tagName: element.tagName.toLowerCase(),
        textContent: element.textContent?.trim().slice(0, 1000) ?? "",
        innerHTML: element.innerHTML.slice(0, 5000),
        attributes,
        boundingBox: {
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
        },
        visible: style.display !== "none" && style.visibility !== "hidden" && rect.width > 0,
      };
    }, selector);

    return info;
  }

  async querySelectorAll(browserId: string, selector: string): Promise<ElementInfo[]> {
    const { page } = this.getState(browserId);

    const infos = await page.evaluate((sel) => {
      const elements = document.querySelectorAll(sel);
      return Array.from(elements).slice(0, 100).map((element) => {
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        const attributes: Record<string, string> = {};
        for (const attr of element.attributes) {
          attributes[attr.name] = attr.value;
        }
        return {
          exists: true,
          tagName: element.tagName.toLowerCase(),
          textContent: element.textContent?.trim().slice(0, 200) ?? "",
          attributes,
          boundingBox: {
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height,
          },
          visible: style.display !== "none" && style.visibility !== "hidden" && rect.width > 0,
        };
      });
    }, selector);

    return infos;
  }

  async waitForSelector(browserId: string, selector: string, options?: WaitOptions): Promise<ElementInfo> {
    const { page } = this.getState(browserId);
    await page.waitForSelector(selector, {
      timeout: options?.timeout ?? this.defaultTimeout,
    });
    return this.querySelector(browserId, selector);
  }

  async waitForNavigation(browserId: string, options?: WaitOptions): Promise<void> {
    const { page } = this.getState(browserId);
    await page.waitForNavigation({
      waitUntil: "domcontentloaded",
      timeout: options?.timeout ?? this.defaultTimeout,
    });
  }

  // --------------------------------------------------------------------------
  // JavaScript Execution
  // --------------------------------------------------------------------------

  async evaluate<T = unknown>(browserId: string, script: string, ...args: unknown[]): Promise<T> {
    const { page } = this.getState(browserId);
    // Wrap script in a function for evaluation
    const fn = new Function(...args.map((_, i) => `arg${i}`), script);
    return page.evaluate(fn as () => T, ...args);
  }

  // --------------------------------------------------------------------------
  // Screencast (CDP-based live streaming)
  // --------------------------------------------------------------------------

  private async getCDPSession(state: BrowserState): Promise<CDPSession> {
    if (!state.cdpSession) {
      state.cdpSession = await state.page.context().newCDPSession(state.page);
    }
    return state.cdpSession;
  }

  async startScreencast(browserId: string, options?: ScreencastOptions): Promise<void> {
    const state = this.getState(browserId);
    const cdp = await this.getCDPSession(state);

    cdp.on("Page.screencastFrame", (params: {
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
      sessionId: number;
    }) => {
      this.emitEvent({
        type: "browser.screencast.frame",
        browserId,
        data: params.data,
        metadata: params.metadata,
        sessionId: params.sessionId,
      });
    });

    await cdp.send("Page.startScreencast", {
      format: options?.format ?? "jpeg",
      quality: options?.quality ?? 40,
      maxWidth: options?.maxWidth ?? 1280,
      maxHeight: options?.maxHeight ?? 720,
      everyNthFrame: options?.everyNthFrame ?? 30,
    });

    state.screencastActive = true;
    this.emitEvent({ type: "browser.screencast.started", browserId });
  }

  async stopScreencast(browserId: string): Promise<void> {
    const state = this.getState(browserId);
    if (state.cdpSession && state.screencastActive) {
      await state.cdpSession.send("Page.stopScreencast");
      state.screencastActive = false;
      this.emitEvent({ type: "browser.screencast.stopped", browserId });
    }
  }

  async ackScreencastFrame(browserId: string, sessionId: number): Promise<void> {
    const state = this.getState(browserId);
    if (state.cdpSession && state.screencastActive) {
      await state.cdpSession.send("Page.screencastFrameAck", { sessionId });
    }
  }

  async sendMouseEvent(browserId: string, event: {
    type: "mousePressed" | "mouseReleased" | "mouseMoved";
    x: number;
    y: number;
    button?: "left" | "right" | "middle" | "none";
    clickCount?: number;
  }): Promise<void> {
    const state = this.getState(browserId);
    const cdp = await this.getCDPSession(state);
    await cdp.send("Input.dispatchMouseEvent", {
      type: event.type,
      x: event.x,
      y: event.y,
      button: event.button ?? "left",
      clickCount: event.clickCount ?? 1,
    });
  }

  async sendKeyEvent(browserId: string, event: {
    type: "keyDown" | "keyUp" | "char";
    key?: string;
    text?: string;
    code?: string;
    modifiers?: number;
  }): Promise<void> {
    const state = this.getState(browserId);
    const cdp = await this.getCDPSession(state);
    await cdp.send("Input.dispatchKeyEvent", {
      type: event.type,
      key: event.key,
      text: event.text,
      code: event.code,
      modifiers: event.modifiers,
    });
  }

  getWSEndpoint(): string | null {
    // Playwright's Browser type from chromium.launch() doesn't expose wsEndpoint()
    // in its public TypeScript types, but it's available at runtime.
    // For full wsEndpoint support, use chromium.launchServer() instead.
    const browser = this.browser as any;
    return browser?._initializer?.wsEndpoint ?? null;
  }

  // --------------------------------------------------------------------------
  // Event Callbacks
  // --------------------------------------------------------------------------

  onUserNavigation(callback: (browserId: string, url: string) => void): void {
    this.userNavigationCallback = callback;
  }

  onConsole(callback: (browserId: string, type: string, message: string) => void): void {
    this.consoleCallback = callback;
  }

  onError(callback: (browserId: string, error: string) => void): void {
    this.errorCallback = callback;
  }
}

/**
 * Create a sandbox browser controller using Playwright's bundled Chromium.
 *
 * @example
 * ```typescript
 * import { createSandboxController } from "@ants/agent-browser-sandbox";
 *
 * const controller = createSandboxController({
 *   headless: false,
 * });
 *
 * // Use with agent
 * await agent.use(createSandboxBrowserPlugin(controller));
 * ```
 */
export function createSandboxController(options?: SandboxControllerOptions): SandboxBrowserController {
  return new SandboxBrowserController(options);
}
