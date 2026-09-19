import {makeAutoObservable, runInAction} from 'mobx';

import memorySettingsRepository from '../repositories/MemorySettingsRepository';

/**
 * Observable wrapper around MemorySettingsRepository (WatermelonDB-backed,
 * async) so the settings screen can bind a synchronous Switch value the
 * same way HFStore wraps its Keychain-backed token — no mobx-persist-store
 * here, since the repository is already the single source of truth for
 * these two values; a second persistence layer would just create a second
 * place they could disagree.
 */
class MemorySettingsStore {
  enabled: boolean = false;
  embeddingModelPath: string | undefined = undefined;
  isLoaded: boolean = false;

  constructor() {
    makeAutoObservable(this);
    this.loadFromRepository();
  }

  private async loadFromRepository() {
    const [enabled, embeddingModelPath] = await Promise.all([
      memorySettingsRepository.isMemoryEnabled(),
      memorySettingsRepository.getEmbeddingModelPath(),
    ]);
    runInAction(() => {
      this.enabled = enabled;
      this.embeddingModelPath = embeddingModelPath;
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
}

export const memorySettingsStore = new MemorySettingsStore();
export {MemorySettingsStore};
