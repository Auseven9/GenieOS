import type {TurboModule} from 'react-native';
import {Platform, TurboModuleRegistry} from 'react-native';

export interface Spec extends TurboModule {
  /**
   * Enqueues (or updates) a periodic WorkManager job that starts the
   * 'MemorySweepTask' headless JS task roughly every intervalHours, with
   * the app fully closed and no chat UI open. WorkManager's own minimum
   * periodic interval is 15 minutes and it never guarantees exact timing
   * (Doze, battery restrictions, OEM battery management) — see
   * MemorySweepScheduler.ts for the full picture, including why this has
   * no iOS equivalent.
   */
  schedulePeriodicSweep(intervalHours: number): Promise<void>;
  /** Cancels the periodic job; a no-op when none is scheduled. */
  cancelPeriodicSweep(): Promise<void>;
}

// Android-only: there is no background-execution trigger to wire up on
// iOS (see MemorySweepScheduler.ts's own doc comment for why).
export default Platform.OS === 'android'
  ? TurboModuleRegistry.getEnforcing<Spec>('MemorySweepSchedulerModule')
  : (null as unknown as Spec);
