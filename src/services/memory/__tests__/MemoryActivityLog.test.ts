// Deep read/write/cap logic lives in persistedLog.test.ts (this module is
// a thin createPersistedLog wrapper) — these are smoke tests confirming
// MemoryActivityLog wires its own key and its exports actually work.
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

import {
  logMemoryActivity,
  getMemoryActivityLog,
  clearMemoryActivityLog,
} from '../MemoryActivityLog';

describe('MemoryActivityLog', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockWrite.mockImplementation((callback: () => Promise<any>) => callback());
  });

  it('getMemoryActivityLog returns an empty array when nothing has been logged', async () => {
    mockFetch.mockResolvedValue([]);
    expect(await getMemoryActivityLog()).toEqual([]);
  });

  it('logMemoryActivity persists a new entry under the memory.activityLog key, distinct from the sweep log', async () => {
    mockFetch.mockResolvedValue([]);

    await logMemoryActivity('Remembered: cats');

    const record: any = {};
    mockCreate.mock.calls[0][0](record);
    expect(record.key).toBe('memory.activityLog');
    expect(record.key).not.toBe('memory.sweepLog');
    const stored = JSON.parse(record.value);
    expect(stored).toEqual([
      {ts: expect.any(Number), message: 'Remembered: cats'},
    ]);
  });

  it('clearMemoryActivityLog overwrites the stored entries with an empty array', async () => {
    const row: any = {value: JSON.stringify([{ts: 1, message: 'first'}])};
    row.update = (mutator: (record: any) => void) => {
      mutator(row);
      return Promise.resolve(row);
    };
    mockFetch.mockResolvedValue([row]);

    await clearMemoryActivityLog();

    expect(JSON.parse(row.value)).toEqual([]);
  });
});
