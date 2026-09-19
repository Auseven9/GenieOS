import {
  valenceToColor,
  salienceToRadius,
  confidenceToOpacity,
} from '../memoryNodeVisuals';

describe('valenceToColor', () => {
  it('maps 0 and undefined to the same neutral gray', () => {
    expect(valenceToColor(0)).toBe(valenceToColor(undefined));
  });

  it('maps -1 to the fully negative (red) end of the scale', () => {
    expect(valenceToColor(-1)).toBe('#d32f2f');
  });

  it('maps 1 to the fully positive (green) end of the scale', () => {
    expect(valenceToColor(1)).toBe('#388e3c');
  });

  it('clamps out-of-range values rather than producing an invalid color', () => {
    expect(valenceToColor(5)).toBe(valenceToColor(1));
    expect(valenceToColor(-5)).toBe(valenceToColor(-1));
  });

  it('returns a well-formed hex color for an intermediate value', () => {
    expect(valenceToColor(0.5)).toMatch(/^#[0-9a-f]{6}$/);
  });
});

describe('salienceToRadius', () => {
  it('returns a larger radius for higher salience', () => {
    expect(salienceToRadius(1)).toBeGreaterThan(salienceToRadius(0));
  });

  it('treats an unscored node as a middling size, not the smallest or largest', () => {
    const unscored = salienceToRadius(undefined);
    expect(unscored).toBeGreaterThan(salienceToRadius(0));
    expect(unscored).toBeLessThan(salienceToRadius(1));
  });

  it('clamps out-of-range values', () => {
    expect(salienceToRadius(5)).toBe(salienceToRadius(1));
    expect(salienceToRadius(-5)).toBe(salienceToRadius(0));
  });
});

describe('confidenceToOpacity', () => {
  it('never drops to fully transparent, even at zero confidence', () => {
    expect(confidenceToOpacity(0)).toBeGreaterThan(0);
  });

  it('returns full opacity at confidence 1', () => {
    expect(confidenceToOpacity(1)).toBe(1);
  });

  it('is monotonically increasing with confidence', () => {
    expect(confidenceToOpacity(0.8)).toBeGreaterThan(confidenceToOpacity(0.2));
  });

  it('clamps out-of-range values', () => {
    expect(confidenceToOpacity(5)).toBe(confidenceToOpacity(1));
    expect(confidenceToOpacity(-5)).toBe(confidenceToOpacity(0));
  });
});
