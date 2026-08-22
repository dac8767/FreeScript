/**
 * OutlineBar (v1.75; rebuilt v2.11) — a PAGE TIMELINE, Premiere-style:
 * the x-axis is script pages instead of time.
 *
 * Rows, top to bottom:
 *   Acts   — the Outline tool's COLUMNS as sequential blocks, each spanning
 *            its page budget (targetPages: 30/45/40 → a 115-page ruler).
 *            Drag a block's right edge to change the budget; right-click to
 *            type it (also settable in the Outline window's column header).
 *   Beats  — the Outline tool's beats, placed at a page + span. Drag to
 *            move, drag the right edge to resize, right-click to type the
 *            page target.
 *   Ruler  — page increments, 1 to the total the acts define.
 *   Script — what's ACTUALLY written: one block per scene heading, sized by
 *            its real page length (computeSceneLengths). Click to jump.
 *
 * The side holds a zoom (pixels per page; Fit stretches the ruler to the
 * visible width) and the tracks scroll horizontally when they outgrow the
 * screen. ONE SOURCE OF TRUTH: blocks ARE the Outline tool's columns and
 * beats — no copies. Closing lives in View > Outline Bar (no × here, v2.11).
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Editor } from '@tiptap/react';
import { FaFileExport, FaStream, FaLayerGroup, FaDotCircle, FaRegCircle, FaArrowsAltH } from 'react-icons/fa';
import { useEditorStore, toolConfigFor, DEFAULT_OUTLINE_BAR_ROWS, type BeatInfo, type BeatColumn } from '../stores/editorStore';
import { dockWidthFor, toolDef } from './ToolDock';
import { computeSceneLengths, computePageBlocks, posAfterScriptPageIn } from '../editor/pagination';
import AddMenu from './AddMenu';
import { showToast } from './Toast';
import { sendSectionsToScript, clearLegacySectionLines } from '../utils/outlineScriptSync';
import { confirmDialog } from './ConfirmDialog';
import { BEAT_COLORS } from './BeatBoard';

const SNAP = 1;                   // v2.16, Derek: whole pages only — no decimals
const DEFAULT_SPAN = 1;           // beats default to one page
const SCENE_MIN = 0.125;          // the script row stays TRUE to real lengths
/** A section with no page budget yet still needs a visible block. v2.20:
 *  1, matching what the Outline window's field shows for it — new sections
 *  are born with targetPages: 1, so this only covers pre-v2.20 data. */
export const DEFAULT_COLUMN_PAGES = 1;

/** Clamp + snap a page position for a beat. Exported for the test. */
export function snapPage(page: number, span: number, totalPages: number): number {
  const snapped = Math.round(page / SNAP) * SNAP;
  return Math.min(Math.max(1, snapped), Math.max(1, totalPages - span + 1));
}

/** v2.27: the navigator thumb (Premiere-style). One bar both scrolls and
 *  rescales: the thumb spans the visible fraction of the track; its left
 *  edge tracks scrollLeft. Exported for the test. */
export function navThumbGeometry(scrollX: number, viewW: number, trackW: number, minWidthPx = 24) {
  const navW = Math.max(1, viewW);
  const frac = trackW > 0 ? Math.min(1, viewW / trackW) : 1;
  const width = Math.max(Math.min(minWidthPx, navW), navW * frac);
  const maxThumbL = navW - width;
  const maxScroll = Math.max(0, trackW - viewW);
  const left = maxScroll > 0 ? (scrollX / maxScroll) * maxThumbL : 0;
  return { left, width, maxThumbL, maxScroll };
}

/** Left/width percentages for a marker. Exported for the test. */
export function markerGeometry(page: number, span: number, totalPages: number) {
  const total = Math.max(1, totalPages);
  return {
    leftPct: ((page - 1) / total) * 100,
    widthPct: (Math.max(SNAP, span) / total) * 100,
  };
}

/** v2.11: the acts row — columns in board order, packed from page 1, each
 *  spanning its budget. Exported for the test. */
export function columnRanges(cols: BeatColumn[]): Array<{ id: string; title: string; start: number; pages: number }> {
  const sorted = [...cols].sort((a, b) => a.position - b.position);
  let start = 1;
  return sorted.map((c) => {
    const pages = Math.max(1, Math.round(c.targetPages || DEFAULT_COLUMN_PAGES));
    const r = { id: c.id, title: c.title, start, pages };
    start += pages;
    return r;
  });
}

/** v2.30, Derek: the bar shows EVERY beat automatically. Each section's
 *  beats pack from its start page in board order, each spanning its page
 *  estimate; beats whose section isn't on the bar's tab pack after the last
 *  section. v2.60: a beat CAN be hand-placed — `offset` pins it that many
 *  whole pages past its section's start (clamped inside the section) instead
 *  of packing. Board order stays the truth: if the section's pinned pages
 *  contradict it (a reorder in the Outline window), the pins are ignored and
 *  the section packs as before. Exported for the test. */
export interface BarBeatItem { id: string; columnId: string; position: number; span: number; offset?: number }
export function layoutBarBeats(
  ranges: Array<{ id: string; start: number; pages: number }>,
  items: BarBeatItem[],
): Map<string, { page: number; span: number }> {
  const out = new Map<string, { page: number; span: number }>();
  const byCol = new Map<string, BarBeatItem[]>();
  for (const it of items) {
    if (!byCol.has(it.columnId)) byCol.set(it.columnId, []);
    byCol.get(it.columnId)!.push(it);
  }
  for (const r of ranges) {
    const beats = (byCol.get(r.id) ?? []).sort((a, b) => a.position - b.position);
    const pinned = (it: BarBeatItem) =>
      Math.min(r.start + Math.max(0, Math.round(it.offset!)), r.start + Math.max(1, r.pages) - 1);
    // Pins that run backwards against board order are stale — drop them all.
    let prev = r.start;
    let stale = false;
    for (const it of beats) {
      if (it.offset == null) continue;
      const page = pinned(it);
      if (page < prev) { stale = true; break; }
      prev = page;
    }
    let cursor = r.start;  // pack position: past the end of everything placed
    let floor = r.start;   // a beat never renders left of the one before it
    for (const it of beats) {
      const page = !stale && it.offset != null ? Math.max(floor, pinned(it)) : cursor;
      out.set(it.id, { page, span: it.span });
      floor = page;
      cursor = Math.max(cursor, page + it.span);
    }
  }
  let orphanCursor = ranges.reduce((m, r) => Math.max(m, r.start + r.pages), 1);
  for (const it of [...items].sort((a, b) => a.position - b.position)) {
    if (out.has(it.id)) continue;
    out.set(it.id, { page: orphanCursor, span: it.span });
    orphanCursor += it.span;
  }
  return out;
}

/** v2.60, Derek: a dropped beat KEEPS the page it was dropped on — no snap
 *  back to the section's start. The Outline window is only touched when the
 *  drop changes something it shows: the beat's section, or its order among
 *  that section's beats (spans update live during a resize drag already).
 *  The plan: which section the drop lands in, the beat's index there,
 *  whether that differs from today (→ commit to the board), and the pins to
 *  write — the dragged beat at its dropped page, plus every other beat in
 *  the affected section(s) frozen where it already renders, so pinning one
 *  beat never shuffles its neighbors. Exported for the test. */
export function planBeatDrop(
  ranges: Array<{ id: string; start: number; pages: number }>,
  items: BarBeatItem[],
  layout: Map<string, { page: number; span: number }>,
  dragId: string,
  dropPage: number,
  span: number,
): { sectionId: string; index: number; boardChanged: boolean; offsets: Record<string, number> } | null {
  if (ranges.length === 0) return null;
  const mid = dropPage + span / 2;
  const act = ranges.find((a) => mid >= a.start && mid < a.start + a.pages)
    ?? (mid < ranges[0].start ? ranges[0] : ranges[ranges.length - 1]);
  const dragged = items.find((it) => it.id === dragId);
  const sameSection = dragged?.columnId === act.id;
  // New index: the section's other beats laid out left of the drop.
  // Old index: the same beats that board order puts before the dragged one.
  let index = 0;
  let oldIndex = 0;
  for (const it of items) {
    if (it.id === dragId || it.columnId !== act.id) continue;
    const l = layout.get(it.id);
    if (l && l.page < dropPage) index++;
    if (sameSection && dragged && it.position < dragged.position) oldIndex++;
  }
  const boardChanged = !sameSection || index !== oldIndex;
  const offsets: Record<string, number> = {};
  const freeze = (sectionId: string) => {
    const r = ranges.find((a) => a.id === sectionId);
    if (!r) return;
    for (const it of items) {
      if (it.id === dragId || it.columnId !== sectionId) continue;
      const l = layout.get(it.id);
      if (l) offsets[it.id] = Math.max(0, Math.round(l.page - r.start));
    }
  };
  freeze(act.id);
  if (dragged && !sameSection) freeze(dragged.columnId);
  offsets[dragId] = Math.min(
    Math.max(0, Math.round(dropPage - act.start)),
    Math.max(0, act.pages - 1),
  );
  return { sectionId: act.id, index, boardChanged, offsets };
}

interface SceneEntry { text: string; pos: number; start: number; pages: number }

function collectScenes(editor: Editor | null): Array<{ text: string; pos: number }> {
  if (!editor || editor.isDestroyed) return [];
  const scenes: Array<{ text: string; pos: number }> = [];
  editor.state.doc.forEach((node, pos) => {
    if (node.type.name === 'sceneHeading' && node.textContent.trim()) {
      scenes.push({ text: node.textContent.trim(), pos });
    }
  });
  return scenes;
}

/** v2.31: the right-click menu — name, pages and (for beats) color in one
 *  portalled popover, positioned by top/left only (never bottom). */
interface PagesPop { kind: 'column' | 'beat'; id: string; x: number; y: number; value: number; name: string }

export default function OutlineBar({ editor }: { editor: Editor | null }) {
  const beats = useEditorStore((s) => s.beats);
  const beatColumns = useEditorStore((s) => s.beatColumns);
  const updateBeat = useEditorStore((s) => s.updateBeat);
  const addBeat = useEditorStore((s) => s.addBeat);
  // v2.30: the bar shows the tab picked as "active" on the Outline window —
  // edits made here route to THAT tab, which may not be the one being viewed.
  const viewedTab = useEditorStore((s) => s.viewedOutlineTab);
  const barTab = useEditorStore((s) => s.outlineBarTab);
  const outlineTabs = useEditorStore((s) => s.outlineTabs);
  const outlineStash = useEditorStore((s) => s.outlineStash);
  const barUpdateColumn = useEditorStore((s) => s.barUpdateColumn);
  const barAddColumn = useEditorStore((s) => s.barAddColumn);
  const barAssignBeat = useEditorStore((s) => s.barAssignBeat);
  const barSetBeatOffsets = useEditorStore((s) => s.barSetBeatOffsets);
  const barSetBeatSpan = useEditorStore((s) => s.barSetBeatSpan);
  const pageCount = useEditorStore((s) => s.pageCount);
  const pageLayout = useEditorStore((s) => s.pageLayout);
  const zoom = useEditorStore((s) => s.outlineBarZoom);
  const setZoom = useEditorStore((s) => s.setOutlineBarZoom);
  // v2.31: row height is set by dragging the bar's bottom edge (the strip
  // lives in ScreenplayEditor's top chrome) — the bar just renders it.
  const rowScale = useEditorStore((s) => s.outlineBarRowScale);
  // v3.53, Derek: the Outline Bar is no longer customizable — it always shows
  // the four default rows (Page Ruler / Sections / Beats / Scenes). The labels
  // toggle stays (it's a plain view preference, not a layout edit).
  const barRows = DEFAULT_OUTLINE_BAR_ROWS;
  const showLabels = useEditorStore((s) => s.outlineBarLabels);

  const scrollRef = useRef<HTMLDivElement>(null);
  const [viewW, setViewW] = useState(0);
  const [scrollX, setScrollX] = useState(0);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    setViewW(el.clientWidth);
    if (typeof ResizeObserver === 'undefined') return;   // jsdom
    const ro = new ResizeObserver(() => setViewW(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /* ── the page domain ── */
  const barIsViewed = barTab === viewedTab;
  const barColumns = barIsViewed ? beatColumns : (outlineStash[barTab]?.columns ?? []);
  const barSlots = barIsViewed ? null : (outlineStash[barTab]?.beatSlots ?? {});
  const acts = useMemo(() => columnRanges(barColumns), [barColumns]);
  const actsTotal = acts.reduce((sum, a) => sum + a.pages, 0);
  // v2.30: EVERY beat renders, derived from its section + board order + span.
  const items: BarBeatItem[] = useMemo(() => beats.map((b) => {
    // v6.59: page estimates are per-tab too, so they come off the slot as
    // well — an older save has none, and falls back to the shared estimate
    // every tab used to read.
    const slot: { columnId: string; position: number; barOffset?: number; span?: number } = barSlots
      ? (barSlots[b.id] ?? { columnId: '', position: Number.MAX_SAFE_INTEGER })
      : { columnId: b.columnId, position: b.position, barOffset: b.barOffset, span: b.outlineSpan };
    const span = slot.span ?? b.outlineSpan ?? DEFAULT_SPAN;
    return { id: b.id, columnId: slot.columnId, position: slot.position, offset: slot.barOffset, span: Math.max(1, Math.round(span)) };
  }), [beats, barSlots]);
  const layout = useMemo(() => layoutBarBeats(acts, items), [acts, items]);
  let layoutEnd = 0;
  layout.forEach((v) => { layoutEnd = Math.max(layoutEnd, v.page + v.span - 1); });
  // The acts define the plan; the script and beats can outgrow it.
  const totalPages = Math.max(1, actsTotal, Math.ceil(pageCount), layoutEnd);

  // px per page: explicit zoom, or fit-to-width when zoom === 0. Never below
  // fit width: the CSS gives the track min-width:100%, so when zoom×pages is
  // narrower than the bar the track is silently stretched — v2.21: drag math
  // divided mouse deltas by the small zoom while the screen showed the
  // stretched scale, so an inch of mouse flung an item across the bar.
  const fitPpp = Math.max(2, (viewW || 800) / totalPages);
  const ppp = zoom > 0 ? Math.max(zoom, fitPpp) : fitPpp;
  const trackW = Math.ceil(totalPages * ppp);

  /* ── the script row ── */
  const [scenes, setScenes] = useState<SceneEntry[]>([]);
  useEffect(() => {
    if (!editor) return;
    let timer: ReturnType<typeof setTimeout>;
    const refresh = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const heads = collectScenes(editor);
        let lengths: number[] = [];
        try { lengths = computeSceneLengths(editor.state.doc, pageLayout); } catch { /* mid-transaction */ }
        let start = 1;
        setScenes(heads.map((h, i) => {
          const pages = Math.max(SCENE_MIN, lengths[i] ?? SCENE_MIN);
          const s: SceneEntry = { ...h, start, pages };
          start += pages;
          return s;
        }));
      }, 400);
    };
    refresh();
    editor.on('update', refresh);
    return () => { clearTimeout(timer); editor.off('update', refresh); };
  }, [editor, pageLayout]);

  /* ── dragging: beats move/resize; act blocks resize (budget) ── */
  const dragRef = useRef<{
    kind: 'beat-move' | 'beat-resize' | 'act-resize';
    id: string; startX: number; startPage: number; startSpan: number;
  } | null>(null);
  // v2.30: a move drags a ghost; pointer-up commits. v2.60: the drop page
  // is KEPT (pinned as a section offset) — the board is only written when
  // the drop changed the beat's section or its order among its siblings.
  const [ghost, setGhost] = useState<{ id: string; page: number } | null>(null);

  const startBeatDrag = (e: React.PointerEvent, beat: BeatInfo, mode: 'move' | 'resize') => {
    e.preventDefault(); e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    const l = layout.get(beat.id);
    dragRef.current = {
      kind: mode === 'move' ? 'beat-move' : 'beat-resize',
      id: beat.id, startX: e.clientX,
      startPage: l?.page ?? 1,
      startSpan: l?.span ?? DEFAULT_SPAN,
    };
  };
  /** v2.15: either edge resizes. An act's LEFT edge is the boundary with the
   *  previous section, so it adjusts THAT section's budget — Premiere's
   *  trim-the-cut model; the first act's left edge is page 1, immovable. */
  const startActResize = (e: React.PointerEvent, act: { id: string; pages: number }) => {
    e.preventDefault(); e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    dragRef.current = { kind: 'act-resize', id: act.id, startX: e.clientX, startPage: 1, startSpan: act.pages };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const dPages = (e.clientX - d.startX) / ppp;
    if (d.kind === 'beat-move') {
      // Ghost only — the real position derives from section + order on drop.
      setGhost({ id: d.id, page: snapPage(d.startPage + dPages, d.startSpan, totalPages) });
    } else if (d.kind === 'beat-resize') {
      const span = Math.max(SNAP, Math.round((d.startSpan + dPages) / SNAP) * SNAP);
      barSetBeatSpan(d.id, Math.min(span, totalPages));   // v6.59: on the BAR's tab
    } else {
      // Acts budget in WHOLE pages — the ruler total follows live.
      const pages = Math.max(1, Math.round(d.startSpan + dPages));
      barUpdateColumn(d.id, { targetPages: pages });
    }
  };
  /** v2.16/v2.30: the bar and the board are ONE model — dropping a beat
   *  commits its new section AND its order within it (on the bar's tab).
   *  v2.60: the beat keeps its exact drop page (pinned as an offset from
   *  the section start); the board is only written when the section or the
   *  order actually changed, so a nudge within a section stays bar-local. */
  const onPointerUp = () => {
    const d = dragRef.current;
    dragRef.current = null;
    if (!d || d.kind !== 'beat-move') { setGhost(null); return; }
    const g = ghost;
    setGhost(null);
    if (!g) return;
    const plan = planBeatDrop(acts, items, layout, d.id, g.page, d.startSpan);
    if (!plan) return;
    // Board first: its undo snapshot then holds the beats' pre-drag pins.
    if (plan.boardChanged) barAssignBeat(d.id, plan.sectionId, plan.index);
    barSetBeatOffsets(plan.offsets);
  };

  /* ── right-click: name / pages / color (v2.31 — rename moved here from
        double-click, which now jumps to the script) ── */
  const [pop, setPop] = useState<PagesPop | null>(null);
  useEffect(() => {
    if (!pop) return;
    const close = (e: PointerEvent) => {
      if (!(e.target as HTMLElement).closest('.fs-ob-pagespop')) setPop(null);
    };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setPop(null); };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', key);
    };
  }, [pop]);

  const openPop = (e: React.MouseEvent, kind: PagesPop['kind'], id: string, value: number, name: string) => {
    e.preventDefault();
    setPop({ kind, id, x: Math.min(e.clientX, window.innerWidth - 220), y: e.clientY + 4, value, name });
  };
  const commitPop = () => {
    if (!pop) return;
    const v = Math.max(1, Math.round(pop.value));   // whole pages only
    const title = pop.name.trim();
    if (pop.kind === 'column') barUpdateColumn(pop.id, { targetPages: v, ...(title ? { title } : {}) });
    else {
      // The title is the shared beat's; the estimate belongs to this tab.
      barSetBeatSpan(pop.id, v);
      if (title) updateBeat(pop.id, { title });
    }
    setPop(null);
  };

  /* v2.31, Derek: double-click jumps to the matching spot in the SCRIPT —
     the scene whose real page range contains the item's start page. */
  const jumpToPage = (page: number) => {
    if (!editor || editor.isDestroyed || scenes.length === 0) return;
    const scene = scenes.find((s) => page >= s.start && page < s.start + s.pages)
      ?? (page < scenes[0].start ? scenes[0] : scenes[scenes.length - 1]);
    jumpToScene(scene.pos);
  };

  /* ── actions ── */
  const addFromMenu = (v: string) => {
    if (v === 'section') {
      barAddColumn('New Section');
    } else if (v === 'beat') {
      const col = barColumns[0]?.id || barAddColumn('New Section');
      const id = addBeat('New Beat', col);
      // On a non-viewed bar tab the new beat also needs a slot there.
      if (!barIsViewed) barAssignBeat(id, col, Number.MAX_SAFE_INTEGER);
    }
  };

  /* v6.64 → v6.65, Derek: it sends SECTIONS (it used to append one line per
     beat at the end of the script), each anchored at the page the outline
     puts it on, as a real ANNOTATION — v6.64 wrote `# …` section lines and
     he came straight back: "it adds them to the script in the old section
     format instead of as an annotation like I requested". Each annotation
     keeps mirroring its section (utils/outlineScriptSync); sending twice
     updates instead of duplicating. */
  /* v6.66, Derek: "each section is 1 page, so this means section 1 should be
     at the top of page 1, the next at the top of page 2, etc. But … that is
     not where the section annotations were placed."
     v6.65 mapped a page to the SCENE whose estimated range covered it — the
     Outline Bar's own scene arithmetic, not the script's real pagination, so
     a section landed wherever its scene happened to start. The paginator is
     the only thing that knows where a page begins: computePageBlocks gives
     the blocks per page, and posAfterScriptPageIn(n-1) is the first block of
     page n — the SAME pure boundary function the Pages tool and the Custom
     Page dialog resolve through. */
  const posForPage = (page: number): number | null => {
    if (!editor || editor.isDestroyed) return null;
    const n = Math.max(1, Math.round(page));
    try {
      const pages = computePageBlocks(editor.state.doc, pageLayout);
      return posAfterScriptPageIn(pages, n - 1, editor.state.doc.content.size);
    } catch {
      return null;                                  // mid-transaction
    }
  };

  const sendToScript = () => {
    if (!editor || editor.isDestroyed || acts.length === 0) return;
    clearLegacySectionLines(editor);     // v6.64's `# …` lines, if any
    const sections = acts.map((a) => ({ id: a.id, title: a.title, pages: a.pages, page: a.start }));
    const { added, updated, skipped } = sendSectionsToScript(editor, sections, posForPage);
    const bits = [
      added ? `Added ${added} annotation${added === 1 ? '' : 's'}` : '',
      updated ? `${added ? 'updated' : 'Updated'} ${updated}` : '',
    ].filter(Boolean);
    const tail = skipped ? ` ${skipped} had no line left to anchor to — write more script first.` : '';
    showToast(
      bits.length ? `${bits.join(', ')} in the script.${tail}` : `The script's annotations already match this outline.${tail}`,
      skipped ? 'info' : bits.length ? 'success' : 'info',
    );
  };

  const jumpToScene = (pos: number) => {
    if (!editor || editor.isDestroyed) return;
    editor.chain().focus().setTextSelection(pos + 1).scrollIntoView().run();
  };

  /* ── v2.27: the Premiere-style navigator — ONE bar scrolls and rescales.
        Thumb middle = scroll; either end handle = zoom, anchored on the
        opposite edge. The native scrollbar is hidden; wheel scrolling still
        works and keeps the thumb in sync via onScroll. ── */
  const navDrag = useRef<{
    kind: 'move' | 'l' | 'r';
    startX: number; startLeft: number; startWidth: number;
    startScroll: number; startPpp: number;
  } | null>(null);
  const pendingScroll = useRef<number | null>(null);

  // A zoom change re-renders with a new track width before the browser can
  // scroll — apply the anchored scroll position after layout.
  useEffect(() => {
    if (pendingScroll.current === null) return;
    const el = scrollRef.current;
    if (el) { el.scrollLeft = pendingScroll.current; setScrollX(el.scrollLeft); }
    pendingScroll.current = null;
  });

  const startNavDrag = (e: React.PointerEvent, kind: 'move' | 'l' | 'r') => {
    e.preventDefault(); e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    const t = navThumbGeometry(scrollX, viewW, trackW);
    navDrag.current = { kind, startX: e.clientX, startLeft: t.left, startWidth: t.width, startScroll: scrollX, startPpp: ppp };
  };
  const onNavMove = (e: React.PointerEvent) => {
    const d = navDrag.current;
    if (!d) return;
    const dx = e.clientX - d.startX;
    const navW = Math.max(1, viewW);
    if (d.kind === 'move') {
      const t = navThumbGeometry(d.startScroll, viewW, trackW);
      if (t.maxThumbL <= 0) return;
      const left = Math.min(Math.max(0, d.startLeft + dx), t.maxThumbL);
      const el = scrollRef.current;
      if (el) { el.scrollLeft = (left / t.maxThumbL) * t.maxScroll; setScrollX(el.scrollLeft); }
      return;
    }
    // End handles: resize the visible window; the opposite edge stays put.
    const right = d.startLeft + d.startWidth;
    const newWidth = d.kind === 'r'
      ? Math.min(Math.max(24, d.startWidth + dx), navW - d.startLeft)
      : Math.min(Math.max(24, d.startWidth - dx), right);
    const visiblePages = totalPages * (newWidth / navW);
    const newPpp = viewW / Math.max(1, visiblePages);
    const anchorPage = d.kind === 'r'
      ? d.startScroll / d.startPpp                                   // left edge anchored
      : (d.startScroll + viewW) / d.startPpp;                        // right edge anchored
    setZoom(newPpp <= fitPpp + 0.01 ? 0 : newPpp);
    pendingScroll.current = d.kind === 'r'
      ? anchorPage * newPpp
      : anchorPage * newPpp - viewW;
  };
  const endNavDrag = () => { navDrag.current = null; };

  const navThumb = navThumbGeometry(scrollX, viewW, trackW);

  /* ── ruler ticks: label density follows the zoom ── */
  const labelEvery = ppp >= 24 ? 1 : ppp >= 10 ? 5 : 10;
  const pages = useMemo(() => Array.from({ length: totalPages }, (_, i) => i + 1), [totalPages]);

  const pctLeft = (page: number) => `${((page - 1) / totalPages) * 100}%`;
  const pctWidth = (span: number) => `${(span / totalPages) * 100}%`;

  return (
    <div className="fs-outline-bar">
      {/* v2.49, Derek: a slim column of five evenly spaced buttons — open
          Outline, add, pick outline, send to script, Fit. No "Outline"
          title; the tooltip names the tab. */}
      <div
        className="fs-ob-side"
        title={outlineTabs.length > 1 ? `Showing: ${outlineTabs.find((t) => t.id === barTab)?.name ?? ''}` : undefined}
      >
        {/* v3.06, Derek: order is add → outline window → choose → insert → fit. */}
        <AddMenu
          label="+"
          title="Add a section or a beat"
          center
          onPick={addFromMenu}
          groups={[{
            label: 'Add',
            options: [
              { value: 'section', label: 'Section' },
              { value: 'beat', label: 'Beat' },
            ],
          }]}
        />
        {/* v2.39, Derek: jump to the Outline window itself. v3.06: it opens
            POPPED OUT — stored width forced past the panel width, the same
            trick as the header's pop-out chevron. */}
        <button
          className="fs-ob-iconbtn"
          title="Open as a floating window"
          onClick={() => {
            const st = useEditorStore.getState();
            const side = toolConfigFor(st.toolConfig, 'beatboard').side;
            const dockW = dockWidthFor(side, st.panelSizeMode[side], st.chromeCustomPx[side === 'left' ? 'panelLeft' : 'panelRight']);
            const h = st.toolSizes.beatboard?.h ?? toolDef('beatboard')?.defaultSize.h ?? 480;
            st.setToolSize('beatboard', Math.max(st.toolSizes.beatboard?.w ?? 0, dockW + 140), h);
            st.openTool('beatboard');
          }}
        >
          <FaStream />
        </button>
        {/* v2.49, Derek: third item — pick which outline tab the bar mirrors
            (the same choice as the ◉ on the window's tabs — one setter). */}
        <AddMenu
          label={<FaLayerGroup />}
          title="Choose which outline variant shows in the outline toolbar"
          center
          onPick={(id) => useEditorStore.getState().setOutlineBarTab(id)}
          groups={[{
            label: 'Show in the bar',
            options: outlineTabs.map((t) => ({
              value: t.id,
              label: t.name,
              icon: barTab === t.id ? <FaDotCircle /> : <FaRegCircle />,
            })),
          }]}
        />
        <button
          className="fs-ob-iconbtn"
          onClick={async () => {
            if (await confirmDialog(
              `Put all ${acts.length} section${acts.length === 1 ? '' : 's'} into the script as annotations, each at its page?\n\nEach annotation keeps mirroring its section — rename it or change its pages and the annotation follows. Ones already there are updated, not duplicated.`,
              { title: 'Send to Script', confirmLabel: 'Insert' },
            )) sendToScript();
          }}
          disabled={acts.length === 0}
          title="Add all sections to the script as annotations"
        >
          <FaFileExport />
        </button>
        {/* v3.06, Derek: Fit is an icon like its neighbours. */}
        <button
          className={`fs-ob-fitbtn${zoom === 0 ? ' active' : ''}`}
          onClick={() => setZoom(0)}
          title="Fit the whole ruler to the visible width"
        ><FaArrowsAltH /></button>
      </div>

      <div className="fs-ob-main">
        {/* Premiere-style: tracks scroll horizontally; labels stay pinned. */}
        <div
          className="fs-ob-scroll"
          ref={scrollRef}
          onScroll={(e) => setScrollX(e.currentTarget.scrollLeft)}
        >
        <div
          className="fs-ob-tracks"
          style={{
            width: trackW,
            // v2.50, Derek: resizing adds the SAME pixel delta to every row —
            // the ruler grows exactly as much as the lanes, not
            // proportionally less. One scale unit = 26px per row.
            ['--ob-lane-h' as string]: `${Math.max(8, Math.round(26 + (rowScale - 1) * 26))}px`,
            ['--ob-ruler-h' as string]: `${Math.max(8, Math.round(16 + (rowScale - 1) * 26))}px`,
          }}
        >
          {/* v2.42, Derek: rows come from Customize > Outline Bar — order,
              extra rows, per-row heights. Each renderer below is one kind. */}
          {barRows.map((row) => {
            const rowStyle: React.CSSProperties | undefined = row.h
              ? { height: Math.max(8, Math.round(row.h + (rowScale - 1) * 26)) }
              : undefined;
            if (row.kind === 'ruler') {
              return (
                <div key={row.id} className="fs-ob-ruler" style={rowStyle}>
                  {showLabels && row.name?.trim() && <span className="fs-ob-lane-label">{row.name.trim()}</span>}
                  {pages.map((p) => (
                    <span key={p} className="fs-ob-tick" style={{ left: pctLeft(p), width: pctWidth(1) }}>
                      {(p === 1 || p % labelEvery === 0) && <span className="fs-ob-tick-label">{p}</span>}
                    </span>
                  ))}
                </div>
              );
            }
            if (row.kind === 'acts') {
              return (
                <div key={row.id} className="fs-ob-lane fs-ob-acts" style={rowStyle}>
                  {showLabels && <span className="fs-ob-lane-label">{row.name?.trim() || 'Acts'}</span>}
                  {acts.map((a, i) => (
                    <div
                      key={a.id}
                      className={`fs-ob-act fs-ob-act-${i % 3}`}
                      style={{ left: pctLeft(a.start), width: pctWidth(a.pages) }}
                      title={`${a.title} — ${a.pages}p (${a.start}–${a.start + a.pages - 1})\nDouble-click: jump to this spot in the script. Right-click: rename / set pages`}
                      onContextMenu={(e) => openPop(e, 'column', a.id, a.pages, a.title)}
                      onDoubleClick={() => jumpToPage(a.start)}
                    >
                      {i > 0 && (
                        <span
                          className="fs-ob-resize-l"
                          title="Drag to move"
                          onPointerDown={(e) => startActResize(e, acts[i - 1])}
                          onPointerMove={onPointerMove}
                          onPointerUp={onPointerUp}
                        />
                      )}
                      <span className="fs-ob-act-title">{a.title}</span>
                      <span
                        className="fs-ob-beat-resize"
                        title="Drag to change this section's page amount"
                        onPointerDown={(e) => startActResize(e, a)}
                        onPointerMove={onPointerMove}
                        onPointerUp={onPointerUp}
                      />
                    </div>
                  ))}
                  {acts.length === 0 && <span className="fs-ob-empty">No sections yet — + adds one</span>}
                </div>
              );
            }
            if (row.kind === 'beats') {
              return (
                <div key={row.id} className="fs-ob-lane fs-ob-beats" style={rowStyle}>
                  {showLabels && <span className="fs-ob-lane-label">{row.name?.trim() || 'Beats'}</span>}
                  {beats.map((b) => {
                    const l = layout.get(b.id);
                    if (!l) return null;
                    const page = ghost?.id === b.id ? ghost.page : l.page;
                    const { leftPct, widthPct } = markerGeometry(page, l.span, totalPages);
                    return (
                      <div
                        key={b.id}
                        className={`fs-ob-beat${ghost?.id === b.id ? ' fs-ob-beat-dragging' : ''}`}
                        style={{ left: `${leftPct}%`, width: `${widthPct}%`, background: b.color || undefined }}
                        title={`${b.title} — p${page}, ${l.span}p${b.description ? `\n${b.description}` : ''}\nDouble-click: jump to this spot in the script. Right-click: rename / pages / color`}
                        onPointerDown={(e) => startBeatDrag(e, b, 'move')}
                        onPointerMove={onPointerMove}
                        onPointerUp={onPointerUp}
                        onContextMenu={(e) => openPop(e, 'beat', b.id, l.span, b.title)}
                        onDoubleClick={() => jumpToPage(page)}
                      >
                        <span className="fs-ob-beat-title">{b.title}</span>
                        <span
                          className="fs-ob-beat-resize"
                          title="Drag to change the page span"
                          onPointerDown={(e) => startBeatDrag(e, b, 'resize')}
                          onPointerMove={onPointerMove}
                          onPointerUp={onPointerUp}
                        />
                      </div>
                    );
                  })}
                </div>
              );
            }
            // 'script' — one block per scene heading, true fractional lengths.
            return (
              <div key={row.id} className="fs-ob-lane fs-ob-scenes" style={rowStyle}>
                {showLabels && <span className="fs-ob-lane-label">{row.name?.trim() || 'Scenes'}</span>}
                {scenes.length === 0 ? (
                  <span className="fs-ob-empty">No scene headings yet</span>
                ) : scenes.map((sc, i) => (
                  <button
                    key={`${sc.pos}-${i}`}
                    className="fs-ob-scene"
                    style={{ left: pctLeft(sc.start), width: pctWidth(sc.pages) }}
                    title={`${sc.text} — ${sc.pages.toFixed(2)}p`}
                    onClick={() => jumpToScene(sc.pos)}
                  >
                    {sc.text}
                  </button>
                ))}
              </div>
            );
          })}
        </div>
        </div>

        {/* v2.28: the navigator — always visible; drag the middle to scroll,
            drag either round end handle to rescale (opposite edge anchored). */}
        <div className="fs-ob-nav">
          <div
            className="fs-ob-nav-thumb"
            style={{ left: navThumb.left, width: navThumb.width }}
            title="Drag to scroll"
            onPointerDown={(e) => startNavDrag(e, 'move')}
            onPointerMove={onNavMove}
            onPointerUp={endNavDrag}
          >
            <span
              className="fs-ob-nav-handle fs-ob-nav-handle-l"
              onPointerDown={(e) => startNavDrag(e, 'l')}
              onPointerMove={onNavMove}
              onPointerUp={endNavDrag}
            />
            <span
              className="fs-ob-nav-handle fs-ob-nav-handle-r"
              onPointerDown={(e) => startNavDrag(e, 'r')}
              onPointerMove={onNavMove}
              onPointerUp={endNavDrag}
            />
          </div>
        </div>
      </div>

      {/* v2.31: right-click menu — name, pages, and (beats) color. */}
      {pop && createPortal(
        <div className="fs-ob-pagespop" style={{ top: pop.y, left: pop.x }}>
          <label>
            Name
            <input
              autoFocus
              type="text"
              value={pop.name}
              onChange={(e) => setPop({ ...pop, name: e.target.value })}
              onKeyDown={(e) => { if (e.key === 'Enter') commitPop(); }}
            />
          </label>
          <label>
            Pages
            <input
              type="number"
              min={1}
              step={1}
              value={pop.value}
              onChange={(e) => setPop({ ...pop, value: Number(e.target.value) || 0 })}
              onKeyDown={(e) => { if (e.key === 'Enter') commitPop(); }}
            />
          </label>
          {pop.kind === 'beat' && (
            <div className="fs-ob-pop-colors">
              {BEAT_COLORS.map((c) => (
                <button
                  key={c || 'none'}
                  className="fs-ob-pop-swatch"
                  style={{ background: c || 'transparent' }}
                  title={c ? c : 'No color'}
                  onClick={() => updateBeat(pop.id, { color: c })}
                >{c ? '' : '∅'}</button>
              ))}
            </div>
          )}
          <button onClick={commitPop}>Set</button>
        </div>,
        document.body,
      )}
    </div>
  );
}
