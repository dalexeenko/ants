import { describe, it, expect } from "vitest";
import {
  projects,
  remoteServers,
  sessions,
  messages,
  compactionHistory,
  mcpOAuthTokens,
  memoryEntries,
  anthropicTokens,
  schema,
  getSchemaStatements,
  CREATE_SCHEMA_SQL,
} from "../index.js";

describe("@ants/agent-database-core", () => {
  describe("schema exports", () => {
    it("should export projects table", () => {
      expect(projects).toBeDefined();
      expect(projects.id).toBeDefined();
      expect(projects.name).toBeDefined();
      expect(projects.path).toBeDefined();
    });

    it("should export remoteServers table", () => {
      expect(remoteServers).toBeDefined();
      expect(remoteServers.id).toBeDefined();
      expect(remoteServers.url).toBeDefined();
    });

    it("should export sessions table", () => {
      expect(sessions).toBeDefined();
      // Check it's a Drizzle table by verifying it has expected columns
      expect(sessions.id).toBeDefined();
      expect(sessions.workingDirectory).toBeDefined();
    });

    it("should export messages table", () => {
      expect(messages).toBeDefined();
      expect(messages.id).toBeDefined();
      expect(messages.sessionId).toBeDefined();
    });

    it("should export compactionHistory table", () => {
      expect(compactionHistory).toBeDefined();
      expect(compactionHistory.id).toBeDefined();
      expect(compactionHistory.sessionId).toBeDefined();
    });

    it("should export mcpOAuthTokens table", () => {
      expect(mcpOAuthTokens).toBeDefined();
      expect(mcpOAuthTokens.serverName).toBeDefined();
      expect(mcpOAuthTokens.accessToken).toBeDefined();
    });

    it("should export memoryEntries table", () => {
      expect(memoryEntries).toBeDefined();
      expect(memoryEntries.id).toBeDefined();
      expect(memoryEntries.content).toBeDefined();
    });

    it("should export anthropicTokens table", () => {
      expect(anthropicTokens).toBeDefined();
      expect(anthropicTokens.id).toBeDefined();
      expect(anthropicTokens.accessToken).toBeDefined();
    });

    it("should export combined schema object", () => {
      expect(schema).toBeDefined();
      expect(schema.projects).toBe(projects);
      expect(schema.remoteServers).toBe(remoteServers);
      expect(schema.sessions).toBe(sessions);
      expect(schema.messages).toBe(messages);
      expect(schema.compactionHistory).toBe(compactionHistory);
      expect(schema.mcpOAuthTokens).toBe(mcpOAuthTokens);
      expect(schema.memoryEntries).toBe(memoryEntries);
      expect(schema.anthropicTokens).toBe(anthropicTokens);
    });
  });

  describe("schema SQL", () => {
    it("should export CREATE_SCHEMA_SQL", () => {
      expect(CREATE_SCHEMA_SQL).toBeDefined();
      expect(typeof CREATE_SCHEMA_SQL).toBe("string");
      expect(CREATE_SCHEMA_SQL).toContain("CREATE TABLE");
    });

    it("should include all tables in schema SQL", () => {
      expect(CREATE_SCHEMA_SQL).toContain("projects");
      expect(CREATE_SCHEMA_SQL).toContain("remote_servers");
      expect(CREATE_SCHEMA_SQL).toContain("sessions");
      expect(CREATE_SCHEMA_SQL).toContain("messages");
      expect(CREATE_SCHEMA_SQL).toContain("compaction_history");
      expect(CREATE_SCHEMA_SQL).toContain("mcp_oauth_tokens");
      expect(CREATE_SCHEMA_SQL).toContain("memory_entries");
      expect(CREATE_SCHEMA_SQL).toContain("anthropic_tokens");
    });

    it("should return array of statements from getSchemaStatements", () => {
      const statements = getSchemaStatements();
      expect(Array.isArray(statements)).toBe(true);
      expect(statements.length).toBeGreaterThan(0);
      
      // Each statement should end with semicolon
      for (const stmt of statements) {
        expect(stmt.trim().endsWith(";")).toBe(true);
      }
    });

    it("should include CREATE TABLE statements", () => {
      const statements = getSchemaStatements();
      const createTableStatements = statements.filter(s => 
        s.includes("CREATE TABLE")
      );
      expect(createTableStatements.length).toBe(8); // 8 tables
    });

    it("should include CREATE INDEX statements", () => {
      const statements = getSchemaStatements();
      const createIndexStatements = statements.filter(s => 
        s.includes("CREATE INDEX")
      );
      expect(createIndexStatements.length).toBeGreaterThan(0);
    });
  });
});
