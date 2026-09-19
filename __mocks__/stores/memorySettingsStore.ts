/**
 * Mock MemorySettingsStore for testing.
 */

import {makeAutoObservable} from 'mobx';

class MockMemorySettingsStore {
  enabled: boolean = false;
  embeddingModelPath: string | undefined = undefined;
  isLoaded: boolean = true;

  setEnabled: jest.Mock;
  setEmbeddingModelPath: jest.Mock;

  constructor() {
    makeAutoObservable(this, {
      setEnabled: false,
      setEmbeddingModelPath: false,
    });
    this.setEnabled = jest.fn().mockImplementation(async (value: boolean) => {
      this.enabled = value;
    });
    this.setEmbeddingModelPath = jest
      .fn()
      .mockImplementation(async (path: string | undefined) => {
        this.embeddingModelPath = path;
      });
  }
}

export const memorySettingsStore = new MockMemorySettingsStore();
