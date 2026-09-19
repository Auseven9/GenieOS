import {computeRetention, DEFAULT_HALF_LIFE_DAYS} from '../decay';

const NOW = new Date('2026-06-15T00:00:00Z');

function daysAgo(days: number): string {
  return new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
}

describe('computeRetention', () => {
  it('returns 1 for a pinned memory regardless of age', () => {
    expect(
      computeRetention({pinned: true, createdAt: daysAgo(9999)}, NOW),
    ).toBe(1);
  });

  it('returns ~1 for a memory created just now', () => {
    expect(computeRetention({createdAt: daysAgo(0)}, NOW)).toBeCloseTo(1, 5);
  });

  it('returns ~0.5 at exactly the baseline half-life with default salience', () => {
    const retention = computeRetention(
      {createdAt: daysAgo(DEFAULT_HALF_LIFE_DAYS), salience: 0.5},
      NOW,
    );
    expect(retention).toBeCloseTo(0.5, 5);
  });

  it('decays further the older the memory, monotonically', () => {
    const recent = computeRetention({createdAt: daysAgo(5)}, NOW);
    const older = computeRetention({createdAt: daysAgo(30)}, NOW);
    const oldest = computeRetention({createdAt: daysAgo(90)}, NOW);
    expect(recent).toBeGreaterThan(older);
    expect(older).toBeGreaterThan(oldest);
  });

  it('a higher-salience memory retains more strength than a lower-salience one at the same age', () => {
    const lowSalience = computeRetention(
      {createdAt: daysAgo(20), salience: 0},
      NOW,
    );
    const highSalience = computeRetention(
      {createdAt: daysAgo(20), salience: 1},
      NOW,
    );
    expect(highSalience).toBeGreaterThan(lowSalience);
  });

  it('defaults absent salience to the same curve as salience 0.5', () => {
    const withDefault = computeRetention({createdAt: daysAgo(20)}, NOW);
    const explicitHalf = computeRetention(
      {createdAt: daysAgo(20), salience: 0.5},
      NOW,
    );
    expect(withDefault).toBeCloseTo(explicitHalf, 10);
  });

  it('lastAccessedAt resets the decay clock past createdAt (the re-consolidation spike)', () => {
    const staleOnly = computeRetention({createdAt: daysAgo(60)}, NOW);
    const recentlyAccessed = computeRetention(
      {createdAt: daysAgo(60), lastAccessedAt: daysAgo(1)},
      NOW,
    );
    expect(recentlyAccessed).toBeGreaterThan(staleOnly);
    expect(recentlyAccessed).toBeCloseTo(
      computeRetention({createdAt: daysAgo(1)}, NOW),
      5,
    );
  });

  it('never goes negative or above 1', () => {
    const retention = computeRetention({createdAt: daysAgo(100000)}, NOW);
    expect(retention).toBeGreaterThanOrEqual(0);
    expect(retention).toBeLessThanOrEqual(1);
  });
});
