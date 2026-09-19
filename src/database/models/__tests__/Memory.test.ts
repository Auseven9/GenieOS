import MemoryModel from '../Memory';

/**
 * Memory is a WatermelonDB model, but its tags/embedding round-trip logic is
 * pure JS. Under the jest mock for watermelondb decorators, fields are plain
 * instance properties, so we can set them directly and exercise the getters
 * without a real DB — same approach as LocalPal.test.ts.
 */
function makeMemory(raw: Record<string, any> = {}): MemoryModel {
  const base: Record<string, any> = {
    kind: 'fact',
    content: 'Test memory',
    confidence: 0.8,
    provenance: 'user_stated',
    tags: '[]',
    pinned: false,
    status: 'active',
    accessCount: 0,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-02T00:00:00Z'),
    ...raw,
  };
  const instance = Object.create(MemoryModel.prototype);
  for (const [k, v] of Object.entries(base)) {
    Object.defineProperty(instance, k, {
      value: v,
      writable: true,
      configurable: true,
      enumerable: true,
    });
  }
  return instance as MemoryModel;
}

describe('Memory.tagsArray', () => {
  it('parses stringified tags', () => {
    const memory = makeMemory({tags: MemoryModel.safeStringifyArray(['mom', 'health'])});
    expect(memory.tagsArray).toEqual(['mom', 'health']);
  });

  it('falls back to an empty array on missing/invalid JSON', () => {
    expect(makeMemory({tags: ''}).tagsArray).toEqual([]);
    expect(makeMemory({tags: 'not json'}).tagsArray).toEqual([]);
  });
});

describe('Memory embedding round-trip', () => {
  it('encodes and decodes a float vector losslessly', () => {
    const original = new Float32Array([0.1, -0.25, 3.5, 0, 1.75]);
    const encoded = MemoryModel.encodeEmbedding(original);
    const memory = makeMemory({embedding: encoded});

    const decoded = memory.embeddingVector;
    expect(decoded).toBeDefined();
    expect(Array.from(decoded!)).toEqual(Array.from(original));
  });

  it('returns undefined when no embedding is stored', () => {
    expect(makeMemory({embedding: undefined}).embeddingVector).toBeUndefined();
  });
});

describe('Memory.toView', () => {
  it('produces the view shape with parsed tags and ISO dates', () => {
    const memory = makeMemory({
      tags: MemoryModel.safeStringifyArray(['work']),
      valence: -0.4,
      intensity: 0.7,
      lastAccessedAt: new Date('2026-01-03T00:00:00Z').getTime(),
    });

    const view = memory.toView();
    expect(view.tags).toEqual(['work']);
    expect(view.valence).toBe(-0.4);
    expect(view.intensity).toBe(0.7);
    expect(view.createdAt).toBe('2026-01-01T00:00:00.000Z');
    expect(view.lastAccessedAt).toBe('2026-01-03T00:00:00.000Z');
  });
});
