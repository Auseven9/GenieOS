import {
  toGraphNodeCandidate,
  toGraphEdgeCandidate,
} from '../validateMemoryGraphInput';

describe('toGraphNodeCandidate', () => {
  it('returns null for missing or empty label/content', () => {
    expect(toGraphNodeCandidate({})).toBeNull();
    expect(toGraphNodeCandidate({label: 'cats'})).toBeNull();
    expect(toGraphNodeCandidate({content: 'the user has two cats'})).toBeNull();
    expect(
      toGraphNodeCandidate({label: '  ', content: 'the user has two cats'}),
    ).toBeNull();
  });

  it('trims label/content and applies defaults', () => {
    const node = toGraphNodeCandidate({
      label: '  cats  ',
      content: '  the user has two cats  ',
    });
    expect(node).toEqual({
      label: 'cats',
      content: 'the user has two cats',
      kind: 'concept',
      memoryType: 'semantic',
      confidence: 0.5,
      provenance: 'model_inferred',
    });
  });

  it('falls back to "concept"/"semantic"/"model_inferred" for invalid values', () => {
    const node = toGraphNodeCandidate({
      label: 'cats',
      content: 'x',
      kind: 'nonsense',
      memory_type: 'nonsense',
      provenance: 'nonsense',
    });
    expect(node?.kind).toBe('concept');
    expect(node?.memoryType).toBe('semantic');
    expect(node?.provenance).toBe('model_inferred');
  });

  it('accepts a valid kind and episodic memory_type', () => {
    const node = toGraphNodeCandidate({
      label: 'cats',
      content: 'x',
      kind: 'topic',
      memory_type: 'episodic',
    });
    expect(node?.kind).toBe('topic');
    expect(node?.memoryType).toBe('episodic');
  });

  it('clamps confidence/valence/salience and omits valence/salience when absent', () => {
    const clamped = toGraphNodeCandidate({
      label: 'cats',
      content: 'x',
      confidence: 5,
      valence: -10,
      salience: 2,
    });
    expect(clamped).toMatchObject({confidence: 1, valence: -1, salience: 1});

    const bare = toGraphNodeCandidate({label: 'cats', content: 'x'});
    expect(bare).not.toHaveProperty('valence');
    expect(bare).not.toHaveProperty('salience');
  });

  it('downgrades a claimed user_stated to model_inferred when disallowUserStated is set', () => {
    const node = toGraphNodeCandidate(
      {label: 'cats', content: 'x', provenance: 'user_stated'},
      {disallowUserStated: true},
    );
    expect(node?.provenance).toBe('model_inferred');
  });
});

describe('toGraphEdgeCandidate', () => {
  it('returns null for missing labels or an unrecognized relation', () => {
    expect(toGraphEdgeCandidate({})).toBeNull();
    expect(
      toGraphEdgeCandidate({source_label: 'a', target_label: 'b'}),
    ).toBeNull();
    expect(
      toGraphEdgeCandidate({
        source_label: 'a',
        target_label: 'b',
        relation_type: 'NONSENSE',
      }),
    ).toBeNull();
  });

  it('rejects a self-loop, case-insensitively', () => {
    expect(
      toGraphEdgeCandidate({
        source_label: 'Cats',
        target_label: 'cats',
        relation_type: 'MENTIONS',
      }),
    ).toBeNull();
  });

  it('trims labels and applies weight/confidence defaults', () => {
    const edge = toGraphEdgeCandidate({
      source_label: '  cats  ',
      target_label: '  dark mode  ',
      relation_type: 'RELATES_TO',
    });
    expect(edge).toEqual({
      sourceLabel: 'cats',
      targetLabel: 'dark mode',
      relation: 'RELATES_TO',
      weight: 0.5,
      confidence: 0.5,
    });
  });

  it('clamps weight/confidence', () => {
    const edge = toGraphEdgeCandidate({
      source_label: 'a',
      target_label: 'b',
      relation_type: 'CONTRADICTS',
      weight: 5,
      confidence: -5,
    });
    expect(edge).toMatchObject({weight: 1, confidence: 0});
  });
});
