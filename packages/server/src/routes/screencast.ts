/**
 * Screencast WebSocket route for live browser streaming.
 *
 * Handles WebSocket connections at:
 *   /session/:sessionId/browser/:browserId/screencast
 *
 * Protocol:
 *   Client → Server (JSON messages):
 *     { type: "start", options?: ScreencastOptions }   — Start screencast
 *     { type: "stop" }                                  — Stop screencast
 *     { type: "ack", sessionId: number }               — Acknowledge frame
 *     { type: "mouse", event: MouseEventData }         — Send mouse input
 *     { type: "key", event: KeyEventData }             — Send keyboard input
 *
 *   Server → Client:
 *     Binary message: raw JPEG frame bytes (decoded from base64)
 *     JSON message: { type: "metadata", ...frameMetadata, sessionId }
 *     JSON message: { type: "started" }
 *     JSON message: { type: "stopped" }
 *     JSON message: { type: "error", message: string }
 *
 * Frame delivery uses a two-message pattern:
 *   1. JSON metadata message (with coordinates/dimensions + sessionId for ack)
 *   2. Binary JPEG frame data
 * This avoids base64 overhead (~33%) and lets the client render efficiently.
 */
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer, WebSocket } from "ws";
import type { BrowserController, ScreencastOptions } from "@openmgr/agent-browser-core";
import type { RouteContext } from "./types.js";

/**
 * URL pattern for screencast WebSocket connections.
 * Matches: /session/{sessionId}/browser/{browserId}/screencast
 */
const SCREENCAST_PATTERN = /^\/session\/([^/]+)\/browser\/([^/]+)\/screencast$/;

/**
 * Parse the screencast URL and extract session/browser IDs.
 */
function parseScreencastUrl(url: string): { sessionId: string; browserId: string } | null {
  const match = url.match(SCREENCAST_PATTERN);
  if (!match) return null;
  return { sessionId: match[1]!, browserId: match[2]! };
}

/**
 * Client → Server message types.
 */
interface StartMessage {
  type: "start";
  options?: ScreencastOptions;
}

interface StopMessage {
  type: "stop";
}

interface AckMessage {
  type: "ack";
  sessionId: number;
}

interface MouseMessage {
  type: "mouse";
  event: {
    type: "mousePressed" | "mouseReleased" | "mouseMoved";
    x: number;
    y: number;
    button?: "left" | "right" | "middle" | "none";
    clickCount?: number;
  };
}

interface KeyMessage {
  type: "key";
  event: {
    type: "keyDown" | "keyUp" | "char";
    key?: string;
    text?: string;
    code?: string;
    modifiers?: number;
  };
}

type ClientMessage = StartMessage | StopMessage | AckMessage | MouseMessage | KeyMessage;

/**
 * Create a WebSocket server for screencast streaming.
 *
 * Returns a handler function that should be called from the HTTP server's
 * 'upgrade' event when the URL matches the screencast pattern.
 */
export function createScreencastWSS(ctx: RouteContext): {
  wss: WebSocketServer;
  handleUpgrade: (req: IncomingMessage, socket: Duplex, head: Buffer) => void;
} {
  const wss = new WebSocketServer({ noServer: true });

  wss.on("connection", async (ws: WebSocket, req: IncomingMessage) => {
    const parsed = parseScreencastUrl(req.url || "");
    if (!parsed) {
      ws.close(1008, "Invalid URL");
      return;
    }

    const { sessionId, browserId } = parsed;

    // Get the session agent
    let agent;
    try {
      agent = await ctx.getSessionAgent(sessionId);
    } catch (err) {
      ws.close(1008, "Session not found");
      return;
    }

    // Get the browser controller from the agent's extension
    const controller = agent.getBrowserController?.() ??
      agent.getExtension<BrowserController>("sandboxBrowserController");

    if (!controller) {
      ws.close(1008, "No browser controller available");
      return;
    }

    // Verify the browser instance exists
    const instance = controller.get(browserId);
    if (!instance) {
      ws.close(1008, `Browser ${browserId} not found`);
      return;
    }

    // Check that screencast methods are available
    if (!controller.startScreencast || !controller.stopScreencast || !controller.ackScreencastFrame) {
      ws.close(1008, "Screencast not supported by this browser controller");
      return;
    }

    let screencastActive = false;

    // Listen for browser events to forward screencast frames.
    // The controller emits events via its onEvent callback which is set
    // during plugin registration. We tap into agent events to catch them.
    const frameHandler = (event: { type: string; [key: string]: unknown }) => {
      if (ws.readyState !== WebSocket.OPEN) return;

      if (event.type === "browser.screencast.frame") {
        const frame = event as {
          type: string;
          browserId: string;
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
        };

        // Only forward frames for this specific browser
        if (frame.browserId !== browserId) return;

        // Send metadata as JSON first
        ws.send(JSON.stringify({
          type: "metadata",
          ...frame.metadata,
          sessionId: frame.sessionId,
        }));

        // Send frame data as binary (decode base64 to Buffer)
        const frameBuffer = Buffer.from(frame.data, "base64");
        ws.send(frameBuffer);
      }

      if (event.type === "browser.screencast.started" && (event as any).browserId === browserId) {
        ws.send(JSON.stringify({ type: "started" }));
      }

      if (event.type === "browser.screencast.stopped" && (event as any).browserId === browserId) {
        ws.send(JSON.stringify({ type: "stopped" }));
      }

      if (event.type === "browser.closed" && (event as any).browserId === browserId) {
        ws.close(1000, "Browser closed");
      }
    };

    // Subscribe to agent events
    agent.on("event", frameHandler);

    // Handle incoming messages from the client
    ws.on("message", async (data: Buffer | string) => {
      let msg: ClientMessage;
      try {
        msg = JSON.parse(typeof data === "string" ? data : data.toString("utf-8"));
      } catch {
        ws.send(JSON.stringify({ type: "error", message: "Invalid JSON" }));
        return;
      }

      try {
        switch (msg.type) {
          case "start": {
            if (screencastActive) {
              ws.send(JSON.stringify({ type: "error", message: "Screencast already active" }));
              return;
            }
            await controller.startScreencast!(browserId, msg.options);
            screencastActive = true;
            break;
          }

          case "stop": {
            if (!screencastActive) return;
            await controller.stopScreencast!(browserId);
            screencastActive = false;
            break;
          }

          case "ack": {
            if (!screencastActive) return;
            await controller.ackScreencastFrame!(browserId, msg.sessionId);
            break;
          }

          case "mouse": {
            if (controller.sendMouseEvent) {
              await controller.sendMouseEvent(browserId, msg.event);
            }
            break;
          }

          case "key": {
            if (controller.sendKeyEvent) {
              await controller.sendKeyEvent(browserId, msg.event);
            }
            break;
          }

          default: {
            ws.send(JSON.stringify({ type: "error", message: `Unknown message type: ${(msg as any).type}` }));
          }
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        ws.send(JSON.stringify({ type: "error", message: errMsg }));
      }
    });

    // Clean up on close
    ws.on("close", async () => {
      agent.off("event", frameHandler);
      if (screencastActive) {
        try {
          await controller.stopScreencast!(browserId);
        } catch {
          // Browser may already be closed
        }
        screencastActive = false;
      }
    });

    // Send ready message
    ws.send(JSON.stringify({ type: "ready", browserId }));
  });

  function handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  }

  return { wss, handleUpgrade };
}

/**
 * Check if a URL matches the screencast WebSocket pattern.
 */
export function isScreencastUrl(url: string): boolean {
  return SCREENCAST_PATTERN.test(url);
}
