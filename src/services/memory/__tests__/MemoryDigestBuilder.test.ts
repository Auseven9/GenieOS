const mockListMemories = jest.fn();
const mockSearchByText = jest.fn();

jest.mock('../../../repositories/MemoryRepository', () => ({
  __esModule: true,
  default: {
    listMemories: (...args: any[]) => mockListMemories(...args),
    searchByText: (...args: any[]) => mockSearchByText(...args),
  },
}));

import {buildMemoryDigest} from '../MemoryDigestBuilder';
import type {Memory} from '../../../types/memory';

function makeMemory(overrides: Partial<Memory> = {}): Memory {
  return {
    id: 'mem-default',
    kind: 'fact',
    content: 'default content',
    confidence: 0.5,
    provenance: 'user_stated',
    tags: [],
    pinned: false,
    status: 'active',
    accessCount: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('buildMemoryDigest', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockListMemories.mockResolvedValue([]);
    mockSearchByText.mockResolvedValue([]);
  });

  it('returns null and skips retrieval entirely when no embedding model is configured', async () => {
    const result = await buildMemoryDigest({queryText: 'hello'});
    expect(result).toBeNull();
    expect(mockListMemories).not.toHaveBeenCalled();
    expect(mockSearchByText).not.toHaveBeenCalled();
  });

  it('returns null when there are no pinned or matching memories', async () => {
    const result = await buildMemoryDigest({
      embeddingModelPath: '/models/bge-small.gguf',
      queryText: 'hello',
    });
    expect(result).toBeNull();
  });

  it('includes pinned memories even without any similarity match', async () => {
    mockListMemories.mockResolvedValue([
      makeMemory({id: 'p1', content: "mom's name is Linda", pinned: true}),
    ]);

    const result = await buildMemoryDigest({
      embeddingModelPath: '/models/bge-small.gguf',
      queryText: 'unrelated query',
    });

    expect(result).toContain("mom's name is Linda");
  });

  it('includes similarity-ranked matches', async () => {
    mockSearchByText.mockResolvedValue([
      {...makeMemory({id: 'r1', content: 'likes dark mode'}), similarity: 0.9},
    ]);

    const result = await buildMemoryDigest({
      embeddingModelPath: '/models/bge-small.gguf',
      queryText: 'what theme do I like?',
    });

    expect(result).toContain('likes dark mode');
    // Fetches a wider candidate pool than maxMemories so decay-based
    // re-ranking (see decay.ts) has room to promote a fresher match over
    // one that only wins on raw similarity.
    expect(mockSearchByText).toHaveBeenCalledWith(
      '/models/bge-small.gguf',
      'what theme do I like?',
      24,
    );
  });

  it('deduplicates a memory that is both pinned and a similarity match', async () => {
    const shared = makeMemory({
      id: 'dup',
      content: 'shared memory',
      pinned: true,
    });
    mockListMemories.mockResolvedValue([shared]);
    mockSearchByText.mockResolvedValue([{...shared, similarity: 0.99}]);

    const result = await buildMemoryDigest({
      embeddingModelPath: '/models/bge-small.gguf',
      queryText: 'x',
    });

    expect(result?.match(/shared memory/g)).toHaveLength(1);
  });

  it('ranks a fresher, well-reinforced match above a stale one that only wins on raw similarity', async () => {
    const now = new Date();
    const recent = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
    const stale = new Date(
      now.getTime() - 365 * 24 * 60 * 60 * 1000,
    ).toISOString();

    mockSearchByText.mockResolvedValue([
      // Higher raw similarity, but a year old and never reinforced since.
      {
        ...makeMemory({
          id: 'stale-high-similarity',
          content: 'stale match',
          createdAt: stale,
        }),
        similarity: 0.95,
      },
      // Lower raw similarity, but recently created.
      {
        ...makeMemory({
          id: 'fresh-lower-similarity',
          content: 'fresh match',
          createdAt: recent,
        }),
        similarity: 0.7,
      },
    ]);

    const result = await buildMemoryDigest({
      embeddingModelPath: '/models/bge-small.gguf',
      queryText: 'x',
      maxMemories: 1,
    });

    expect(result).toContain('fresh match');
    expect(result).not.toContain('stale match');
  });

  it('marks each line with its literal provenance so the tag survives into the prompt text', async () => {
    mockListMemories.mockResolvedValue([
      makeMemory({
        id: 'a',
        content: 'a trusted fact',
        provenance: 'user_stated',
        pinned: true,
      }),
      makeMemory({
        id: 'b',
        content: 'an unverified claim',
        provenance: 'external_content',
        pinned: true,
      }),
    ]);

    const result = await buildMemoryDigest({
      embeddingModelPath: '/models/bge-small.gguf',
      queryText: 'x',
    });

    expect(result).toContain('[user_stated] a trusted fact');
    expect(result).toContain('[external_content] an unverified claim');
  });

  it('respects maxMemories', async () => {
    mockListMemories.mockResolvedValue(
      Array.from({length: 10}, (_, i) =>
        makeMemory({id: `p${i}`, content: `pinned ${i}`, pinned: true}),
      ),
    );

    const result = await buildMemoryDigest({
      embeddingModelPath: '/models/bge-small.gguf',
      queryText: 'x',
      maxMemories: 3,
    });

    const lineCount = result?.split('\n').length ?? 0;
    // 1 header line + at most maxMemories content lines.
    expect(lineCount).toBeLessThanOrEqual(4);
  });

  it('stops adding lines once the character budget is exhausted', async () => {
    // Measure the real cost of header + short line first, rather than
    // guessing a magic number that happens to work against the current
    // header text.
    mockListMemories.mockResolvedValue([
      makeMemory({id: 'short', content: 'short one', pinned: true}),
    ]);
    const shortOnlyDigest = await buildMemoryDigest({
      embeddingModelPath: '/models/bge-small.gguf',
      queryText: 'x',
    });
    const budget = shortOnlyDigest!.length + 10;

    mockListMemories.mockResolvedValue([
      makeMemory({id: 'short', content: 'short one', pinned: true}),
      makeMemory({id: 'long', content: 'x'.repeat(500), pinned: true}),
    ]);

    const result = await buildMemoryDigest({
      embeddingModelPath: '/models/bge-small.gguf',
      queryText: 'x',
      maxChars: budget,
    });

    expect(result).toContain('short one');
    expect(result).not.toContain('x'.repeat(500));
  });

  it('returns null when retrieval throws, rather than propagating the error', async () => {
    mockListMemories.mockRejectedValue(new Error('db exploded'));
    const result = await buildMemoryDigest({
      embeddingModelPath: '/models/bge-small.gguf',
      queryText: 'x',
    });
    expect(result).toBeNull();
  });
});
