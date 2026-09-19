import MemorySweepSchedulerModule from '../../specs/NativeMemorySweepScheduler';

/**
 * Thin wrapper around the Android-only TurboModule that controls the
 * periodic WorkManager job backing the idle sweep's background-while-closed
 * path (see android/app/src/main/java/com/pocketpalai/memorysweep/).
 * NativeMemorySweepScheduler.ts already resolves to null on iOS, so these
 * are no-ops there rather than throwing — callers don't need their own
 * Platform.OS check.
 *
 * Deliberately has no dependency on MemorySettingsStore or
 * MemorySettingsRepository: both the store (on a user-driven settings
 * change) and MemorySweepScheduler.ts (on cold-start reconciliation) call
 * into this leaf module independently, rather than one calling through
 * the other — store/MemorySweepScheduler.ts already import each other's
 * neighborhood, and routing this through either would risk a real
 * circular import.
 */
export async function scheduleAndroidBackgroundSweep(
  intervalHours: number,
): Promise<void> {
  if (!MemorySweepSchedulerModule) {
    return;
  }
  try {
    await MemorySweepSchedulerModule.schedulePeriodicSweep(intervalHours);
  } catch (error) {
    console.error('AndroidBackgroundSweepScheduler: schedule failed:', error);
  }
}

export async function cancelAndroidBackgroundSweep(): Promise<void> {
  if (!MemorySweepSchedulerModule) {
    return;
  }
  try {
    await MemorySweepSchedulerModule.cancelPeriodicSweep();
  } catch (error) {
    console.error('AndroidBackgroundSweepScheduler: cancel failed:', error);
  }
}
