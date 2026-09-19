import {Q} from '@nozbe/watermelondb';
import {database} from '../../database';

export interface SweepLogEntry {
  ts: number;
  message: string;
}

// Reuses the same global_settings key/value table MemorySettingsRepository
// uses, under its own namespaced key — this is diagnostic data, not a
// setting, so it deliberately doesn't go through that repository's API.
const LOG_KEY = 'memory.sweepLog';

// Bounds the stored JSON string's size rather than letting it grow forever;
// plenty of history for debugging one bad run without needing a PC/adb.
const MAX_LOG_ENTRIES = 200;

async function readEntries(): Promise<SweepLogEntry[]> {
  try {
    const rows = await database.collections
      .get('global_settings')
      .query(Q.where('key', LOG_KEY))
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

async function writeEntries(entries: SweepLogEntry[]): Promise<void> {
  await database.write(async () => {
    const rows = await database.collections
      .get('global_settings')
      .query(Q.where('key', LOG_KEY))
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
          record.key = LOG_KEY;
          record.value = value;
        });
    }
  });
}

/**
 * A small persisted diagnostic log for the idle sweep pipeline, readable in
 * Settings without a PC or adb — the whole reason it exists. The Android
 * background path (WorkManager -> foreground service -> headless JS task)
 * has failure modes that are otherwise invisible without a connected
 * device: permission denial, the job never firing, a step throwing deep in
 * the pipeline.
 *
 * This can only record what JS actually got to run. A native crash before
 * the headless task starts (a manifest/codegen mismatch, a Kotlin
 * exception in MemorySweepHeadlessService.onCreate) happens before any of
 * this code executes, so it won't appear here — only real device logcat
 * catches that. Everything from "the headless task started" onward is
 * covered, which is most of what would realistically go wrong once the
 * app itself is known to launch.
 *
 * Never throws — a logging failure must never take down the thing it's
 * trying to observe.
 */
export async function logSweepEvent(message: string): Promise<void> {
  try {
    const entries = await readEntries();
    entries.push({ts: Date.now(), message});
    await writeEntries(entries.slice(-MAX_LOG_ENTRIES));
  } catch (error) {
    console.error('MemorySweepLog: failed to record event:', error);
  }
}

/** Oldest first, so a copied/rendered log reads top-to-bottom in order. */
export async function getSweepLog(): Promise<SweepLogEntry[]> {
  return readEntries();
}

export async function clearSweepLog(): Promise<void> {
  try {
    await writeEntries([]);
  } catch (error) {
    console.error('MemorySweepLog: failed to clear log:', error);
  }
}
