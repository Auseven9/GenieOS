// Overrides the global '../src/database' mock (set up in jest/setup.ts),
// same pattern as MemorySettingsRepository.test.ts — but this file also
// needs a working row.update() for the "existing row" write path, which
// that convention never exercises (its own tests only ever hit create()).
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

import {logSweepEvent, getSweepLog, clearSweepLog} from '../MemorySweepLog';

function existingRow(entries: Array<{ts: number; message: string}>) {
  const row: any = {value: JSON.stringify(entries)};
  row.update = (mutator: (record: any) => void) => {
    mockUpdate(mutator);
    mutator(row);
    return Promise.resolve(row);
  };
  return row;
}

describe('MemorySweepLog', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockWrite.mockImplementation((callback: () => Promise<any>) => callback());
  });

  describe('getSweepLog', () => {
    it('returns an empty array when nothing has been logged', async () => {
      mockFetch.mockResolvedValue([]);
      expect(await getSweepLog()).toEqual([]);
    });

    it('returns parsed entries in stored order', async () => {
      const entries = [
        {ts: 1, message: 'a'},
        {ts: 2, message: 'b'},
      ];
      mockFetch.mockResolvedValue([{value: JSON.stringify(entries)}]);
      expect(await getSweepLog()).toEqual(entries);
    });

    it('returns an empty array on corrupt stored JSON', async () => {
      mockFetch.mockResolvedValue([{value: 'not json'}]);
      expect(await getSweepLog()).toEqual([]);
    });

    it('returns an empty array if the stored value is not an array', async () => {
      mockFetch.mockResolvedValue([{value: JSON.stringify({not: 'an array'})}]);
      expect(await getSweepLog()).toEqual([]);
    });

    it('never throws when the query itself fails', async () => {
      mockFetch.mockRejectedValue(new Error('db exploded'));
      await expect(getSweepLog()).resolves.toEqual([]);
    });
  });

  describe('logSweepEvent', () => {
    it('creates a new row with the first entry when none exists yet', async () => {
      mockFetch.mockResolvedValue([]);
      const before = Date.now();

      await logSweepEvent('hello');

      const record: any = {};
      mockCreate.mock.calls[0][0](record);
      const stored = JSON.parse(record.value);
      expect(stored).toHaveLength(1);
      expect(stored[0].message).toBe('hello');
      expect(stored[0].ts).toBeGreaterThanOrEqual(before);
    });

    it('appends to an existing row rather than replacing it', async () => {
      const row = existingRow([{ts: 1, message: 'first'}]);
      mockFetch.mockResolvedValue([row]);

      await logSweepEvent('second');

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

      await logSweepEvent('newest');

      const stored = JSON.parse(row.value);
      expect(stored).toHaveLength(200);
      expect(stored[0].message).toBe('msg-1');
      expect(stored[stored.length - 1].message).toBe('newest');
    });

    it('never throws when persisting fails', async () => {
      mockFetch.mockRejectedValue(new Error('db exploded'));
      await expect(logSweepEvent('hello')).resolves.toBeUndefined();
    });
  });

  describe('clearSweepLog', () => {
    it('overwrites the existing row with an empty array', async () => {
      const row = existingRow([{ts: 1, message: 'first'}]);
      mockFetch.mockResolvedValue([row]);

      await clearSweepLog();

      expect(JSON.parse(row.value)).toEqual([]);
    });

    it('never throws when persisting fails', async () => {
      mockFetch.mockRejectedValue(new Error('db exploded'));
      await expect(clearSweepLog()).resolves.toBeUndefined();
    });
  });
});
