import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("drizzle-orm/expo-sqlite", () => ({
  drizzle: vi.fn().mockReturnValue({}),
}));

import {
  DEFAULT_DB_NAME,
  createReactNativeDatabaseAdapter,
  createReactNativeDatabase,
  getSchemaStatements,
} from "../index.js";

function createMockSQLite() {
  const mockSqliteDb = {
    execSync: vi.fn(),
    getAllSync: vi.fn().mockReturnValue([]),
    closeSync: vi.fn(),
  };

  const mockSQLite = {
    openDatabaseSync: vi.fn().mockReturnValue(mockSqliteDb),
  };

  return { mockSQLite, mockSqliteDb };
}

describe("DEFAULT_DB_NAME", () => {
  it('equals "openmgr-agent.db"', () => {
    expect(DEFAULT_DB_NAME).toBe("openmgr-agent.db");
  });
});

describe("createReactNativeDatabaseAdapter", () => {
  it("returns an object with create, createInMemory, getDefaultPath methods", () => {
    const { mockSQLite } = createMockSQLite();
    const adapter = createReactNativeDatabaseAdapter(mockSQLite as any);

    expect(adapter).toHaveProperty("createDatabase");
    expect(adapter).toHaveProperty("createInMemoryDatabase");
    expect(adapter).toHaveProperty("getDefaultPath");
    expect(typeof adapter.createDatabase).toBe("function");
    expect(typeof adapter.createInMemoryDatabase).toBe("function");
    expect(typeof adapter.getDefaultPath).toBe("function");
  });

  it("getDefaultPath() returns DEFAULT_DB_NAME", () => {
    const { mockSQLite } = createMockSQLite();
    const adapter = createReactNativeDatabaseAdapter(mockSQLite as any);

    expect(adapter.getDefaultPath()).toBe(DEFAULT_DB_NAME);
  });
});

describe("getSchemaStatements", () => {
  it("returns an array of SQL strings", () => {
    const statements = getSchemaStatements();

    expect(Array.isArray(statements)).toBe(true);
    expect(statements.length).toBeGreaterThan(0);
  });

  it("each statement is a non-empty string", () => {
    const statements = getSchemaStatements();

    for (const stmt of statements) {
      expect(typeof stmt).toBe("string");
      expect(stmt.trim().length).toBeGreaterThan(0);
    }
  });
});

describe("createReactNativeDatabase", () => {
  let mockSQLite: ReturnType<typeof createMockSQLite>["mockSQLite"];
  let mockSqliteDb: ReturnType<typeof createMockSQLite>["mockSqliteDb"];

  beforeEach(() => {
    vi.clearAllMocks();
    const mocks = createMockSQLite();
    mockSQLite = mocks.mockSQLite;
    mockSqliteDb = mocks.mockSqliteDb;
  });

  it("calls openDatabaseSync with the database name", () => {
    createReactNativeDatabase(mockSQLite as any, { path: "test.db" });

    expect(mockSQLite.openDatabaseSync).toHaveBeenCalledWith("test.db");
  });

  it("uses DEFAULT_DB_NAME when no path is provided", () => {
    createReactNativeDatabase(mockSQLite as any);

    expect(mockSQLite.openDatabaseSync).toHaveBeenCalledWith(DEFAULT_DB_NAME);
  });

  it("executes schema statements via execSync", () => {
    createReactNativeDatabase(mockSQLite as any);

    const statements = getSchemaStatements();
    // execSync is called for each schema statement + the column migration PRAGMA/ALTER
    expect(mockSqliteDb.execSync.mock.calls.length).toBeGreaterThanOrEqual(
      statements.length
    );

    for (const stmt of statements) {
      expect(mockSqliteDb.execSync).toHaveBeenCalledWith(stmt);
    }
  });

  it("returns an object with db, sqlite, and close", () => {
    const connection = createReactNativeDatabase(mockSQLite as any);

    expect(connection).toHaveProperty("db");
    expect(connection).toHaveProperty("sqlite");
    expect(connection).toHaveProperty("close");
    expect(typeof connection.close).toBe("function");
  });

  it("close() calls closeSync on the sqlite instance", () => {
    const connection = createReactNativeDatabase(mockSQLite as any);

    connection.close();

    expect(mockSqliteDb.closeSync).toHaveBeenCalled();
  });
});
