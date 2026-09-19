import {toMemoryInput, clamp} from '../validateMemoryInput';

describe('clamp', () => {
  it('clamps within, below, and above the range', () => {
    expect(clamp(0.5, 0, 1)).toBe(0.5);
    expect(clamp(-5, 0, 1)).toBe(0);
    expect(clamp(5, 0, 1)).toBe(1);
  });
});

describe('toMemoryInput', () => {
  it('returns null for missing or empty content', () => {
    expect(toMemoryInput({})).toBeNull();
    expect(toMemoryInput({content: '   '})).toBeNull();
    expect(toMemoryInput({content: 42})).toBeNull();
  });

  it('trims content and applies defaults', () => {
    const input = toMemoryInput({content: '  hello  '});
    expect(input).toEqual({
      kind: 'fact',
      content: 'hello',
      provenance: 'model_inferred',
      tags: [],
      pinned: false,
    });
  });

  it('falls back to "fact"/"model_inferred" for invalid kind/provenance', () => {
    const input = toMemoryInput({
      content: 'x',
      kind: 'nonsense',
      provenance: 'nonsense',
    });
    expect(input?.kind).toBe('fact');
    expect(input?.provenance).toBe('model_inferred');
  });

  it('defaults pinned to true only when provenance is user_stated', () => {
    expect(
      toMemoryInput({content: 'x', provenance: 'user_stated'})?.pinned,
    ).toBe(true);
    expect(
      toMemoryInput({content: 'x', provenance: 'model_inferred'})?.pinned,
    ).toBe(false);
    // Explicit override always wins.
    expect(
      toMemoryInput({content: 'x', provenance: 'user_stated', pinned: false})
        ?.pinned,
    ).toBe(false);
  });

  it('clamps confidence/valence/intensity and omits them when absent', () => {
    const clamped = toMemoryInput({
      content: 'x',
      confidence: 5,
      valence: -10,
      intensity: 2,
    });
    expect(clamped).toMatchObject({confidence: 1, valence: -1, intensity: 1});

    const bare = toMemoryInput({content: 'x'});
    expect(bare).not.toHaveProperty('confidence');
    expect(bare).not.toHaveProperty('valence');
    expect(bare).not.toHaveProperty('intensity');
  });

  it('filters non-string tags', () => {
    expect(
      toMemoryInput({content: 'x', tags: ['ok', 5, null, 'also-ok']})?.tags,
    ).toEqual(['ok', 'also-ok']);
  });

  it('downgrades a claimed user_stated to model_inferred when disallowUserStated is set', () => {
    const input = toMemoryInput(
      {content: 'x', provenance: 'user_stated'},
      {disallowUserStated: true},
    );
    expect(input?.provenance).toBe('model_inferred');
    // Downgrading provenance also flips the pinned default, since pinning
    // is itself keyed on provenance === 'user_stated'.
    expect(input?.pinned).toBe(false);
  });

  it('does not affect model_inferred or external_content when disallowUserStated is set', () => {
    expect(
      toMemoryInput(
        {content: 'x', provenance: 'model_inferred'},
        {disallowUserStated: true},
      )?.provenance,
    ).toBe('model_inferred');
    expect(
      toMemoryInput(
        {content: 'x', provenance: 'external_content'},
        {disallowUserStated: true},
      )?.provenance,
    ).toBe('external_content');
  });
});
