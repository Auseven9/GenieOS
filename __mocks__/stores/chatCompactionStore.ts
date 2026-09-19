/**
 * Mock ChatCompactionStore for testing.
 */

import {makeAutoObservable} from 'mobx';

class MockChatCompactionStore {
  enabled: boolean = false;
  isLoaded: boolean = true;

  setEnabled: jest.Mock;

  constructor() {
    makeAutoObservable(this, {
      setEnabled: false,
    });
    this.setEnabled = jest.fn().mockImplementation(async (value: boolean) => {
      this.enabled = value;
    });
  }
}

export const chatCompactionStore = new MockChatCompactionStore();
