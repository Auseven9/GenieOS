// Overrides the global '../database' mock (set up in jest/setup.ts) with a
// controllable one, same pattern as MemoryRepository.embedding.test.ts —
// but routed by table name since this repository touches three collections.
const mockNodeCreate = jest.fn();
const mockNodeFetch = jest.fn();
const mockNodeFind = jest.fn();
const mockNodeObserve = jest.fn();
const mockEdgeCreate = jest.fn();
const mockEdgeFetch = jest.fn();
const mockEdgeFind = jest.fn();
const mockEdgeObserve = jest.fn();
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
              observe: () => mockNodeObserve(...clauses),
            }),
            find: (id: string) => mockNodeFind(id),
          };
        }
        if (table === 'memory_edges') {
          return {
            create: (mutator: (record: any) => void) => mockEdgeCreate(mutator),
            query: (...clauses: any[]) => ({
              fetch: () => mockEdgeFetch(...clauses),
              observe: () => mockEdgeObserve(...clauses),
            }),
            find: (id: string) => mockEdgeFind(id),
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

const mockLogMemoryActivity = jest.fn();
jest.mock('../../services/memory/MemoryActivityLog', () => ({
  logMemoryActivity: (...args: any[]) => mockLogMemoryActivity(...args),
}));

import {of, Subject} from 'rxjs';
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
    memoryType: 'semantic',
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
      memoryType: 'semantic',
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
      memoryType: 'semantic',
      provenance: 'user_stated',
    });

    expect(result.label).toBe('dark mode preference');
    expect(mockNodeCreate).toHaveBeenCalledTimes(1);
    expect(mockLogMemoryActivity).toHaveBeenCalledWith(
      'Remembered: dark mode preference',
    );
  });

  it('does not log activity for a node created quarantined', async () => {
    mockNodeFetch.mockResolvedValue([]);
    mockNodeCreate.mockImplementation((mutator: (record: any) => void) => {
      const record = makeNodeRecord({
        label: 'shaky claim',
        status: 'quarantined',
      });
      mutator(record);
      return record;
    });

    await memoryGraphRepository.findOrCreateNode(
      {
        label: 'shaky claim',
        kind: 'topic',
        memoryType: 'semantic',
        provenance: 'user_stated',
      },
      undefined,
      'quarantined',
    );

    expect(mockLogMemoryActivity).not.toHaveBeenCalled();
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
      {
        label: 'cats',
        kind: 'topic',
        memoryType: 'semantic',
        provenance: 'user_stated',
      },
      '/models/bge-small.gguf',
    );

    expect(mockEmbed).toHaveBeenCalledWith('/models/bge-small.gguf', 'cats');
    expect(result.embedding).toBe(MemoryNode.encodeEmbedding(vector));
  });

  it('never dedupes episodic nodes, even against an identical label', async () => {
    mockNodeCreate.mockImplementation((mutator: (record: any) => void) => {
      const record = makeNodeRecord({memoryType: 'episodic'});
      mutator(record);
      return record;
    });

    await memoryGraphRepository.findOrCreateNode({
      label: 'cats',
      kind: 'topic',
      memoryType: 'episodic',
      provenance: 'user_stated',
    });

    // No lookup query should even run for the episodic path.
    expect(mockNodeFetch).not.toHaveBeenCalled();
    expect(mockNodeCreate).toHaveBeenCalledTimes(1);
  });
});

describe('MemoryGraphRepository.searchNodesByEmbedding', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('ranks a fresher, well-reinforced node above a stale one that only wins on raw similarity', async () => {
    const vector = new Float32Array([1, 0]);
    const encoded = MemoryNode.encodeEmbedding(vector);
    const now = new Date();
    const stale = makeNodeRecord({
      id: 'node-stale',
      embedding: encoded,
      createdAt: new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000),
    });
    const fresh = makeNodeRecord({
      id: 'node-fresh',
      embedding: encoded,
      createdAt: new Date(now.getTime() - 24 * 60 * 60 * 1000),
    });
    mockNodeFetch.mockResolvedValue([stale, fresh]);

    const results = await memoryGraphRepository.searchNodesByEmbedding(
      vector,
      1,
    );

    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('node-fresh');
  });
});

describe('MemoryGraphRepository.upsertSemanticNode', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockWrite.mockImplementation((callback: () => Promise<any>) => callback());
  });

  it('throws for a non-semantic input rather than silently accepting it', async () => {
    await expect(
      memoryGraphRepository.upsertSemanticNode({
        label: 'cats',
        kind: 'topic',
        memoryType: 'episodic',
        provenance: 'model_inferred',
      }),
    ).rejects.toThrow(/memoryType "semantic"/);
  });

  it('creates a new node when no matching semantic node exists', async () => {
    mockNodeFetch.mockResolvedValue([]);
    mockNodeCreate.mockImplementation((mutator: (record: any) => void) => {
      const record = makeNodeRecord({label: 'cats'});
      mutator(record);
      return record;
    });

    const result = await memoryGraphRepository.upsertSemanticNode({
      label: 'cats',
      kind: 'topic',
      memoryType: 'semantic',
      description: 'consolidated summary',
      provenance: 'model_inferred',
    });

    expect(result.label).toBe('cats');
    expect(mockNodeCreate).toHaveBeenCalledTimes(1);
    expect(mockLogMemoryActivity).toHaveBeenCalledWith('Remembered: cats');
  });

  it('updates an existing matching semantic node in place rather than leaving it untouched', async () => {
    const existing = makeNodeRecord({
      label: 'Cats',
      description: 'old summary',
      confidence: 0.5,
    });
    existing.update = async (mutator: (record: any) => void) =>
      mutator(existing);
    mockNodeFetch.mockResolvedValue([existing]);

    const result = await memoryGraphRepository.upsertSemanticNode({
      label: 'cats',
      kind: 'topic',
      memoryType: 'semantic',
      description: 'fresh consolidated summary',
      confidence: 0.9,
      provenance: 'model_inferred',
    });

    expect(mockNodeCreate).not.toHaveBeenCalled();
    expect(existing.description).toBe('fresh consolidated summary');
    expect(existing.confidence).toBe(0.9);
    expect(result.description).toBe('fresh consolidated summary');
    expect(mockLogMemoryActivity).toHaveBeenCalledWith('Updated: cats');
  });

  it('re-embeds the updated node when an embedding model path is given', async () => {
    const existing = makeNodeRecord({label: 'cats', embedding: 'old-embed'});
    existing.update = async (mutator: (record: any) => void) =>
      mutator(existing);
    mockNodeFetch.mockResolvedValue([existing]);
    const vector = new Float32Array([1, 2]);
    mockEmbed.mockResolvedValue(vector);

    await memoryGraphRepository.upsertSemanticNode(
      {
        label: 'cats',
        kind: 'topic',
        memoryType: 'semantic',
        description: 'fresh summary',
        provenance: 'model_inferred',
      },
      '/models/bge-small.gguf',
    );

    expect(existing.embedding).toBe(MemoryNode.encodeEmbedding(vector));
  });
});

describe('MemoryGraphRepository.upsertEdge', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockWrite.mockImplementation((callback: () => Promise<any>) => callback());
    // Both nodes in the same (no) compartment by default, so the
    // compartment firewall passes unless a test overrides this.
    mockNodeFind.mockImplementation(async (id: string) => makeNodeRecord({id}));
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

  it('refuses an edge across two different compartments', async () => {
    mockNodeFind.mockImplementation(async (id: string) =>
      makeNodeRecord({id, compartmentId: id === 'node-1' ? 'work' : 'home'}),
    );

    await expect(
      memoryGraphRepository.upsertEdge({
        sourceNodeId: 'node-1',
        targetNodeId: 'node-2',
        relation: 'MENTIONS',
        provenance: 'user_stated',
      }),
    ).rejects.toThrow(/compartments/);
    expect(mockEdgeCreate).not.toHaveBeenCalled();
  });

  it('allows a BRIDGES_TO edge across two different compartments', async () => {
    mockNodeFind.mockImplementation(async (id: string) =>
      makeNodeRecord({id, compartmentId: id === 'node-1' ? 'work' : 'home'}),
    );
    mockEdgeFetch.mockResolvedValue([]);
    mockEdgeCreate.mockImplementation((mutator: (record: any) => void) => {
      const record = makeEdgeRecord({relation: 'BRIDGES_TO'});
      mutator(record);
      return record;
    });

    const result = await memoryGraphRepository.upsertEdge({
      sourceNodeId: 'node-1',
      targetNodeId: 'node-2',
      relation: 'BRIDGES_TO',
      provenance: 'user_stated',
    });

    expect(result.relation).toBe('BRIDGES_TO');
  });
});

describe('MemoryGraphRepository.resolveContradiction', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockWrite.mockImplementation((callback: () => Promise<any>) => callback());
  });

  it('retires the lower-confidence node and writes a SUPERSEDES edge from the winner', async () => {
    const winner = makeNodeRecord({id: 'node-winner', confidence: 0.9});
    const loser = makeNodeRecord({id: 'node-loser', confidence: 0.3});
    loser.update = async (mutator: (record: any) => void) => mutator(loser);
    mockNodeFind.mockImplementation(async (id: string) =>
      id === 'node-winner' ? winner : loser,
    );
    mockEdgeCreate.mockImplementation((mutator: (record: any) => void) => {
      const record = makeEdgeRecord({relation: 'SUPERSEDES'});
      mutator(record);
      return record;
    });

    const result = await memoryGraphRepository.resolveContradiction(
      'node-winner',
      'node-loser',
    );

    expect(result).toEqual({winnerId: 'node-winner', loserId: 'node-loser'});
    expect(loser.status).toBe('retired');
    expect(mockEdgeCreate).toHaveBeenCalledTimes(1);
    expect(mockLogMemoryActivity).toHaveBeenCalledWith(
      expect.stringContaining('superseded'),
    );
  });

  it('breaks a confidence tie in favor of the more recently created node', async () => {
    const older = makeNodeRecord({
      id: 'node-older',
      confidence: 0.5,
      createdAt: new Date('2026-01-01T00:00:00Z'),
    });
    const newer = makeNodeRecord({
      id: 'node-newer',
      confidence: 0.5,
      createdAt: new Date('2026-06-01T00:00:00Z'),
    });
    older.update = async (mutator: (record: any) => void) => mutator(older);
    mockNodeFind.mockImplementation(async (id: string) =>
      id === 'node-older' ? older : newer,
    );
    mockEdgeCreate.mockImplementation((mutator: (record: any) => void) => {
      const record = makeEdgeRecord({relation: 'SUPERSEDES'});
      mutator(record);
      return record;
    });

    const result = await memoryGraphRepository.resolveContradiction(
      'node-older',
      'node-newer',
    );

    expect(result).toEqual({winnerId: 'node-newer', loserId: 'node-older'});
  });

  it('returns null and logs rather than throwing when a node cannot be found', async () => {
    mockNodeFind.mockRejectedValue(new Error('not found'));
    const result = await memoryGraphRepository.resolveContradiction('a', 'b');
    expect(result).toBeNull();
  });
});

describe('MemoryGraphRepository.recordEdgeAccess', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockWrite.mockImplementation((callback: () => Promise<any>) => callback());
  });

  it('increments access count and sets last accessed time', async () => {
    const edge = makeEdgeRecord({accessCount: 2, lastAccessedAt: undefined});
    edge.update = async (mutator: (record: any) => void) => mutator(edge);
    mockEdgeFind.mockResolvedValue(edge);

    await memoryGraphRepository.recordEdgeAccess('edge-1');

    expect(edge.accessCount).toBe(3);
    expect(edge.lastAccessedAt).toEqual(expect.any(Number));
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

describe('MemoryGraphRepository.observeNodes / observeEdges', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('observeNodes maps emitted records through toView() and defaults to active status', async () => {
    const record = makeNodeRecord({id: 'node-9', label: 'dogs'});
    mockNodeObserve.mockReturnValue(of([record]));

    const emissions: any[] = [];
    memoryGraphRepository.observeNodes().subscribe(views => {
      emissions.push(views);
    });

    expect(emissions).toHaveLength(1);
    expect(emissions[0]).toEqual([
      expect.objectContaining({id: 'node-9', label: 'dogs'}),
    ]);
    // Exactly one clause (the defaulted active-status filter), same as
    // listNodes when no explicit status is given.
    expect(mockNodeObserve.mock.calls[0]).toHaveLength(1);
  });

  it('observeNodes re-emits on every value the underlying query pushes', async () => {
    const subject = new Subject<any[]>();
    mockNodeObserve.mockReturnValue(subject.asObservable());

    const emissions: any[] = [];
    memoryGraphRepository
      .observeNodes()
      .subscribe(views => emissions.push(views));

    subject.next([makeNodeRecord({id: 'a'})]);
    subject.next([makeNodeRecord({id: 'a'}), makeNodeRecord({id: 'b'})]);

    expect(emissions).toHaveLength(2);
    expect(emissions[1].map((v: any) => v.id)).toEqual(['a', 'b']);
  });

  it('observeEdges maps emitted records through toView() and defaults to active status', async () => {
    const record = makeEdgeRecord({id: 'edge-9', relation: 'SUPPORTS'});
    mockEdgeObserve.mockReturnValue(of([record]));

    const emissions: any[] = [];
    memoryGraphRepository.observeEdges().subscribe(views => {
      emissions.push(views);
    });

    expect(emissions).toHaveLength(1);
    expect(emissions[0]).toEqual([
      expect.objectContaining({id: 'edge-9', relation: 'SUPPORTS'}),
    ]);
  });

  it('observeEdges honors an explicit relation filter', async () => {
    mockEdgeObserve.mockReturnValue(of([]));

    memoryGraphRepository
      .observeEdges({relation: 'CONTRADICTS'})
      .subscribe(() => {});

    // Two clauses: the defaulted active-status filter plus the relation
    // filter — versus one clause (status only) with no relation given.
    expect(mockEdgeObserve.mock.calls[0]).toHaveLength(2);
  });
});
