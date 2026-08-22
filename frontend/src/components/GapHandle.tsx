/**
 * GapHandle (v2.29) — the faint drag grip on the chrome bars.
 *
 * One sits at the right end of the menu bar, one at the right end of the
 * toolbar, one to the LEFT of the Big Button section. Invisible until the
 * bar is hovered (CSS).
 *
 * v2.76, Derek: the grip is TWO-AXIS. Dragging horizontally adjusts that
 * bar's item spacing (flex gap — chromeGapPx); dragging vertically sizes the
 * bar itself: the menu bar and toolbar get taller/shorter (custom height),
 * the Big Buttons grow/shrink inside the chrome they span (bigBtnInsetPx).
 * The line doubles as a very small scrollbar — a dot indicator rides it,
 * showing where the current vertical size sits in its range.
 */
import React, { useRef } from 'react';
import { useEditorStore } from '../stores/editorStore';
import { chromePx, chromeMin, chromeMax } from './chromeSizes';

/** v2.61: which way a mouse move grows the gap depends on which side of the
 *  items the grip rides. All three grips sit RIGHT of left-anchored items —
 *  spacing grows to the right, drag right = wider. (Until v2.94 the Big
 *  Button grip sat LEFT of a right-anchored section and ran inverted; Row 2
 *  is left-anchored like the others now.) Getting this wrong makes the grip
 *  fight the mouse. Exported for the test. */
export const GAP_DRAG_DIR: Record<'menu' | 'toolbar' | 'bigbtn', 1 | -1> = {
  menu: 1,
  toolbar: 1,
  bigbtn: 1,
};

export const BIGBTN_INSET_MAX = 40;

/** v2.76: where the size indicator sits on the grip, 0 (smallest) → 1
 *  (largest). Exported for the test. */
export function sizeIndicatorT(bar: 'menu' | 'toolbar' | 'bigbtn', px: number): number {
  if (bar === 'bigbtn') {
    // Smaller inset = bigger buttons, so the scale runs inverted.
    return Math.min(1, Math.max(0, 1 - px / BIGBTN_INSET_MAX));
  }
  const surface = bar === 'menu' ? 'menu' : 'toolbar';
  const min = chromeMin(surface);
  const max = chromeMax(surface);
  return Math.min(1, Math.max(0, (px - min) / (max - min)));
}

const GapHandle: React.FC<{ bar: 'menu' | 'toolbar' | 'bigbtn' }> = ({ bar }) => {
  const setChromeGap = useEditorStore((s) => s.setChromeGap);
  const locked = useEditorStore((s) => s.uiResizeLocked);
  // Current vertical size, for the indicator dot.
  const vSize = useEditorStore((s) => {
    if (bar === 'bigbtn') return s.bigBtnInsetPx;
    if (bar === 'menu') {
      const m = s.menuMode ?? 'compact';
      return chromePx('menu', m === 'hidden' ? 'compact' : m, s.chromeCustomPx.menu);
    }
    const m = s.toolbarMode ?? 'compact';
    return chromePx('toolbar', m === 'hidden' ? 'compact' : m, s.chromeCustomPx.toolbar);
  });
  // v2.88, Derek: one axis at a time. The first direction to travel ≥3px
  // claims the whole drag — pulling sideways adjusts spacing and leaves the
  // bar's height untouched, and vice versa.
  const drag = useRef<{ x: number; y: number; gap: number; gaps: number; v: number; axis: 'h' | 'v' | null } | null>(null);

  // v2.55: the sizing lock hides every grip — no dead controls.
  if (locked) return null;

  // v2.91, Derek: the Big Buttons size themselves to the chrome they span —
  // their grip adjusts SPACING only, no vertical axis, no indicator dot.
  const twoAxis = bar !== 'bigbtn';

  const applyVertical = (dy: number, start: number) => {
    const st = useEditorStore.getState();
    if (bar === 'bigbtn') {
      // Drag down = bigger buttons = smaller inset.
      st.setBigBtnInset(start - dy);
      return;
    }
    const surface = bar === 'menu' ? 'menu' : 'toolbar';
    const px = Math.min(chromeMax(surface), Math.max(chromeMin(surface), Math.round(start + dy)));
    // Height dragging implies custom mode — same as the edge drag (v2.29).
    if (bar === 'menu' && st.menuMode !== 'custom') st.setMenuMode('custom');
    if (bar === 'toolbar' && st.toolbarMode !== 'custom') st.setToolbarMode('custom');
    st.setChromeCustomPx(surface, px);
  };

  return (
    <span
      className="fs-gap-handle"
      title={twoAxis ? 'Drag horizontally: change item spacing. Drag vertically: change bar size.' : 'Drag to adjust the spacing between items'}
      onPointerDown={(e) => {
        e.preventDefault(); e.stopPropagation();
        const el = e.currentTarget as HTMLElement;
        el.setPointerCapture?.(e.pointerId);
        // v2.40, Derek: the grip must track the mouse 1:1. Each pixel of
        // gap moves the grip by ONE PIXEL PER GAP between it and the bar's
        // edge, so divide the mouse delta by how many gaps it rides on.
        let gaps = 1;
        const parent = el.parentElement;
        if (parent) {
          const kids = Array.from(parent.children);
          const idx = kids.indexOf(el);
          gaps = Math.max(1, Math.max(idx, kids.length - 1 - idx));
        }
        drag.current = { x: e.clientX, y: e.clientY, gap: useEditorStore.getState().chromeGapPx[bar], gaps, v: vSize, axis: null };
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d) return;
        const dx = e.clientX - d.x;
        const dy = e.clientY - d.y;
        if (!d.axis) {
          if (!twoAxis) d.axis = 'h';                      // v2.91: spacing only
          else if (Math.abs(dx) < 3 && Math.abs(dy) < 3) return;
          else d.axis = Math.abs(dx) >= Math.abs(dy) ? 'h' : 'v';
        }
        if (d.axis === 'h') setChromeGap(bar, d.gap + (GAP_DRAG_DIR[bar] * dx) / d.gaps);
        else applyVertical(dy, d.v);
      }}
      onPointerUp={() => { drag.current = null; }}
    >
      <span className="fs-gap-handle-bar" />
      {/* v2.76: the indicator — where the bar's vertical size sits in range */}
      {twoAxis && <span className="fs-gap-handle-dot" style={{ top: `${8 + sizeIndicatorT(bar, vSize) * 84}%` }} />}
    </span>
  );
};

export default GapHandle;
