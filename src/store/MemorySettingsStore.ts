import {makeAutoObservable, runInAction} from 'mobx';

import memorySettingsRepository, {
  type IdleSweepIntervalHours,
} from '../repositories/MemorySettingsRepository';

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
    ] = await Promise.all([
      memorySettingsRepository.isMemoryEnabled(),
      memorySettingsRepository.getEmbeddingModelPath(),
      memorySettingsRepository.isIdleSweepEnabled(),
      memorySettingsRepository.getIdleSweepIntervalHours(),
      memorySettingsRepository.getLastSweepAt(),
    ]);
    runInAction(() => {
      this.enabled = enabled;
      this.embeddingModelPath = embeddingModelPath;
      this.idleSweepEnabled = idleSweepEnabled;
      this.idleSweepIntervalHours = idleSweepIntervalHours;
      this.lastSweepAt = lastSweepAt;
      this.isLoaded = true;
    });
  }

  async setEnabled(value: boolean): Promise<void> {
    runInAction(() => {
      this.enabled = value;
    });
    await memorySettingsRepository.setMemoryEnabled(value);
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
  }

  async setIdleSweepIntervalHours(
    hours: IdleSweepIntervalHours,
  ): Promise<void> {
    runInAction(() => {
      this.idleSweepIntervalHours = hours;
    });
    await memorySettingsRepository.setIdleSweepIntervalHours(hours);
  }

  /** Called by MemorySweepPipeline after a sweep attempt, so the settings
   * screen's "last swept" text updates without re-reading the repository. */
  reportSweepRan(epochMs: number): void {
    runInAction(() => {
      this.lastSweepAt = epochMs;
    });
  }
}

export const memorySettingsStore = new MemorySettingsStore();
export {MemorySettingsStore};
