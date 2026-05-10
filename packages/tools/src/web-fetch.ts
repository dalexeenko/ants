import { z } from "zod";
import { defineTool } from "@ants/agent-core";

const MAX_CONTENT_LENGTH = 100_000;
const DEFAULT_TIMEOUT_MS = 30000;

const DESCRIPTION = `Fetch content from a specified URL and return it in the requested format.

Use this tool to:
- Read documentation pages
- Fetch article content
- Get raw HTML from web pages
- Access API documentation

The content is converted to the specified format (markdown by default) for easier reading.`;

export const webFetchTool = defineTool({
  name: "web_fetch",
  description: DESCRIPTION,
  requiredCapabilities: ["network"],
  parameters: z.object({
    url: z.string().url().describe("The URL to fetch content from"),
    format: z
      .enum(["markdown", "text", "html"])
      .optional()
      .default("markdown")
      .describe("Output format - 'markdown' (default), 'text', or 'html'"),
    timeout: z
      .number()
      .optional()
      .describe("Request timeout in milliseconds (default: 30000)"),
  }),
  async execute(params, ctx) {
    const { url, format = "markdown", timeout = DEFAULT_TIMEOUT_MS } = params;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const signals = ctx.abortSignal
        ? [controller.signal, ctx.abortSignal]
        : [controller.signal];

      const response = await fetch(url, {
        signal: AbortSignal.any(signals),
        headers: {
          "User-Agent": "Ants-Agent/1.0 (compatible; fetch tool)",
          Accept: "text/html,application/xhtml+xml,text/plain,*/*",
        },
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        return {
          output: `HTTP error: ${response.status} ${response.statusText}`,
          metadata: { error: true, status: response.status, url },
        };
      }

      const contentType = response.headers.get("content-type") || "";
      const html = await response.text();

      if (format === "html") {
        const content =
          html.length > MAX_CONTENT_LENGTH
            ? html.slice(0, MAX_CONTENT_LENGTH) + "\n\n[Content truncated...]"
            : html;

        return {
          output: content,
          metadata: {
            url,
            format,
            contentType,
            length: content.length,
            truncated: html.length > MAX_CONTENT_LENGTH,
          },
        };
      }

      const textContent = htmlToText(html, format === "markdown");

      const content =
        textContent.length > MAX_CONTENT_LENGTH
          ? textContent.slice(0, MAX_CONTENT_LENGTH) + "\n\n[Content truncated...]"
          : textContent;

      return {
        output: content,
        metadata: {
          url,
          format,
          contentType,
          length: content.length,
          truncated: textContent.length > MAX_CONTENT_LENGTH,
        },
      };
    } catch (err) {
      clearTimeout(timeoutId);

      if (err instanceof Error && err.name === "AbortError") {
        return {
          output: "Request timed out",
          metadata: { error: true, timeout: true, url },
        };
      }

      return {
        output: `Failed to fetch URL: ${(err as Error).message}`,
        metadata: { error: true, url },
      };
    }
  },
});

function htmlToText(html: string, asMarkdown: boolean): string {
  let content = html;

  content = content.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "");
  content = content.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "");
  content = content.replace(/<nav\b[^<]*(?:(?!<\/nav>)<[^<]*)*<\/nav>/gi, "");
  content = content.replace(/<footer\b[^<]*(?:(?!<\/footer>)<[^<]*)*<\/footer>/gi, "");
  content = content.replace(/<header\b[^<]*(?:(?!<\/header>)<[^<]*)*<\/header>/gi, "");
  content = content.replace(/<aside\b[^<]*(?:(?!<\/aside>)<[^<]*)*<\/aside>/gi, "");
  content = content.replace(/<noscript\b[^<]*(?:(?!<\/noscript>)<[^<]*)*<\/noscript>/gi, "");
  content = content.replace(/<!--[\s\S]*?-->/g, "");

  if (asMarkdown) {
    content = content.replace(/<h1[^>]*>(.*?)<\/h1>/gi, "\n# $1\n");
    content = content.replace(/<h2[^>]*>(.*?)<\/h2>/gi, "\n## $1\n");
    content = content.replace(/<h3[^>]*>(.*?)<\/h3>/gi, "\n### $1\n");
    content = content.replace(/<h4[^>]*>(.*?)<\/h4>/gi, "\n#### $1\n");
    content = content.replace(/<h5[^>]*>(.*?)<\/h5>/gi, "\n##### $1\n");
    content = content.replace(/<h6[^>]*>(.*?)<\/h6>/gi, "\n###### $1\n");

    content = content.replace(/<strong[^>]*>(.*?)<\/strong>/gi, "**$1**");
    content = content.replace(/<b[^>]*>(.*?)<\/b>/gi, "**$1**");
    content = content.replace(/<em[^>]*>(.*?)<\/em>/gi, "*$1*");
    content = content.replace(/<i[^>]*>(.*?)<\/i>/gi, "*$1*");
    content = content.replace(/<code[^>]*>(.*?)<\/code>/gi, "`$1`");

    content = content.replace(/<a[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gi, "[$2]($1)");

    content = content.replace(/<li[^>]*>(.*?)<\/li>/gi, "- $1\n");

    content = content.replace(/<pre[^>]*><code[^>]*>([\s\S]*?)<\/code><\/pre>/gi, "\n```\n$1\n```\n");
    content = content.replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, "\n```\n$1\n```\n");

    content = content.replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, (_, text) => {
      return text.split("\n").map((line: string) => `> ${line}`).join("\n");
    });

    content = content.replace(/<p[^>]*>(.*?)<\/p>/gi, "\n$1\n");
    content = content.replace(/<br\s*\/?>/gi, "\n");
    content = content.replace(/<hr\s*\/?>/gi, "\n---\n");
  }

  content = content.replace(/<[^>]+>/g, "");

  content = content.replace(/&nbsp;/g, " ");
  content = content.replace(/&amp;/g, "&");
  content = content.replace(/&lt;/g, "<");
  content = content.replace(/&gt;/g, ">");
  content = content.replace(/&quot;/g, '"');
  content = content.replace(/&#39;/g, "'");
  content = content.replace(/&mdash;/g, "—");
  content = content.replace(/&ndash;/g, "–");
  content = content.replace(/&hellip;/g, "...");
  content = content.replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)));

  content = content.replace(/\n{3,}/g, "\n\n");
  content = content.replace(/[ \t]+/g, " ");
  content = content.trim();

  return content;
}
