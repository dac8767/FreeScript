// @vitest-environment jsdom
/**
 * clamp — NaN safety (v7.88, security review D14).
 *
 * clamp feeds zoom, panel sizes and imported layout values. Math.max(lo, NaN)
 * is NaN, so before this an unguarded NaN passed straight through into layout
 * math and blanked the page. NaN must fall back to a safe in-range value while
 * ordinary and ±Infinity inputs still clamp to the bounds.
 */
import { describe, it, expect } from 'vitest';
import { clamp } from './viewState';

describe('clamp', () => {
  it('clamps ordinary values within the range', () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-3, 0, 10)).toBe(0);
    expect(clamp(42, 0, 10)).toBe(10);
  });

  it('returns the low bound for NaN instead of propagating it', () => {
    expect(clamp(NaN, 50, 300)).toBe(50);
    expect(Number.isNaN(clamp(NaN, 50, 300))).toBe(false);
  });

  it('still clamps ±Infinity to the bounds', () => {
    expect(clamp(Infinity, 50, 300)).toBe(300);
    expect(clamp(-Infinity, 50, 300)).toBe(50);
  });
});
