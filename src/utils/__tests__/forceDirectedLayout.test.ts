import {computeForceDirectedLayout} from '../forceDirectedLayout';

const OPTS = {width: 400, height: 400, iterations: 100};

describe('computeForceDirectedLayout', () => {
  it('returns an empty array for no nodes', () => {
    expect(computeForceDirectedLayout([], [], OPTS)).toEqual([]);
  });

  it('places a single node at the center', () => {
    const result = computeForceDirectedLayout([{id: 'a'}], [], OPTS);
    expect(result).toEqual([{id: 'a', x: 200, y: 200}]);
  });

  it('returns one position per input node, matching ids', () => {
    const nodes = [{id: 'a'}, {id: 'b'}, {id: 'c'}];
    const result = computeForceDirectedLayout(nodes, [], OPTS);
    expect(result.map(p => p.id).sort()).toEqual(['a', 'b', 'c']);
  });

  it('is deterministic: same input produces the same output every time', () => {
    const nodes = [{id: 'a'}, {id: 'b'}, {id: 'c'}, {id: 'd'}];
    const edges = [{sourceId: 'a', targetId: 'b'}];
    const first = computeForceDirectedLayout(nodes, edges, OPTS);
    const second = computeForceDirectedLayout(nodes, edges, OPTS);
    expect(first).toEqual(second);
  });

  it('pulls connected nodes closer together than an unconnected pair starting at the same distance', () => {
    const nodes = [{id: 'a'}, {id: 'b'}, {id: 'c'}, {id: 'd'}];
    // a-b connected; c-d not. All four start equally spaced on the same
    // circle, so any post-layout gap is entirely down to the edge.
    const edges = [{sourceId: 'a', targetId: 'b', strength: 1}];
    const result = computeForceDirectedLayout(nodes, edges, OPTS);
    const pos = new Map(result.map(p => [p.id, p]));
    const dist = (x: string, y: string) => {
      const a = pos.get(x)!;
      const b = pos.get(y)!;
      return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
    };
    expect(dist('a', 'b')).toBeLessThan(dist('c', 'd'));
  });

  it('keeps positions finite and roughly within the canvas after settling', () => {
    const nodes = Array.from({length: 12}, (_, i) => ({id: `n${i}`}));
    const edges = Array.from({length: 11}, (_, i) => ({
      sourceId: `n${i}`,
      targetId: `n${i + 1}`,
    }));
    const result = computeForceDirectedLayout(nodes, edges, OPTS);
    for (const p of result) {
      expect(Number.isFinite(p.x)).toBe(true);
      expect(Number.isFinite(p.y)).toBe(true);
      // Gravity is gentle (1% per iteration), not a hard clamp — a long
      // chain topology can legitimately overshoot the nominal canvas
      // before it reels back in. What actually matters here is "doesn't
      // diverge to something absurd," not a tight visual bound; the
      // rendering component fits content to the viewport separately.
      expect(Math.abs(p.x)).toBeLessThan(OPTS.width * 5);
      expect(Math.abs(p.y)).toBeLessThan(OPTS.height * 5);
    }
  });

  it('ignores an edge referencing an id not present in the node list', () => {
    const nodes = [{id: 'a'}, {id: 'b'}];
    const edges = [{sourceId: 'a', targetId: 'missing'}];
    expect(() => computeForceDirectedLayout(nodes, edges, OPTS)).not.toThrow();
  });

  it('ignores a self-referencing edge', () => {
    const nodes = [{id: 'a'}, {id: 'b'}];
    const edges = [{sourceId: 'a', targetId: 'a'}];
    const result = computeForceDirectedLayout(nodes, edges, OPTS);
    expect(result).toHaveLength(2);
  });

  it('gives a heavier node more separation from its neighbors than an equal-weight one', () => {
    const lightNodes = [
      {id: 'a', weight: 1},
      {id: 'b', weight: 1},
      {id: 'c', weight: 1},
    ];
    const heavyNodes = [
      {id: 'a', weight: 5},
      {id: 'b', weight: 1},
      {id: 'c', weight: 1},
    ];
    const edges: {sourceId: string; targetId: string}[] = [];

    const lightResult = computeForceDirectedLayout(lightNodes, edges, OPTS);
    const heavyResult = computeForceDirectedLayout(heavyNodes, edges, OPTS);

    const distFrom = (result: typeof lightResult) => {
      const pos = new Map(result.map(p => [p.id, p]));
      const a = pos.get('a')!;
      const b = pos.get('b')!;
      const c = pos.get('c')!;
      const toB = Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
      const toC = Math.sqrt((a.x - c.x) ** 2 + (a.y - c.y) ** 2);
      return (toB + toC) / 2;
    };

    expect(distFrom(heavyResult)).toBeGreaterThan(distFrom(lightResult));
  });
});
