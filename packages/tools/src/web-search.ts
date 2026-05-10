import { z } from "zod";
import { defineTool } from "@ants/agent-core";

const API_CONFIG = {
  BASE_URL: "https://mcp.exa.ai",
  ENDPOINT: "/mcp",
  DEFAULT_NUM_RESULTS: 8,
  TIMEOUT_MS: 25000,
} as const;

interface McpSearchRequest {
  jsonrpc: string;
  id: number;
  method: string;
  params: {
    name: string;
    arguments: {
      query: string;
      numResults?: number;
      livecrawl?: "fallback" | "preferred";
      type?: "auto" | "fast" | "deep";
      contextMaxCharacters?: number;
    };
  };
}

interface McpSearchResponse {
  jsonrpc: string;
  result: {
    content: Array<{
      type: string;
      text: string;
    }>;
  };
}

const today = () => new Date().toISOString().slice(0, 10);

const DESCRIPTION = `Search the web using Exa AI - performs real-time web searches and can scrape content from specific URLs. Supports configurable result counts and returns the content from the most relevant websites.

Current date: ${today()}

Use this tool to find current information, documentation, articles, or any web content.`;

export const webSearchTool = defineTool({
  name: "web_search",
  description: DESCRIPTION,
  requiredCapabilities: ["network"],
  parameters: z.object({
    query: z.string().describe("Search query"),
    numResults: z
      .number()
      .optional()
      .describe("Number of search results to return (default: 8)"),
    livecrawl: z
      .enum(["fallback", "preferred"])
      .optional()
      .describe(
        "Live crawl mode - 'fallback': use live crawling as backup if cached content unavailable, 'preferred': prioritize live crawling (default: 'fallback')"
      ),
    type: z
      .enum(["auto", "fast", "deep"])
      .optional()
      .describe(
        "Search type - 'auto': balanced search (default), 'fast': quick results, 'deep': comprehensive search"
      ),
    contextMaxCharacters: z
      .number()
      .optional()
      .describe(
        "Maximum characters for context string optimized for LLMs (default: 10000)"
      ),
  }),
  async execute(params, ctx) {
    const searchRequest: McpSearchRequest = {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "web_search_exa",
        arguments: {
          query: params.query,
          type: params.type || "auto",
          numResults: params.numResults || API_CONFIG.DEFAULT_NUM_RESULTS,
          livecrawl: params.livecrawl || "fallback",
          contextMaxCharacters: params.contextMaxCharacters,
        },
      },
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), API_CONFIG.TIMEOUT_MS);

    try {
      const signals = ctx.abortSignal
        ? [controller.signal, ctx.abortSignal]
        : [controller.signal];

      const response = await fetch(
        `${API_CONFIG.BASE_URL}${API_CONFIG.ENDPOINT}`,
        {
          method: "POST",
          headers: {
            accept: "application/json, text/event-stream",
            "content-type": "application/json",
          },
          body: JSON.stringify(searchRequest),
          signal: AbortSignal.any(signals),
        }
      );

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        return {
          output: `Search error (${response.status}): ${errorText}`,
          metadata: { error: true, status: response.status },
        };
      }

      const responseText = await response.text();

      const lines = responseText.split("\n");
      for (const line of lines) {
        if (line.startsWith("data: ")) {
          const data: McpSearchResponse = JSON.parse(line.substring(6));
          if (data.result?.content?.length > 0) {
            return {
              output: data.result.content[0]!.text,
              metadata: {
                query: params.query,
                numResults: params.numResults || API_CONFIG.DEFAULT_NUM_RESULTS,
              },
            };
          }
        }
      }

      return {
        output: "No search results found. Please try a different query.",
        metadata: { query: params.query, count: 0 },
      };
    } catch (err) {
      clearTimeout(timeoutId);

      if (err instanceof Error && err.name === "AbortError") {
        return {
          output: "Search request timed out",
          metadata: { error: true, timeout: true },
        };
      }

      return {
        output: `Search failed: ${(err as Error).message}`,
        metadata: { error: true },
      };
    }
  },
});
