// Overrides the global '../database' mock (set up in jest/setup.ts), same
// pattern as MemorySettingsRepository.test.ts.
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

import {ChatCompactionRepository} from '../ChatCompactionRepository';

describe('ChatCompactionRepository', () => {
  let repo: ChatCompactionRepository;

  beforeEach(() => {
    jest.clearAllMocks();
    mockWrite.mockImplementation((callback: () => Promise<any>) => callback());
    repo = new ChatCompactionRepository();
  });

  describe('isCompactionEnabled', () => {
    it('defaults to false when no row exists', async () => {
      mockFetch.mockResolvedValue([]);
      expect(await repo.isCompactionEnabled()).toBe(false);
    });

    it('returns the stored value', async () => {
      mockFetch.mockResolvedValue([{value: JSON.stringify(true)}]);
      expect(await repo.isCompactionEnabled()).toBe(true);
    });

    it('returns false for corrupt stored JSON rather than throwing', async () => {
      mockFetch.mockResolvedValue([{value: 'not json'}]);
      expect(await repo.isCompactionEnabled()).toBe(false);
    });

    it('returns false rather than throwing when the query fails', async () => {
      mockFetch.mockRejectedValue(new Error('db exploded'));
      expect(await repo.isCompactionEnabled()).toBe(false);
    });
  });

  describe('setCompactionEnabled', () => {
    it('creates a new row when none exists', async () => {
      mockFetch.mockResolvedValue([]);
      await repo.setCompactionEnabled(true);

      expect(mockCreate).toHaveBeenCalledTimes(1);
      const record: any = {};
      mockCreate.mock.calls[0][0](record);
      expect(record.key).toBe('chat.compactionEnabled');
      expect(record.value).toBe(JSON.stringify(true));
    });

    it('updates the existing row rather than creating a duplicate', async () => {
      const row: any = {value: JSON.stringify(false)};
      row.update = (mutator: (record: any) => void) => {
        mutator(row);
        return Promise.resolve(row);
      };
      mockFetch.mockResolvedValue([row]);

      await repo.setCompactionEnabled(true);

      expect(mockCreate).not.toHaveBeenCalled();
      expect(row.value).toBe(JSON.stringify(true));
    });
  });
});
