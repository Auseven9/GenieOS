// Overrides the global '../database' mock (set up in jest/setup.ts) with a
// controllable one, same pattern as ChatSessionRepository.pinned.test.ts.
const mockCreate = jest.fn();
const mockFetch = jest.fn();
const mockFind = jest.fn();
const mockWrite = jest.fn((callback: () => Promise<any>) => callback());

jest.mock('../../database', () => ({
  database: {
    write: (callback: () => Promise<any>) => mockWrite(callback),
    collections: {
      get: () => ({
        create: (mutator: (record: any) => void) => mockCreate(mutator),
        query: () => ({fetch: () => mockFetch()}),
        find: (id: string) => mockFind(id),
      }),
    },
  },
}));

const mockEmbed = jest.fn();
jest.mock('../../services/memory/EmbeddingEngine', () => ({
  __esModule: true,
  default: {embed: (...args: any[]) => mockEmbed(...args)},
}));

import memoryRepository from '../MemoryRepository';
import Memory from '../../database/models/Memory';

function makeRecord(overrides: Record<string, any> = {}) {
  const base: Record<string, any> = {
    id: 'mem-1',
    kind: 'fact',
    content: 'user likes dark mode',
    confidence: 0.5,
    provenance: 'user_stated',
    tags: '[]',
    pinned: false,
    status: 'active',
    accessCount: 0,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
  const instance = Object.create(Memory.prototype);
  for (const [k, v] of Object.entries(base)) {
    Object.defineProperty(instance, k, {
      value: v,
      writable: true,
      configurable: true,
      enumerable: true,
    });
  }
  return instance;
}

describe('MemoryRepository.createMemoryWithEmbedding', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockWrite.mockImplementation((callback: () => Promise<any>) => callback());
  });

  it('embeds the content and stores the encoded vector on the created memory', async () => {
    const vector = new Float32Array([0.5, -0.5, 1]);
    mockEmbed.mockResolvedValue(vector);
    mockCreate.mockImplementation((mutator: (record: any) => void) => {
      const record = makeRecord();
      mutator(record);
      return record;
    });

    const result = await memoryRepository.createMemoryWithEmbedding(
      '/models/bge-small.gguf',
      {
        kind: 'fact',
        content: 'user likes dark mode',
        provenance: 'user_stated',
        tags: ['ui'],
      },
    );

    expect(mockEmbed).toHaveBeenCalledWith(
      '/models/bge-small.gguf',
      'user likes dark mode',
    );
    expect(result.embedding).toBe(Memory.encodeEmbedding(vector));
  });
});

describe('MemoryRepository.searchByText', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('embeds the query text then ranks stored memories by similarity', async () => {
    const queryVector = new Float32Array([1, 0]);
    mockEmbed.mockResolvedValue(queryVector);

    const matching = makeRecord({
      id: 'mem-close',
      embedding: Memory.encodeEmbedding(new Float32Array([1, 0])),
    });
    const distant = makeRecord({
      id: 'mem-far',
      embedding: Memory.encodeEmbedding(new Float32Array([0, 1])),
    });
    mockFetch.mockResolvedValue([distant, matching]);

    const results = await memoryRepository.searchByText(
      '/models/bge-small.gguf',
      'does the user like dark mode?',
      5,
    );

    expect(mockEmbed).toHaveBeenCalledWith(
      '/models/bge-small.gguf',
      'does the user like dark mode?',
    );
    expect(results[0].id).toBe('mem-close');
    expect(results[0].similarity).toBeCloseTo(1);
    expect(results[1].id).toBe('mem-far');
    expect(results[1].similarity).toBeCloseTo(0);
  });
});

describe('MemoryRepository.supersedeMemoryWithEmbedding', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockWrite.mockImplementation((callback: () => Promise<any>) => callback());
  });

  it('embeds the replacement content and retires the old memory in its favor', async () => {
    const vector = new Float32Array([0.2, 0.4]);
    mockEmbed.mockResolvedValue(vector);
    mockCreate.mockImplementation((mutator: (record: any) => void) => {
      const record = makeRecord({id: 'mem-2'});
      mutator(record);
      return record;
    });

    const previous = makeRecord({id: 'mem-1'});
    previous.update = async (mutator: (record: any) => void) => {
      mutator(previous);
    };
    mockFind.mockResolvedValue(previous);

    const result = await memoryRepository.supersedeMemoryWithEmbedding(
      '/models/bge-small.gguf',
      'mem-1',
      {
        kind: 'fact',
        content: 'user now prefers light mode',
        provenance: 'user_stated',
        tags: [],
      },
    );

    expect(mockEmbed).toHaveBeenCalledWith(
      '/models/bge-small.gguf',
      'user now prefers light mode',
    );
    expect(result?.embedding).toBe(Memory.encodeEmbedding(vector));
    expect(mockFind).toHaveBeenCalledWith('mem-1');
    expect(previous.status).toBe('retired');
    expect(previous.supersededBy).toBe('mem-2');
  });
});
