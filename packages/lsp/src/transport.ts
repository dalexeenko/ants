/**
 * JSON-RPC Transport Layer for LSP
 * Handles reading and writing LSP messages over stdio
 */

import type { Readable, Writable } from "stream";
import type { JsonRpcMessage, JsonRpcRequest, JsonRpcResponse, JsonRpcNotification } from "./types.js";

const CONTENT_LENGTH_HEADER = "Content-Length: ";
const HEADER_DELIMITER = "\r\n\r\n";

/**
 * Parse LSP message headers from a buffer
 */
function parseHeaders(buffer: Buffer): { contentLength: number; headerEnd: number } | null {
  const str = buffer.toString("utf-8");
  const headerEndIndex = str.indexOf(HEADER_DELIMITER);
  
  if (headerEndIndex === -1) {
    return null;
  }
  
  const headers = str.substring(0, headerEndIndex);
  const contentLengthMatch = headers.match(/Content-Length:\s*(\d+)/i);
  
  if (!contentLengthMatch) {
    throw new Error("Missing Content-Length header in LSP message");
  }
  
  return {
    contentLength: parseInt(contentLengthMatch[1] ?? "0", 10),
    headerEnd: headerEndIndex + HEADER_DELIMITER.length,
  };
}

/**
 * LSP Transport handles reading and writing JSON-RPC messages
 */
export class LspTransport {
  private reader: Readable;
  private writer: Writable;
  private buffer: Buffer = Buffer.alloc(0);
  private messageHandler: ((message: JsonRpcMessage) => void) | null = null;
  private errorHandler: ((error: Error) => void) | null = null;
  private closeHandler: (() => void) | null = null;
  private isClosed = false;

  constructor(reader: Readable, writer: Writable) {
    this.reader = reader;
    this.writer = writer;
    
    this.reader.on("data", (chunk: Buffer) => {
      this.handleData(chunk);
    });
    
    this.reader.on("end", () => {
      this.isClosed = true;
      this.closeHandler?.();
    });
    
    this.reader.on("error", (err: Error) => {
      this.errorHandler?.(err);
    });
    
    this.writer.on("error", (err: Error) => {
      this.errorHandler?.(err);
    });
  }

  /**
   * Set handler for incoming messages
   */
  onMessage(handler: (message: JsonRpcMessage) => void): void {
    this.messageHandler = handler;
  }

  /**
   * Set handler for errors
   */
  onError(handler: (error: Error) => void): void {
    this.errorHandler = handler;
  }

  /**
   * Set handler for connection close
   */
  onClose(handler: () => void): void {
    this.closeHandler = handler;
  }

  /**
   * Send a JSON-RPC request
   */
  sendRequest(id: number | string, method: string, params?: unknown): void {
    const request: JsonRpcRequest = {
      jsonrpc: "2.0",
      id,
      method,
      params,
    };
    this.send(request);
  }

  /**
   * Send a JSON-RPC notification (no response expected)
   */
  sendNotification(method: string, params?: unknown): void {
    const notification: JsonRpcNotification = {
      jsonrpc: "2.0",
      method,
      params,
    };
    this.send(notification);
  }

  /**
   * Send a JSON-RPC response
   */
  sendResponse(id: number | string | null, result?: unknown, error?: { code: number; message: string; data?: unknown }): void {
    const response: JsonRpcResponse = {
      jsonrpc: "2.0",
      id,
      ...(error ? { error } : { result }),
    };
    this.send(response);
  }

  /**
   * Send a raw message
   */
  private send(message: JsonRpcMessage): void {
    if (this.isClosed) {
      return;
    }
    
    const content = JSON.stringify(message);
    const contentBuffer = Buffer.from(content, "utf-8");
    const header = `${CONTENT_LENGTH_HEADER}${contentBuffer.length}${HEADER_DELIMITER}`;
    const headerBuffer = Buffer.from(header, "utf-8");
    
    this.writer.write(Buffer.concat([headerBuffer, contentBuffer]));
  }

  /**
   * Handle incoming data
   */
  private handleData(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    this.processBuffer();
  }

  /**
   * Process buffered data, extracting complete messages
   */
  private processBuffer(): void {
    while (true) {
      const parsed = parseHeaders(this.buffer);
      if (!parsed) {
        // Not enough data for headers yet
        return;
      }
      
      const { contentLength, headerEnd } = parsed;
      const totalLength = headerEnd + contentLength;
      
      if (this.buffer.length < totalLength) {
        // Not enough data for the full message
        return;
      }
      
      // Extract the message content
      const content = this.buffer.slice(headerEnd, totalLength).toString("utf-8");
      this.buffer = this.buffer.slice(totalLength);
      
      try {
        const message = JSON.parse(content) as JsonRpcMessage;
        this.messageHandler?.(message);
      } catch (err) {
        this.errorHandler?.(new Error(`Failed to parse JSON-RPC message: ${content}`));
      }
    }
  }

  /**
   * Check if transport is closed
   */
  get closed(): boolean {
    return this.isClosed;
  }

  /**
   * Close the transport
   */
  close(): void {
    this.isClosed = true;
    this.reader.destroy();
    if ("end" in this.writer && typeof this.writer.end === "function") {
      this.writer.end();
    }
  }
}
