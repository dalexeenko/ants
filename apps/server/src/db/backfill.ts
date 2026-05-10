import { sql } from 'drizzle-orm';
import type { DrizzleDB } from './index.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('backfill');

const TABLES_WITH_CREATED_BY = [
  'projects',
  'tasks',
  'channels',
  'webhook_endpoints',
  'file_watchers',
  'approval_rules',
  'channel_project_bindings',
  'project_templates',
] as const;

/**
 * Backfills `created_by = 'system'` for all existing rows where it is NULL.
 * Should be called once after migrations run.
 */
export function backfillCreatedBy(db: DrizzleDB): void {
  let totalUpdated = 0;

  for (const table of TABLES_WITH_CREATED_BY) {
    const result = db.run(
      sql.raw(`UPDATE ${table} SET created_by = 'system' WHERE created_by IS NULL`)
    );
    const count = result.changes;
    if (count > 0) {
      log.info(`Backfilled ${count} rows in ${table}`);
      totalUpdated += count;
    }
  }

  if (totalUpdated > 0) {
    log.info(`Backfill complete: ${totalUpdated} total rows updated`);
  } else {
    log.debug('Backfill: no rows needed updating');
  }
}
