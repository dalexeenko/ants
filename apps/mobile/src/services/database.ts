/**
 * Shared database module for React Native.
 * 
 * Provides a singleton database connection used by all services.
 */

import {
  createReactNativeDatabase,
  type AgentDatabase,
  type ExpoSQLiteModule,
} from '@ants/agent-react-native';
import * as SQLite from 'expo-sqlite';

// Singleton database connection
let dbConnection: { db: AgentDatabase; close: () => void } | null = null;

/**
 * Get the shared database instance.
 * Creates the connection on first call.
 */
export function getDatabase(): AgentDatabase {
  if (!dbConnection) {
    // Cast needed due to expo-sqlite version mismatch between app and agent packages
    dbConnection = createReactNativeDatabase(
      SQLite as unknown as ExpoSQLiteModule,
      { path: 'ants.db' }
    );
  }
  return dbConnection.db;
}

/**
 * Close the database connection.
 * Call this when the app is terminating.
 */
export function closeDatabase(): void {
  if (dbConnection) {
    dbConnection.close();
    dbConnection = null;
  }
}
