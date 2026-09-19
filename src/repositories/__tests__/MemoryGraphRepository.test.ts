// Overrides the global '../database' mock (set up in jest/setup.ts) with a
// controllable one, same pattern as MemoryRepository.embedding.test.ts —
// but routed by table name since this repository touches three collections.
const mockNodeCreate = jest.fn();
const mockNodeFetch = jest.fn();
const mockNodeFind = jest.fn();
const mockEdgeCreate = jest.fn();
const mockEdgeFetch = jest.fn();
const mockCompartmentCreate = jest.fn();
const mockCompartmentFetch = jest.fn();
const mockWrite = jest.fn((callback: () => Promise<any>) => callback());

jest.mock('../../database', () => ({
  database: {
    write: (callback: () => Promise<any>) => mockWrite(callback),
    collections: {
      get: (table: string) => {
        if (table === 'memory_nodes') {
          return {
            create: (mutator: (record: any) => void) => mockNodeCreate(mutator),
            query: (...clauses: any[]) => ({
              fetch: () => mockNodeFetch(...clauses),
            }),
            find: (id: string) => mockNodeFind(id),
          };
        }
        if (table === 'memory_edges') {
          return {
            create: (mutator: (record: any) => void) => mockEdgeCreate(mutator),
            query: (...clauses: any[]) => ({
              fetch: () => mockEdgeFetch(...clauses),
            }),
          };
        }
        if (table === 'memory_compartments') {
          return {
            create: (mutator: (record: any) => void) =>
              mockCompartmentCreate(mutator),
            query: (...clauses: any[]) => ({
              fetch: () => mockCompartmentFetch(...clauses),
            }),
          };
        }
        throw new Error(`unexpected table: ${table}`);
      },
    },
  },
}));

const mockEmbed = jest.fn();
jest.mock('../../services/memory/EmbeddingEngine', () => ({
  __esModule: true,
  default: {embed: (...args: any[]) => mockEmbed(...args)},
}));

import memoryGraphRepository, {
  EDGE_REINFORCEMENT_STEP,
} from '../MemoryGraphRepository';
import MemoryNode from '../../database/models/MemoryNode';
import MemoryEdge from '../../database/models/MemoryEdge';

function makeNodeRecord(overrides: Record<string, any> = {}) {
  const base: Record<string, any> = {
    id: 'node-1',
    label: 'cats',
    kind: 'topic',
    confidence: 0.5,
    compartmentId: undefined,
    provenance: 'user_stated',
    pinned: false,
    status: 'active',
    accessCount: 0,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
  const instance = Object.create(MemoryNode.prototype);
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

function makeEdgeRecord(overrides: Record<string, any> = {}) {
  const base: Record<string, any> = {
    id: 'edge-1',
    sourceNodeId: 'node-1',
    targetNodeId: 'node-2',
    relation: 'MENTIONS',
    weight: 0.5,
    confidence: 0.5,
    provenance: 'user_stated',
    status: 'active',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
  const instance = Object.create(MemoryEdge.prototype);
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

describe('MemoryGraphRepository.findOrCreateNode', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockWrite.mockImplementation((callback: () => Promise<any>) => callback());
  });

  it('reuses an existing active node matched case-insensitively by label', async () => {
    const existing = makeNodeRecord({label: 'Cats'});
    mockNodeFetch.mockResolvedValue([existing]);

    const result = await memoryGraphRepository.findOrCreateNode({
      label: 'cats',
      kind: 'topic',
      provenance: 'user_stated',
    });

    expect(result.id).toBe('node-1');
    expect(mockNodeCreate).not.toHaveBeenCalled();
  });

  it('creates a new node when no matching label exists', async () => {
    mockNodeFetch.mockResolvedValue([]);
    mockNodeCreate.mockImplementation((mutator: (record: any) => void) => {
      const record = makeNodeRecord({label: 'dark mode preference'});
      mutator(record);
      return record;
    });

    const result = await memoryGraphRepository.findOrCreateNode({
      label: 'dark mode preference',
      kind: 'preference',
      provenance: 'user_stated',
    });

    expect(result.label).toBe('dark mode preference');
    expect(mockNodeCreate).toHaveBeenCalledTimes(1);
  });

  it('embeds the node when an embedding model path is given and none matches', async () => {
    mockNodeFetch.mockResolvedValue([]);
    const vector = new Float32Array([1, 2]);
    mockEmbed.mockResolvedValue(vector);
    mockNodeCreate.mockImplementation((mutator: (record: any) => void) => {
      const record = makeNodeRecord();
      mutator(record);
      return record;
    });

    const result = await memoryGraphRepository.findOrCreateNode(
      {label: 'cats', kind: 'topic', provenance: 'user_stated'},
      '/models/bge-small.gguf',
    );

    expect(mockEmbed).toHaveBeenCalledWith('/models/bge-small.gguf', 'cats');
    expect(result.embedding).toBe(MemoryNode.encodeEmbedding(vector));
  });
});

describe('MemoryGraphRepository.upsertEdge', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockWrite.mockImplementation((callback: () => Promise<any>) => callback());
  });

  it('creates a new edge when none exists between the two nodes for that relation', async () => {
    mockEdgeFetch.mockResolvedValue([]);
    mockEdgeCreate.mockImplementation((mutator: (record: any) => void) => {
      const record = makeEdgeRecord();
      mutator(record);
      return record;
    });

    const result = await memoryGraphRepository.upsertEdge({
      sourceNodeId: 'node-1',
      targetNodeId: 'node-2',
      relation: 'MENTIONS',
      provenance: 'user_stated',
    });

    expect(result.relation).toBe('MENTIONS');
    expect(mockEdgeCreate).toHaveBeenCalledTimes(1);
  });

  it('reinforces an existing edge instead of creating a duplicate', async () => {
    const existing = makeEdgeRecord({weight: 0.5, confidence: 0.4});
    existing.update = async (mutator: (record: any) => void) => {
      mutator(existing);
    };
    mockEdgeFetch.mockResolvedValue([existing]);

    const result = await memoryGraphRepository.upsertEdge({
      sourceNodeId: 'node-1',
      targetNodeId: 'node-2',
      relation: 'MENTIONS',
      provenance: 'user_stated',
      confidence: 0.8,
    });

    expect(mockEdgeCreate).not.toHaveBeenCalled();
    expect(result.weight).toBeCloseTo(0.5 + EDGE_REINFORCEMENT_STEP);
    expect(result.confidence).toBeCloseTo((0.4 + 0.8) / 2);
  });

  it('caps reinforced weight at 1', async () => {
    const existing = makeEdgeRecord({weight: 0.95, confidence: 0.5});
    existing.update = async (mutator: (record: any) => void) => {
      mutator(existing);
    };
    mockEdgeFetch.mockResolvedValue([existing]);

    const result = await memoryGraphRepository.upsertEdge({
      sourceNodeId: 'node-1',
      targetNodeId: 'node-2',
      relation: 'MENTIONS',
      provenance: 'user_stated',
    });

    expect(result.weight).toBe(1);
  });
});

describe('MemoryGraphRepository.listEdges', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('merges outgoing and incoming edges without duplicates when direction is both', async () => {
    const outgoing = makeEdgeRecord({id: 'edge-out'});
    const incoming = makeEdgeRecord({id: 'edge-in'});
    mockEdgeFetch
      .mockResolvedValueOnce([outgoing])
      .mockResolvedValueOnce([incoming]);

    const results = await memoryGraphRepository.listEdges({
      nodeId: 'node-1',
    });

    expect(results.map(e => e.id).sort()).toEqual(['edge-in', 'edge-out']);
  });

  it('only fetches outgoing edges when direction is outgoing', async () => {
    const outgoing = makeEdgeRecord({id: 'edge-out'});
    mockEdgeFetch.mockResolvedValueOnce([outgoing]);

    const results = await memoryGraphRepository.listEdges({
      nodeId: 'node-1',
      direction: 'outgoing',
    });

    expect(mockEdgeFetch).toHaveBeenCalledTimes(1);
    expect(results.map(e => e.id)).toEqual(['edge-out']);
  });
});

describe('MemoryGraphRepository.getOrCreateCompartment', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockWrite.mockImplementation((callback: () => Promise<any>) => callback());
  });

  it('reuses an existing compartment matched case-insensitively by name', async () => {
    const record = {
      id: 'compartment-1',
      name: 'Work',
      description: undefined,
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
      toView() {
        return {
          id: this.id,
          name: this.name,
          description: this.description,
          createdAt: this.createdAt.toISOString(),
          updatedAt: this.updatedAt.toISOString(),
        };
      },
    };
    mockCompartmentFetch.mockResolvedValue([record]);

    const result = await memoryGraphRepository.getOrCreateCompartment('work');

    expect(result.id).toBe('compartment-1');
    expect(mockCompartmentCreate).not.toHaveBeenCalled();
  });

  it('creates a new compartment when none matches', async () => {
    mockCompartmentFetch.mockResolvedValue([]);
    mockCompartmentCreate.mockImplementation(
      (mutator: (record: any) => void) => {
        const record: Record<string, any> = {
          id: 'compartment-2',
          createdAt: new Date('2026-01-01T00:00:00Z'),
          updatedAt: new Date('2026-01-01T00:00:00Z'),
          toView() {
            return {
              id: this.id,
              name: this.name,
              description: this.description,
              createdAt: this.createdAt.toISOString(),
              updatedAt: this.updatedAt.toISOString(),
            };
          },
        };
        mutator(record);
        return record;
      },
    );

    const result = await memoryGraphRepository.getOrCreateCompartment(
      'family',
      'family-related memory',
    );

    expect(result.name).toBe('family');
    expect(mockCompartmentCreate).toHaveBeenCalledTimes(1);
  });
});
