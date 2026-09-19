import {makeAutoObservable, runInAction} from 'mobx';

import memorySettingsRepository, {
  type IdleSweepIntervalHours,
} from '../repositories/MemorySettingsRepository';
import {
  scheduleAndroidBackgroundSweep,
  cancelAndroidBackgroundSweep,
} from '../services/memory/AndroidBackgroundSweepScheduler';

/**
 * Observable wrapper around MemorySettingsRepository (WatermelonDB-backed,
 * async) so the settings screen can bind synchronous values the same way
 * HFStore wraps its Keychain-backed token — no mobx-persist-store here,
 * since the repository is already the single source of truth for these
 * values; a second persistence layer would just create a second place they
 * could disagree.
 */
class MemorySettingsStore {
  enabled: boolean = false;
  embeddingModelPath: string | undefined = undefined;
  idleSweepEnabled: boolean = false;
  idleSweepIntervalHours: IdleSweepIntervalHours = 24;
  /** Undefined until the first sweep has ever run; read-only from the UI's
   * perspective — only MemorySweepPipeline advances this. */
  lastSweepAt: number | undefined = undefined;
  /** Off by default; only ever set true after the OS has actually granted
   * notification permission (see MemorySettingsSection's toggle handler). */
  sweepNotificationsEnabled: boolean = false;
  isLoaded: boolean = false;

  constructor() {
    makeAutoObservable(this);
    this.loadFromRepository();
  }

  private async loadFromRepository() {
    const [
      enabled,
      embeddingModelPath,
      idleSweepEnabled,
      idleSweepIntervalHours,
      lastSweepAt,
      sweepNotificationsEnabled,
    ] = await Promise.all([
      memorySettingsRepository.isMemoryEnabled(),
      memorySettingsRepository.getEmbeddingModelPath(),
      memorySettingsRepository.isIdleSweepEnabled(),
      memorySettingsRepository.getIdleSweepIntervalHours(),
      memorySettingsRepository.getLastSweepAt(),
      memorySettingsRepository.isSweepNotificationsEnabled(),
    ]);
    runInAction(() => {
      this.enabled = enabled;
      this.embeddingModelPath = embeddingModelPath;
      this.idleSweepEnabled = idleSweepEnabled;
      this.idleSweepIntervalHours = idleSweepIntervalHours;
      this.lastSweepAt = lastSweepAt;
      this.sweepNotificationsEnabled = sweepNotificationsEnabled;
      this.isLoaded = true;
    });
  }

  /** A no-op on iOS (see AndroidBackgroundSweepScheduler) — reflects
   * enabled+idleSweepEnabled into the Android WorkManager job so it never
   * drifts from what the settings screen shows. */
  private syncAndroidBackgroundSweep(): void {
    if (this.enabled && this.idleSweepEnabled) {
      scheduleAndroidBackgroundSweep(this.idleSweepIntervalHours).catch(
        () => {},
      );
    } else {
      cancelAndroidBackgroundSweep().catch(() => {});
    }
  }

  async setEnabled(value: boolean): Promise<void> {
    runInAction(() => {
      this.enabled = value;
    });
    await memorySettingsRepository.setMemoryEnabled(value);
    this.syncAndroidBackgroundSweep();
  }

  async setEmbeddingModelPath(path: string | undefined): Promise<void> {
    runInAction(() => {
      this.embeddingModelPath = path;
    });
    await memorySettingsRepository.setEmbeddingModelPath(path);
  }

  async setIdleSweepEnabled(value: boolean): Promise<void> {
    runInAction(() => {
      this.idleSweepEnabled = value;
    });
    await memorySettingsRepository.setIdleSweepEnabled(value);
    this.syncAndroidBackgroundSweep();
  }

  async setIdleSweepIntervalHours(
    hours: IdleSweepIntervalHours,
  ): Promise<void> {
    runInAction(() => {
      this.idleSweepIntervalHours = hours;
    });
    await memorySettingsRepository.setIdleSweepIntervalHours(hours);
    this.syncAndroidBackgroundSweep();
  }

  /** Called by MemorySweepPipeline after a sweep attempt, so the settings
   * screen's "last swept" text updates without re-reading the repository. */
  reportSweepRan(epochMs: number): void {
    runInAction(() => {
      this.lastSweepAt = epochMs;
    });
  }

  /** The caller (MemorySettingsSection) is responsible for having already
   * confirmed OS notification permission before passing true — this store
   * just persists the resulting preference, the same as every other
   * setting here. */
  async setSweepNotificationsEnabled(value: boolean): Promise<void> {
    runInAction(() => {
      this.sweepNotificationsEnabled = value;
    });
    await memorySettingsRepository.setSweepNotificationsEnabled(value);
  }
}

export const memorySettingsStore = new MemorySettingsStore();
export {MemorySettingsStore};
