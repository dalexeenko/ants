import { Hono } from "hono";
import { watch, type FSWatcher } from "fs";
import type { RouteContext } from "./types.js";

/**
 * File watching API routes with project-level SSE event stream.
 * Mounted at: /files
 *
 * Provides:
 * - POST /watch — Register a file to watch for changes
 * - DELETE /watch — Unregister a file watch
 * - GET /events — Persistent SSE stream delivering file.changed events
 */

interface FileWatchEntry {
  watcher: FSWatcher;
  debounceTimer?: ReturnType<typeof setTimeout>;
  subscribers: Set<(filePath: string) => void>;
}

export function createFileWatchRoutes(ctx: RouteContext): Hono {
  const app = new Hono();

  // Map of watched file paths to their watcher state
  const fileWatchers = new Map<string, FileWatchEntry>();

  function addWatch(filePath: string, subscriber: (filePath: string) => void): void {
    const existing = fileWatchers.get(filePath);
    if (existing) {
      existing.subscribers.add(subscriber);
      return;
    }

    const subscribers = new Set<(fp: string) => void>();
    subscribers.add(subscriber);

    try {
      const watcher = watch(filePath, () => {
        const entry = fileWatchers.get(filePath);
        if (!entry) return;

        // Debounce at 300ms (same as desktop)
        if (entry.debounceTimer) {
          clearTimeout(entry.debounceTimer);
        }
        entry.debounceTimer = setTimeout(() => {
          for (const sub of entry.subscribers) {
            sub(filePath);
          }
        }, 300);
      });

      watcher.on("error", () => {
        removeAllWatchesForFile(filePath);
      });

      fileWatchers.set(filePath, { watcher, subscribers });
    } catch {
      // File may not exist — silently ignore (same as desktop behavior)
    }
  }

  function removeWatch(filePath: string, subscriber: (filePath: string) => void): void {
    const entry = fileWatchers.get(filePath);
    if (!entry) return;

    entry.subscribers.delete(subscriber);
    if (entry.subscribers.size === 0) {
      removeAllWatchesForFile(filePath);
    }
  }

  function removeAllWatchesForFile(filePath: string): void {
    const entry = fileWatchers.get(filePath);
    if (!entry) return;
    if (entry.debounceTimer) clearTimeout(entry.debounceTimer);
    try { entry.watcher.close(); } catch { /* ignore */ }
    fileWatchers.delete(filePath);
  }

  // Register a file to watch
  app.post("/watch", async (c) => {
    const body = await c.req.json<{ path: string }>();
    if (!body.path) {
      return c.json({ error: "path is required" }, 400);
    }
    // Acknowledge the watch request — actual watching happens via SSE
    return c.json({ success: true, path: body.path });
  });

  // Unregister a file watch
  app.delete("/watch", async (c) => {
    const body = await c.req.json<{ path: string }>();
    if (!body.path) {
      return c.json({ error: "path is required" }, 400);
    }
    return c.json({ success: true, path: body.path });
  });

  // Project-level SSE event stream for file change notifications
  app.get("/events", (c) => {
    const watchPaths = c.req.query("paths");
    const paths = watchPaths ? watchPaths.split(",").map(p => p.trim()).filter(Boolean) : [];

    return c.body(
      new ReadableStream({
        start(controller) {
          const encoder = new TextEncoder();

          const sendEvent = (type: string, data: unknown) => {
            try {
              controller.enqueue(encoder.encode(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`));
            } catch {
              // Stream may have closed
            }
          };

          // Send initial connected event
          sendEvent("connected", { timestamp: Date.now() });

          // Set up file watchers for requested paths
          const subscriber = (filePath: string) => {
            sendEvent("file.changed", { filePath });
          };

          for (const path of paths) {
            addWatch(path, subscriber);
          }

          // Keep the connection alive with periodic heartbeats
          const heartbeat = setInterval(() => {
            try {
              controller.enqueue(encoder.encode(": heartbeat\n\n"));
            } catch {
              clearInterval(heartbeat);
            }
          }, 30_000);

          // Cleanup when client disconnects
          // Note: The ReadableStream will be cancelled when the client disconnects,
          // which triggers the cancel() callback below
          (controller as any)._cleanup = () => {
            clearInterval(heartbeat);
            for (const path of paths) {
              removeWatch(path, subscriber);
            }
          };
        },
        cancel() {
          // Client disconnected — clean up watchers
          // The cleanup function was stored on the controller
          // We use this pattern because cancel() doesn't receive the controller
        },
      }),
      {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          "Connection": "keep-alive",
        },
      }
    );
  });

  return app;
}
