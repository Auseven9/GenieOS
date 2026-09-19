import {createPersistedLog, type LogEntry} from './persistedLog';

export type SweepLogEntry = LogEntry;

// Reuses the same global_settings key/value table MemorySettingsRepository
// uses, under its own namespaced key — this is diagnostic data, not a
// setting, so it deliberately doesn't go through that repository's API.
const log = createPersistedLog('memory.sweepLog', 'MemorySweepLog');

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
 */
export const logSweepEvent = log.append;
export const getSweepLog = log.getAll;
export const clearSweepLog = log.clear;
