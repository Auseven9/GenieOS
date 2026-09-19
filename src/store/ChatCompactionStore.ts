import {makeAutoObservable, runInAction} from 'mobx';

import chatCompactionRepository from '../repositories/ChatCompactionRepository';

/**
 * Observable wrapper around ChatCompactionRepository — same shape as
 * MemorySettingsStore: the repository is the single source of truth, this
 * just gives the settings screen a synchronous, reactive value to bind to.
 */
class ChatCompactionStore {
  enabled: boolean = false;
  isLoaded: boolean = false;

  constructor() {
    makeAutoObservable(this);
    this.loadFromRepository();
  }

  private async loadFromRepository() {
    const enabled = await chatCompactionRepository.isCompactionEnabled();
    runInAction(() => {
      this.enabled = enabled;
      this.isLoaded = true;
    });
  }

  async setEnabled(value: boolean): Promise<void> {
    runInAction(() => {
      this.enabled = value;
    });
    await chatCompactionRepository.setCompactionEnabled(value);
  }
}

export const chatCompactionStore = new ChatCompactionStore();
export {ChatCompactionStore};
