/**
 * Mock MemorySettingsStore for testing.
 */

import {makeAutoObservable} from 'mobx';

class MockMemorySettingsStore {
  enabled: boolean = false;
  embeddingModelPath: string | undefined = undefined;
  idleSweepEnabled: boolean = false;
  idleSweepIntervalHours: number = 24;
  lastSweepAt: number | undefined = undefined;
  isLoaded: boolean = true;

  setEnabled: jest.Mock;
  setEmbeddingModelPath: jest.Mock;
  setIdleSweepEnabled: jest.Mock;
  setIdleSweepIntervalHours: jest.Mock;
  reportSweepRan: jest.Mock;

  constructor() {
    makeAutoObservable(this, {
      setEnabled: false,
      setEmbeddingModelPath: false,
      setIdleSweepEnabled: false,
      setIdleSweepIntervalHours: false,
      reportSweepRan: false,
    });
    this.setEnabled = jest.fn().mockImplementation(async (value: boolean) => {
      this.enabled = value;
    });
    this.setEmbeddingModelPath = jest
      .fn()
      .mockImplementation(async (path: string | undefined) => {
        this.embeddingModelPath = path;
      });
    this.setIdleSweepEnabled = jest
      .fn()
      .mockImplementation(async (value: boolean) => {
        this.idleSweepEnabled = value;
      });
    this.setIdleSweepIntervalHours = jest
      .fn()
      .mockImplementation(async (hours: number) => {
        this.idleSweepIntervalHours = hours;
      });
    this.reportSweepRan = jest.fn().mockImplementation((epochMs: number) => {
      this.lastSweepAt = epochMs;
    });
  }
}

export const memorySettingsStore = new MockMemorySettingsStore();
