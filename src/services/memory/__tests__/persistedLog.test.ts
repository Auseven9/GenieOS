// Overrides the global '../src/database' mock (set up in jest/setup.ts) —
// same pattern as MemorySettingsRepository.test.ts — but this file also
// needs a working row.update() for the "existing row" write path.
const mockFetch = jest.fn();
const mockCreate = jest.fn();
const mockUpdate = jest.fn();
const mockWrite = jest.fn((callback: () => Promise<any>) => callback());

jest.mock('../../../database', () => ({
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

import {createPersistedLog} from '../persistedLog';

function existingRow(entries: Array<{ts: number; message: string}>) {
  const row: any = {value: JSON.stringify(entries)};
  row.update = (mutator: (record: any) => void) => {
    mockUpdate(mutator);
    mutator(row);
    return Promise.resolve(row);
  };
  return row;
}

describe('createPersistedLog', () => {
  const log = createPersistedLog('test.key', 'TestLog');

  beforeEach(() => {
    jest.clearAllMocks();
    mockWrite.mockImplementation((callback: () => Promise<any>) => callback());
  });

  describe('getAll', () => {
    it('returns an empty array when nothing has been logged', async () => {
      mockFetch.mockResolvedValue([]);
      expect(await log.getAll()).toEqual([]);
    });

    it('returns parsed entries in stored order', async () => {
      const entries = [
        {ts: 1, message: 'a'},
        {ts: 2, message: 'b'},
      ];
      mockFetch.mockResolvedValue([{value: JSON.stringify(entries)}]);
      expect(await log.getAll()).toEqual(entries);
    });

    it('returns an empty array on corrupt stored JSON', async () => {
      mockFetch.mockResolvedValue([{value: 'not json'}]);
      expect(await log.getAll()).toEqual([]);
    });

    it('returns an empty array if the stored value is not an array', async () => {
      mockFetch.mockResolvedValue([{value: JSON.stringify({not: 'an array'})}]);
      expect(await log.getAll()).toEqual([]);
    });

    it('never throws when the query itself fails', async () => {
      mockFetch.mockRejectedValue(new Error('db exploded'));
      await expect(log.getAll()).resolves.toEqual([]);
    });
  });

  describe('append', () => {
    it('creates a new row keyed by the given key when none exists yet', async () => {
      mockFetch.mockResolvedValue([]);

      await log.append('hello');

      const record: any = {};
      mockCreate.mock.calls[0][0](record);
      expect(record.key).toBe('test.key');
      const stored = JSON.parse(record.value);
      expect(stored).toHaveLength(1);
      expect(stored[0].message).toBe('hello');
    });

    it('appends to an existing row rather than replacing it', async () => {
      const row = existingRow([{ts: 1, message: 'first'}]);
      mockFetch.mockResolvedValue([row]);

      await log.append('second');

      const stored = JSON.parse(row.value);
      expect(stored).toHaveLength(2);
      expect(stored[0].message).toBe('first');
      expect(stored[1].message).toBe('second');
      expect(mockCreate).not.toHaveBeenCalled();
    });

    it('caps stored entries at 200, dropping the oldest first', async () => {
      const existing = Array.from({length: 200}, (_, i) => ({
        ts: i,
        message: `msg-${i}`,
      }));
      const row = existingRow(existing);
      mockFetch.mockResolvedValue([row]);

      await log.append('newest');

      const stored = JSON.parse(row.value);
      expect(stored).toHaveLength(200);
      expect(stored[0].message).toBe('msg-1');
      expect(stored[stored.length - 1].message).toBe('newest');
    });

    it('never throws when persisting fails', async () => {
      mockFetch.mockRejectedValue(new Error('db exploded'));
      await expect(log.append('hello')).resolves.toBeUndefined();
    });
  });

  describe('clear', () => {
    it('overwrites the existing row with an empty array', async () => {
      const row = existingRow([{ts: 1, message: 'first'}]);
      mockFetch.mockResolvedValue([row]);

      await log.clear();

      expect(JSON.parse(row.value)).toEqual([]);
    });

    it('never throws when persisting fails', async () => {
      mockFetch.mockRejectedValue(new Error('db exploded'));
      await expect(log.clear()).resolves.toBeUndefined();
    });
  });

  it("two logs created with different keys never see each other's entries", async () => {
    const otherLog = createPersistedLog('other.key', 'OtherLog');
    mockFetch.mockResolvedValue([]);

    await log.append('for test.key');
    await otherLog.append('for other.key');

    const firstRecord: any = {};
    mockCreate.mock.calls[0][0](firstRecord);
    const secondRecord: any = {};
    mockCreate.mock.calls[1][0](secondRecord);

    expect(firstRecord.key).toBe('test.key');
    expect(secondRecord.key).toBe('other.key');
  });
});
