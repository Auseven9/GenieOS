// Deep read/write/cap logic lives in persistedLog.test.ts (this module is
// a thin createPersistedLog wrapper) — these are smoke tests confirming
// MemorySweepLog wires the right key and its exports actually work.
const mockFetch = jest.fn();
const mockCreate = jest.fn();
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

describe('MemorySweepLog', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockWrite.mockImplementation((callback: () => Promise<any>) => callback());
  });

  it('getSweepLog returns an empty array when nothing has been logged', async () => {
    mockFetch.mockResolvedValue([]);
    expect(await getSweepLog()).toEqual([]);
  });

  it('logSweepEvent persists a new entry under the memory.sweepLog key', async () => {
    mockFetch.mockResolvedValue([]);

    await logSweepEvent('hello');

    const record: any = {};
    mockCreate.mock.calls[0][0](record);
    expect(record.key).toBe('memory.sweepLog');
    const stored = JSON.parse(record.value);
    expect(stored).toEqual([{ts: expect.any(Number), message: 'hello'}]);
  });

  it('clearSweepLog overwrites the stored entries with an empty array', async () => {
    const row: any = {value: JSON.stringify([{ts: 1, message: 'first'}])};
    row.update = (mutator: (record: any) => void) => {
      mutator(row);
      return Promise.resolve(row);
    };
    mockFetch.mockResolvedValue([row]);

    await clearSweepLog();

    expect(JSON.parse(row.value)).toEqual([]);
  });
});
