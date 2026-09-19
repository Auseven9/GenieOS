import {Q} from '@nozbe/watermelondb';
import {database} from '../../database';

export interface LogEntry {
  ts: number;
  message: string;
}

// Bounds the stored JSON string's size rather than letting it grow forever;
// plenty of history for one debugging session without needing a PC/adb.
const MAX_LOG_ENTRIES = 200;

async function readEntries(key: string): Promise<LogEntry[]> {
  try {
    const rows = await database.collections
      .get('global_settings')
      .query(Q.where('key', key))
      .fetch();
    if (rows.length === 0) {
      return [];
    }
    const parsed = JSON.parse((rows[0] as any).value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeEntries(key: string, entries: LogEntry[]): Promise<void> {
  await database.write(async () => {
    const rows = await database.collections
      .get('global_settings')
      .query(Q.where('key', key))
      .fetch();
    const value = JSON.stringify(entries);
    if (rows.length > 0) {
      await rows[0].update((record: any) => {
        record.value = value;
      });
    } else {
      await database.collections
        .get('global_settings')
        .create((record: any) => {
          record.key = key;
          record.value = value;
        });
    }
  });
}

/**
 * A small persisted, capped, append-only log keyed by its own
 * global_settings row — shared storage mechanics behind MemorySweepLog
 * (background-sweep diagnostics) and MemoryActivityLog (what the model
 * actually remembered/forgot). The two are semantically different feeds
 * for different audiences (one for debugging the scheduler, one for
 * watching the graph itself), but need identical read/write/cap
 * behavior, so that part lives here once instead of twice.
 *
 * Every method swallows its own errors — a logging failure must never
 * take down the thing it's trying to observe.
 */
export function createPersistedLog(key: string, errorLabel: string) {
  return {
    async append(message: string): Promise<void> {
      try {
        const entries = await readEntries(key);
        entries.push({ts: Date.now(), message});
        await writeEntries(key, entries.slice(-MAX_LOG_ENTRIES));
      } catch (error) {
        console.error(`${errorLabel}: failed to record event:`, error);
      }
    },
    /** Oldest first, so a copied/rendered log reads top-to-bottom in order. */
    async getAll(): Promise<LogEntry[]> {
      return readEntries(key);
    },
    async clear(): Promise<void> {
      try {
        await writeEntries(key, []);
      } catch (error) {
        console.error(`${errorLabel}: failed to clear log:`, error);
      }
    },
  };
}
