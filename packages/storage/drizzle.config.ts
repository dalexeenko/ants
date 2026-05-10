import { defineConfig } from "drizzle-kit";
import { join } from "path";
import { homedir } from "os";

const DB_PATH = join(homedir(), ".config", "openmgr", "agent.db");

export default defineConfig({
  schema: "./src/schema.ts",
  out: "./drizzle",
  dialect: "sqlite",
  dbCredentials: {
    url: DB_PATH,
  },
});
