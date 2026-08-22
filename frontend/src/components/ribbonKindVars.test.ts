// @vitest-environment jsdom
//   ^ v7.76: resolving the knob defaults means importing designTokens, which
//     imports editorStore for its store-bound knobs — and the store reads
//     localStorage at module load. Same pragma, same reason, as
//     design/designTokens.test.ts. Nothing here renders.
/**
 * ribbonKindVars (v5.14 → v5.17) — the per-kind ribbon geometry.
 *
 * The invariant: at 100%/100% the two kinds' TOTAL heights (paddings
 * included since v5.17) are equal — that equality IS the alignment. And
 * contentH must cover the tallest kind so the bar grows instead of letting
 * padding push a section's title under the menu bar (Derek's v5.17 report).
 *
 * v7.76: the knobs are REQUIRED arguments now — ribbonKindVars carries no
 * defaults of its own, because the copies it used to carry had drifted from
 * the stylesheet's (see its header). So this file resolves them from
 * designTokens, exactly as Toolbar.tsx does, and derives the expected inner
 * heights from the same numbers. It used to hardcode `INNER_T = 72`, a
 * snapshot of the defaults as they stood in v5.14 — which is how a suite
 * comes to certify geometry the app stopped rendering three versions ago.
 */
import { describe, it, expect } from 'vitest';
import { ribbonKindVars } from './toolbarBuiltins';
import { designToken } from '../design/designTokens';

const D = (id: string) => designToken(id)!.def;
const KNOBS = {
  titleFont: D('ribTitleFont'),
  titleGap: D('ribTitleGap'),
  rowGapTitled: D('ribRowGapTitled'),
  rowGapUntitled: D('ribRowGapUntitled'),
  padTopTitled: D('ribPadTopTitled'),
  padBottomTitled: D('ribPadBottomTitled'),
  padTopUntitled: D('ribPadTopUntitled'),
  padBottomUntitled: D('ribPadBottomUntitled'),
};
const DEFAULTS = { rowH: 28, anyTitle: true, ...KNOBS };
const ROWS = 56;                                    // 2 × rowH
const BAND = KNOBS.titleFont + 1.5;
const INNER_T = BAND + KNOBS.titleGap + ROWS + KNOBS.rowGapTitled;
const INNER_U = ROWS + KNOBS.rowGapUntitled;
const PAD_T = KNOBS.padTopTitled + KNOBS.padBottomTitled;
const PAD_U = KNOBS.padTopUntitled + KNOBS.padBottomUntitled;

describe('ribbonKindVars', () => {
  it('auto-fill: untitled TOTAL equals titled TOTAL at default scales', () => {
    const { kTitled, kUntitled } = ribbonKindVars(DEFAULTS);
    // Paddings are part of the equality — the shipped defaults give the two
    // kinds different ones (PAD_U > PAD_T), so comparing inner heights alone
    // would now be comparing the wrong thing.
    expect(PAD_U + kUntitled * INNER_U).toBeCloseTo(PAD_T + kTitled * INNER_T, 6);
    expect(kTitled).toBe(1);
  });

  it('a bar with NO titles gets no auto-fill — both factors 1', () => {
    const { kTitled, kUntitled, contentH } = ribbonKindVars({ ...DEFAULTS, anyTitle: false });
    expect(kTitled).toBe(1);
    expect(kUntitled).toBe(1);
    expect(contentH).toBeCloseTo(PAD_U + INNER_U, 6);
  });

  it('the scale knobs multiply their kind and only their kind', () => {
    const fill = (PAD_T + INNER_T - PAD_U) / INNER_U;
    const r = ribbonKindVars({ ...DEFAULTS, scaleTitledPct: 150, scaleUntitledPct: 100 });
    expect(r.kTitled).toBe(1.5);
    expect(r.kUntitled).toBeCloseTo(fill, 6);
    const r2 = ribbonKindVars({ ...DEFAULTS, scaleTitledPct: 100, scaleUntitledPct: 50 });
    expect(r2.kUntitled).toBeCloseTo(0.5 * fill, 6);
  });

  it('contentH is the taller kind, so the bar grows with whichever is scaled up', () => {
    const base = ribbonKindVars(DEFAULTS);
    const up = ribbonKindVars({ ...DEFAULTS, scaleTitledPct: 200 });
    // Titled clearly dominates at 200%, so contentH is its whole total.
    expect(up.contentH).toBeCloseTo(PAD_T + 2 * INNER_T, 6);
    expect(up.contentH).toBeGreaterThan(base.contentH);
    // Both halved: whichever kind wins, the bar must shrink rather than keep
    // reserving the taller one's old height.
    const down = ribbonKindVars({ ...DEFAULTS, scaleTitledPct: 50, scaleUntitledPct: 50 });
    expect(down.contentH).toBeLessThan(base.contentH);
    expect(down.contentH).toBeGreaterThan(0);
  });

  it('the band follows the Design title vars, and the fill follows the band', () => {
    const r = ribbonKindVars({ ...DEFAULTS, titleFont: 12, titleGap: 4 });
    const innerT = 12 + 1.5 + 4 + ROWS + KNOBS.rowGapTitled;
    expect(r.kUntitled).toBeCloseTo((PAD_T + innerT - PAD_U) / INNER_U, 6);
  });

  it('per-kind row gaps still equalize the two totals at 100%', () => {
    const r = ribbonKindVars({ ...DEFAULTS, rowGapTitled: 6, rowGapUntitled: -4 });
    expect(PAD_U + r.kUntitled * (ROWS - 4))
      .toBeCloseTo(PAD_T + r.kTitled * (BAND + KNOBS.titleGap + ROWS + 6), 6);
  });

  /* v5.17, Derek: "increasing the section bottom padding can push the title
     behind the top bar. adjusting padding should never do this. the height
     of the bar should adjust instead." */
  it('padding grows contentH — the bar makes room instead of clipping', () => {
    const base = ribbonKindVars(DEFAULTS);
    const padded = ribbonKindVars({ ...DEFAULTS, padTopTitled: 4, padBottomTitled: 14 });
    // The bar grows by the INCREASE, not by the new padding — the titled kind
    // already shipped with PAD_T of its own.
    expect(padded.contentH).toBeCloseTo(base.contentH + (18 - PAD_T), 6);
  });

  it('padded kinds still level out at 100% — pads are part of the equality', () => {
    const r = ribbonKindVars({ ...DEFAULTS, padTopTitled: 4, padBottomTitled: 14, padTopUntitled: 2, padBottomUntitled: 2 });
    const titledTotal = 4 + 14 + r.kTitled * INNER_T;
    const untitledTotal = 2 + 2 + r.kUntitled * INNER_U;
    expect(untitledTotal).toBeCloseTo(titledTotal, 6);
  });

  it('a NEGATIVE title gap shrinks the titled total, and the fill follows down', () => {
    const r = ribbonKindVars({ ...DEFAULTS, titleGap: -6 });
    const innerT = BAND - 6 + ROWS + KNOBS.rowGapTitled;
    expect(r.kUntitled).toBeCloseTo((PAD_T + innerT - PAD_U) / INNER_U, 6);
    expect(r.kUntitled).toBeLessThan(1.1);
  });

  it('the fill is floored — extreme negatives cannot invert the bar', () => {
    const r = ribbonKindVars({ ...DEFAULTS, rowGapTitled: -14, titleGap: -10, padTopUntitled: 0 });
    expect(r.kUntitled).toBeGreaterThanOrEqual(0.25);
  });
});
