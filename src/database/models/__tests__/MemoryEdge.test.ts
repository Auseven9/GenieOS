import MemoryEdgeModel from '../MemoryEdge';

function makeEdge(raw: Record<string, any> = {}): MemoryEdgeModel {
  const base: Record<string, any> = {
    sourceNodeId: 'node-1',
    targetNodeId: 'node-2',
    relation: 'MENTIONS',
    weight: 0.5,
    confidence: 0.5,
    provenance: 'user_stated',
    status: 'active',
    accessCount: 0,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-02T00:00:00Z'),
    ...raw,
  };
  const instance = Object.create(MemoryEdgeModel.prototype);
  for (const [k, v] of Object.entries(base)) {
    Object.defineProperty(instance, k, {
      value: v,
      writable: true,
      configurable: true,
      enumerable: true,
    });
  }
  return instance as MemoryEdgeModel;
}

describe('MemoryEdge.toView', () => {
  it('produces the view shape with ISO dates', () => {
    const edge = makeEdge({
      relation: 'SUPPORTS',
      sourceConversationId: 'session-1',
      extractedBy: 'draft-model-id',
      accessCount: 3,
      lastAccessedAt: new Date('2026-01-03T00:00:00Z').getTime(),
    });

    const view = edge.toView();
    expect(view.sourceNodeId).toBe('node-1');
    expect(view.targetNodeId).toBe('node-2');
    expect(view.relation).toBe('SUPPORTS');
    expect(view.sourceConversationId).toBe('session-1');
    expect(view.extractedBy).toBe('draft-model-id');
    expect(view.accessCount).toBe(3);
    expect(view.lastAccessedAt).toBe('2026-01-03T00:00:00.000Z');
    expect(view.createdAt).toBe('2026-01-01T00:00:00.000Z');
    expect(view.updatedAt).toBe('2026-01-02T00:00:00.000Z');
  });
});
