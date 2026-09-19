import MemoryNodeModel from '../MemoryNode';

function makeNode(raw: Record<string, any> = {}): MemoryNodeModel {
  const base: Record<string, any> = {
    label: 'cats',
    kind: 'topic',
    memoryType: 'semantic',
    confidence: 0.8,
    provenance: 'user_stated',
    pinned: false,
    status: 'active',
    accessCount: 0,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-02T00:00:00Z'),
    ...raw,
  };
  const instance = Object.create(MemoryNodeModel.prototype);
  for (const [k, v] of Object.entries(base)) {
    Object.defineProperty(instance, k, {
      value: v,
      writable: true,
      configurable: true,
      enumerable: true,
    });
  }
  return instance as MemoryNodeModel;
}

describe('MemoryNode embedding round-trip', () => {
  it('encodes and decodes a float vector losslessly', () => {
    const original = new Float32Array([0.1, -0.25, 3.5, 0, 1.75]);
    const encoded = MemoryNodeModel.encodeEmbedding(original);
    const node = makeNode({embedding: encoded});

    const decoded = node.embeddingVector;
    expect(decoded).toBeDefined();
    expect(Array.from(decoded!)).toEqual(Array.from(original));
  });

  it('returns undefined when no embedding is stored', () => {
    expect(makeNode({embedding: undefined}).embeddingVector).toBeUndefined();
  });
});

describe('MemoryNode.toView', () => {
  it('produces the view shape with ISO dates', () => {
    const node = makeNode({
      description: 'the user has two cats',
      valence: 0.4,
      intensity: 0.2,
      salience: 0.6,
      compartmentId: 'compartment-1',
      sourceMemoryId: 'memory-1',
      sourceConversationId: 'session-1',
      extractedBy: 'draft-model-id',
      lastAccessedAt: new Date('2026-01-03T00:00:00Z').getTime(),
    });

    const view = node.toView();
    expect(view.label).toBe('cats');
    expect(view.kind).toBe('topic');
    expect(view.memoryType).toBe('semantic');
    expect(view.description).toBe('the user has two cats');
    expect(view.salience).toBe(0.6);
    expect(view.compartmentId).toBe('compartment-1');
    expect(view.sourceMemoryId).toBe('memory-1');
    expect(view.sourceConversationId).toBe('session-1');
    expect(view.extractedBy).toBe('draft-model-id');
    expect(view.createdAt).toBe('2026-01-01T00:00:00.000Z');
    expect(view.lastAccessedAt).toBe('2026-01-03T00:00:00.000Z');
  });
});
