import { Hono } from "hono";
import type { AgentEvent } from "@ants/agent-core";
import type { RouteContext } from "./types.js";

/**
 * Prompt (async + streaming) and abort routes.
 * Mounted at: /session
 */
export function createPromptingRoutes(ctx: RouteContext): Hono {
  const app = new Hono();

  // Send prompt to session (async - returns immediately, processes in background)
  // This is the main prompt endpoint that actually runs the agent
  app.post("/:sessionId/prompt_async", async (c) => {
    const sessions = ctx.state.sessions;
    if (!sessions) {
      return c.json({ error: "Sessions not available" }, 500);
    }
    
    const sessionId = c.req.param("sessionId");
    const body = await c.req.json<{ prompt: string }>();
    
    if (!body.prompt) {
      return c.json({ error: "prompt is required" }, 400);
    }
    
    // Check if session exists
    const session = await sessions.getSession(sessionId);
    if (!session) {
      return c.json({ error: "Session not found" }, 404);
    }
    
    // Check if already processing
    const sessionState = ctx.sessionStates.get(sessionId) || { isActive: false };
    if (sessionState.isActive) {
      return c.json({ error: "Session is already processing a prompt" }, 409);
    }
    
    // Mark as active
    ctx.sessionStates.set(sessionId, { ...sessionState, isActive: true, aborted: false });
    
    try {
      // Get or create an isolated agent for this session
      const sessionAgent = await ctx.getSessionAgent(sessionId);
      
      // Run the session's agent.
      // Message persistence is handled incrementally by the storage
      // plugin's onMessageAdded hook — no batch save needed here.
      const response = await sessionAgent.prompt(body.prompt);
      
      // Mark as complete
      const currentState = ctx.sessionStates.get(sessionId);
      if (currentState) currentState.isActive = false;
      
      return c.json({
        status: "completed",
        success: true,
        message: typeof response.content === "string" ? response.content : JSON.stringify(response.content),
      });
    } catch (error) {
      // Check if this was a user-initiated abort.
      // We check both the session-level flag and the error type since
      // a new prompt may have reset the flag by the time we get here.
      const currentState = ctx.sessionStates.get(sessionId);
      const wasAborted = currentState?.aborted === true
        || (error instanceof DOMException && error.name === 'AbortError')
        || (error instanceof Error && error.message.includes('aborted'));
      if (currentState) {
        currentState.isActive = false;
        currentState.aborted = false;
      }
      
      if (wasAborted) {
        return c.json({
          status: "aborted",
          success: true,
        });
      }
      
      const message = error instanceof Error ? error.message : String(error);
      return c.json({
        status: "error",
        success: false,
        error: message,
      }, 500);
    }
  });

  // Send prompt with SSE streaming
  // Returns Server-Sent Events with agent events as they happen
  app.post("/:sessionId/prompt_stream", async (c) => {
    const sessions = ctx.state.sessions;
    if (!sessions) {
      return c.json({ error: "Sessions not available" }, 500);
    }
    
    const sessionId = c.req.param("sessionId");
    const body = await c.req.json<{ prompt: string }>();
    
    if (!body.prompt) {
      return c.json({ error: "prompt is required" }, 400);
    }
    
    // Check if session exists
    const session = await sessions.getSession(sessionId);
    if (!session) {
      return c.json({ error: "Session not found" }, 404);
    }
    
    // Check if already processing
    const sessionState = ctx.sessionStates.get(sessionId) || { isActive: false };
    if (sessionState.isActive) {
      return c.json({ error: "Session is already processing a prompt" }, 409);
    }
    
    // Mark as active
    ctx.sessionStates.set(sessionId, { ...sessionState, isActive: true, aborted: false });
    
    // Get or create an isolated agent for this session
    const sessionAgent = await ctx.getSessionAgent(sessionId);
    
    // Set up SSE response
    // Message persistence is handled incrementally by the storage
    // plugin's onMessageAdded hook — no batch save needed here.
    console.log(`[agent-server] prompt_stream: setting up SSE response for session ${sessionId}`);
    return c.body(
      new ReadableStream({
        async start(controller) {
          console.log(`[agent-server] prompt_stream: ReadableStream.start() called`);
          const encoder = new TextEncoder();
          let eventCount = 0;
          
          const sendEvent = (event: string, data: unknown) => {
            eventCount++;
            const bytes = encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
            console.log(`[agent-server] prompt_stream: sendEvent #${eventCount} type=${event} bytes=${bytes.length}`);
            controller.enqueue(bytes);
          };
          
          // Listen to this session's agent events
          const eventHandler = (event: AgentEvent) => {
            console.log(`[agent-server] prompt_stream: agent event: ${event.type}`);
            sendEvent(event.type, event);
          };
          
          sessionAgent.on("event", eventHandler);
          console.log(`[agent-server] prompt_stream: subscribed to agent events, calling prompt()...`);
          
          try {
            // Run the session's agent
            const response = await sessionAgent.prompt(body.prompt);
            console.log(`[agent-server] prompt_stream: prompt() returned, content length=${typeof response.content === "string" ? response.content.length : JSON.stringify(response.content).length}`);
            
            // Send completion event with the final assistant message and todo/phase status
            const finalContent = typeof response.content === "string" ? response.content : JSON.stringify(response.content);
            const todos = sessionAgent.getTodos?.() ?? [];
            const phases = sessionAgent.getPhases?.() ?? [];
            const hasOpenTodos = todos.some((t: { status: string }) => t.status === 'pending' || t.status === 'in_progress');
            const hasOpenPhases = phases.some((p: { status: string }) => p.status === 'pending' || p.status === 'in_progress');
            sendEvent("done", { 
              status: "completed",
              message: finalContent,
              hasOpenTodos,
              hasOpenPhases,
              todoCount: todos.length,
              openTodoCount: todos.filter((t: { status: string }) => t.status === 'pending' || t.status === 'in_progress').length,
              phaseCount: phases.length,
              openPhaseCount: phases.filter((p: { status: string }) => p.status === 'pending' || p.status === 'in_progress').length,
              todos,
              phases,
            });
          } catch (error) {
            // Check if this was a user-initiated abort.
            // We check both the session-level flag and the error type since
            // a new prompt may have reset the flag by the time we get here.
            const currentState = ctx.sessionStates.get(sessionId);
            const wasAborted = currentState?.aborted === true
              || (error instanceof DOMException && error.name === 'AbortError')
              || (error instanceof Error && error.message.includes('aborted'));
            
            if (wasAborted) {
              console.log(`[agent-server] prompt_stream: session ${sessionId} was aborted by user`);
              sendEvent("aborted", { status: "aborted" });
            } else {
              const message = error instanceof Error ? error.message : String(error);
              console.error(`[agent-server] prompt_stream: prompt() threw error: ${message}`);
              sendEvent("error", { error: message });
            }
          } finally {
            // Clean up
            console.log(`[agent-server] prompt_stream: finally block, total events sent: ${eventCount}`);
            sessionAgent.off("event", eventHandler);
            const currentState = ctx.sessionStates.get(sessionId);
            if (currentState) {
              currentState.isActive = false;
              currentState.aborted = false;
            }
            controller.close();
            console.log(`[agent-server] prompt_stream: controller.close() called`);
          }
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

  // Abort session
  app.post("/:sessionId/abort", async (c) => {
    const sessionId = c.req.param("sessionId");
    
    const sessionState = ctx.sessionStates.get(sessionId);
    if (!sessionState) {
      return c.json({ success: true }); // Nothing to abort
    }
    
    if (sessionState.isActive) {
      // Mark as aborted so the prompt catch block can distinguish
      // user-initiated abort from unexpected errors
      sessionState.aborted = true;
      if (sessionState.agent) {
        sessionState.agent.abort();
      }
      // Immediately clear isActive so a new prompt can be sent.
      // The old prompt's finally block will also set isActive=false,
      // but that's idempotent.
      sessionState.isActive = false;
    }
    
    return c.json({ success: true });
  });

  return app;
}
