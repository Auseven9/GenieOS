export interface LayoutNode {
  id: string;
  /** Relative size hint (e.g. derived from salience) — a heavier node gets
   *  more personal space during the repulsion pass, so visually larger
   *  nodes don't end up crowded or overlapping their labels. */
  weight?: number;
}

export interface LayoutEdge {
  sourceId: string;
  targetId: string;
  /** 0-1 edge strength — a stronger edge pulls its endpoints closer. */
  strength?: number;
}

export interface LayoutPosition {
  id: string;
  x: number;
  y: number;
}

export interface LayoutOptions {
  width: number;
  height: number;
  iterations?: number;
}

const DEFAULT_ITERATIONS = 200;

/**
 * A compact Fruchterman-Reingold-style force-directed layout: every pair of
 * nodes repels, edges pull their two endpoints together, and a cooling
 * schedule settles the simulation into a stable arrangement. No d3-force
 * (or any layout library) is a dependency of this project, so this is a
 * small, self-contained implementation scoped to what the Memory Explorer
 * graph needs — not a general-purpose physics engine.
 *
 * Deterministic: nodes start evenly spaced on a circle in input order
 * (never randomly placed), so the same graph lays out the same way on
 * every run — important both for tests and for a layout that doesn't
 * visibly "jump" between renders of an otherwise-unchanged graph.
 */
export function computeForceDirectedLayout(
  nodes: LayoutNode[],
  edges: LayoutEdge[],
  options: LayoutOptions,
): LayoutPosition[] {
  const {width, height, iterations = DEFAULT_ITERATIONS} = options;
  if (nodes.length === 0) {
    return [];
  }
  const centerX = width / 2;
  const centerY = height / 2;
  if (nodes.length === 1) {
    return [{id: nodes[0].id, x: centerX, y: centerY}];
  }

  const area = width * height;
  const k = Math.sqrt(area / nodes.length);
  const radius = Math.min(width, height) / 2.5;

  const weightOf = new Map(nodes.map(n => [n.id, n.weight ?? 1]));
  const positions = new Map<string, {x: number; y: number}>();
  nodes.forEach((node, i) => {
    const angle = (2 * Math.PI * i) / nodes.length;
    positions.set(node.id, {
      x: centerX + radius * Math.cos(angle),
      y: centerY + radius * Math.sin(angle),
    });
  });

  const validEdges = edges.filter(
    e =>
      e.sourceId !== e.targetId &&
      positions.has(e.sourceId) &&
      positions.has(e.targetId),
  );

  let temperature = Math.min(width, height) / 10;
  const cooling = temperature / iterations;

  for (let iter = 0; iter < iterations; iter++) {
    const displacements = new Map<string, {x: number; y: number}>();
    nodes.forEach(n => displacements.set(n.id, {x: 0, y: 0}));

    // Repulsion between every pair — O(n^2), fine at the node counts a
    // phone screen can usefully show (see the Memory Explorer's own
    // render cap, since nothing upstream limits how many nodes exist).
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i].id;
        const b = nodes[j].id;
        const pa = positions.get(a)!;
        const pb = positions.get(b)!;
        const dx = pa.x - pb.x;
        const dy = pa.y - pb.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 0.01;
        const avgWeight = ((weightOf.get(a) ?? 1) + (weightOf.get(b) ?? 1)) / 2;
        const force = (k * k * avgWeight) / dist;
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        const da = displacements.get(a)!;
        const db = displacements.get(b)!;
        da.x += fx;
        da.y += fy;
        db.x -= fx;
        db.y -= fy;
      }
    }

    // Attraction along edges pulls connected nodes toward each other.
    for (const edge of validEdges) {
      const pa = positions.get(edge.sourceId)!;
      const pb = positions.get(edge.targetId)!;
      const dx = pa.x - pb.x;
      const dy = pa.y - pb.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 0.01;
      const strength = edge.strength ?? 0.5;
      const force = ((dist * dist) / k) * (0.3 + strength * 0.7);
      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;
      const da = displacements.get(edge.sourceId)!;
      const db = displacements.get(edge.targetId)!;
      da.x -= fx;
      da.y -= fy;
      db.x += fx;
      db.y += fy;
    }

    // Apply displacement, capped by the current temperature, then nudge
    // gently toward center so the whole graph can't drift off-canvas.
    for (const node of nodes) {
      const pos = positions.get(node.id)!;
      const disp = displacements.get(node.id)!;
      const dist = Math.sqrt(disp.x * disp.x + disp.y * disp.y) || 0.01;
      const capped = Math.min(dist, temperature);
      pos.x += (disp.x / dist) * capped;
      pos.y += (disp.y / dist) * capped;
      pos.x += (centerX - pos.x) * 0.01;
      pos.y += (centerY - pos.y) * 0.01;
    }

    temperature -= cooling;
  }

  return nodes.map(n => {
    const p = positions.get(n.id)!;
    return {id: n.id, x: p.x, y: p.y};
  });
}
