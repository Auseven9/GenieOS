import {modelStore} from '../../store';
import {maybeRunIdleSweep} from './MemorySweepScheduler';

/**
 * Entry point for Android's HeadlessJsTaskService (see
 * android/app/src/main/java/com/pocketpalai/memorysweep/), registered as
 * 'MemorySweepTask' in index.js and triggered by a periodic WorkManager job
 * — this is what lets the idle sweep actually run with the app fully
 * closed, not just foregrounded.
 *
 * Runs with no React UI ever mounted, so nothing else triggers ModelStore's
 * usual bootstrap sequence (persisted-state hydration + initializeStore()).
 * This waits for that explicitly before maybeRunIdleSweep() touches any
 * model state — the draft-model resolution inside runMemorySweep depends on
 * modelStore.activeModel/models already being populated.
 *
 * iOS has no equivalent background trigger; the idle sweep there stays on
 * the AppState foreground-check path only (see MemorySweepScheduler).
 */
export default async function memorySweepHeadlessTask(): Promise<void> {
  await modelStore.whenReady;
  await maybeRunIdleSweep();
}
