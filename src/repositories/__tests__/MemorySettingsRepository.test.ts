// Overrides the global '../database' mock (set up in jest/setup.ts), same
// pattern as ChatSessionRepository.pinned.test.ts / MemoryRepository.embedding.test.ts.
const mockFetch = jest.fn();
const mockCreate = jest.fn();
const mockWrite = jest.fn((callback: () => Promise<any>) => callback());

jest.mock('../../database', () => ({
  database: {
    write: (callback: () => Promise<any>) => mockWrite(callback),
    collections: {
      get: () => ({
        query: () => ({fetch: () => mockFetch()}),
        create: (mutator: (record: any) => void) => mockCreate(mutator),
      }),
    },
  },
}));

import {MemorySettingsRepository} from '../MemorySettingsRepository';

describe('MemorySettingsRepository', () => {
  let repo: MemorySettingsRepository;

  beforeEach(() => {
    jest.clearAllMocks();
    mockWrite.mockImplementation((callback: () => Promise<any>) => callback());
    repo = new MemorySettingsRepository();
  });

  describe('getEmbeddingModelPath', () => {
    it('returns undefined when no row exists', async () => {
      mockFetch.mockResolvedValue([]);
      expect(await repo.getEmbeddingModelPath()).toBeUndefined();
    });

    it('returns the stored path', async () => {
      mockFetch.mockResolvedValue([
        {value: JSON.stringify('/models/bge.gguf')},
      ]);
      expect(await repo.getEmbeddingModelPath()).toBe('/models/bge.gguf');
    });

    it('returns undefined for corrupt stored JSON rather than throwing', async () => {
      mockFetch.mockResolvedValue([{value: 'not json'}]);
      expect(await repo.getEmbeddingModelPath()).toBeUndefined();
    });
  });

  describe('setEmbeddingModelPath', () => {
    it('creates a new row when none exists', async () => {
      mockFetch.mockResolvedValue([]);
      await repo.setEmbeddingModelPath('/models/bge.gguf');

      expect(mockCreate).toHaveBeenCalledTimes(1);
      const record: any = {};
      mockCreate.mock.calls[0][0](record);
      expect(record.key).toBe('memory.embeddingModelPath');
      expect(record.value).toBe(JSON.stringify('/models/bge.gguf'));
    });

    it('updates the existing row when one exists', async () => {
      const existing = {
        value: '',
        update: jest.fn(async (m: any) => m(existing)),
      };
      mockFetch.mockResolvedValue([existing]);

      await repo.setEmbeddingModelPath('/models/new.gguf');

      expect(existing.update).toHaveBeenCalledTimes(1);
      expect(existing.value).toBe(JSON.stringify('/models/new.gguf'));
      expect(mockCreate).not.toHaveBeenCalled();
    });

    it('stores null when clearing the path', async () => {
      mockFetch.mockResolvedValue([]);
      await repo.setEmbeddingModelPath(undefined);

      const record: any = {};
      mockCreate.mock.calls[0][0](record);
      expect(record.value).toBe('null');
    });
  });

  describe('isMemoryEnabled', () => {
    it('defaults to false when unset', async () => {
      mockFetch.mockResolvedValue([]);
      expect(await repo.isMemoryEnabled()).toBe(false);
    });

    it('reflects a stored true value', async () => {
      mockFetch.mockResolvedValue([{value: 'true'}]);
      expect(await repo.isMemoryEnabled()).toBe(true);
    });

    it('defaults to false on corrupt stored JSON', async () => {
      mockFetch.mockResolvedValue([{value: 'not json'}]);
      expect(await repo.isMemoryEnabled()).toBe(false);
    });
  });

  describe('setMemoryEnabled', () => {
    it('persists true/false correctly', async () => {
      mockFetch.mockResolvedValue([]);
      await repo.setMemoryEnabled(true);
      const record: any = {};
      mockCreate.mock.calls[0][0](record);
      expect(record.value).toBe('true');
    });
  });

  describe('isIdleSweepEnabled / setIdleSweepEnabled', () => {
    it('defaults to false when unset', async () => {
      mockFetch.mockResolvedValue([]);
      expect(await repo.isIdleSweepEnabled()).toBe(false);
    });

    it('reflects a stored true value', async () => {
      mockFetch.mockResolvedValue([{value: 'true'}]);
      expect(await repo.isIdleSweepEnabled()).toBe(true);
    });

    it('persists true/false correctly', async () => {
      mockFetch.mockResolvedValue([]);
      await repo.setIdleSweepEnabled(true);
      const record: any = {};
      mockCreate.mock.calls[0][0](record);
      expect(record.key).toBe('memory.idleSweepEnabled');
      expect(record.value).toBe('true');
    });
  });

  describe('getIdleSweepIntervalHours / setIdleSweepIntervalHours', () => {
    it('defaults to 24 when unset', async () => {
      mockFetch.mockResolvedValue([]);
      expect(await repo.getIdleSweepIntervalHours()).toBe(24);
    });

    it('reflects a stored valid preset', async () => {
      mockFetch.mockResolvedValue([{value: '168'}]);
      expect(await repo.getIdleSweepIntervalHours()).toBe(168);
    });

    it('falls back to the default for a value outside the preset list', async () => {
      mockFetch.mockResolvedValue([{value: '999'}]);
      expect(await repo.getIdleSweepIntervalHours()).toBe(24);
    });

    it('falls back to the default on corrupt stored JSON', async () => {
      mockFetch.mockResolvedValue([{value: 'not json'}]);
      expect(await repo.getIdleSweepIntervalHours()).toBe(24);
    });

    it('persists a valid preset', async () => {
      mockFetch.mockResolvedValue([]);
      await repo.setIdleSweepIntervalHours(72);
      const record: any = {};
      mockCreate.mock.calls[0][0](record);
      expect(record.key).toBe('memory.idleSweepIntervalHours');
      expect(record.value).toBe('72');
    });
  });

  describe('getLastSweepAt / setLastSweepAt', () => {
    it('returns undefined when unset', async () => {
      mockFetch.mockResolvedValue([]);
      expect(await repo.getLastSweepAt()).toBeUndefined();
    });

    it('reflects a stored timestamp', async () => {
      mockFetch.mockResolvedValue([{value: '1700000000000'}]);
      expect(await repo.getLastSweepAt()).toBe(1700000000000);
    });

    it('returns undefined on corrupt stored JSON', async () => {
      mockFetch.mockResolvedValue([{value: 'not json'}]);
      expect(await repo.getLastSweepAt()).toBeUndefined();
    });

    it('persists the timestamp', async () => {
      mockFetch.mockResolvedValue([]);
      await repo.setLastSweepAt(1700000000000);
      const record: any = {};
      mockCreate.mock.calls[0][0](record);
      expect(record.key).toBe('memory.lastSweepAt');
      expect(record.value).toBe('1700000000000');
    });
  });
});
