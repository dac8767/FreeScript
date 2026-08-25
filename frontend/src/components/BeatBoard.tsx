import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  DndContext,
  closestCenter,
  pointerWithin,
  PointerSensor,
  useSensor,
  useSensors,
  DragOverlay,
  useDroppable,
} from '@dnd-kit/core';
import type {
  DragEndEvent,
  DragStartEvent,
  DragOverEvent,
  CollisionDetection,
} from '@dnd-kit/core';
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { createPortal } from 'react-dom';
import { FaLink, FaPaperclip, FaRegQuestionCircle, FaRegTrashAlt } from 'react-icons/fa';
import { LuRotateCcw, LuColumns3, LuWaypoints } from 'react-icons/lu';
import { ExpandIcon, ShrinkIcon } from './uiIcons';
import { readableTextOn } from '../utils/palettes';
import { EdgeResizeZones, startEdgeResize, type EdgeZone } from './EdgeResize';
import { useEditorStore, type BeatInfo, type BeatAnchor, type BeatLinkPreview } from '../stores/editorStore';
import { useOutlinePresetStore } from '../stores/outlinePresetStore';
import { confirmDialog, promptDialog } from './ConfirmDialog';
import { ht } from '../utils/helperText';
import { ControlDropdown, ControlSearch, type ToolChromeTab } from './ToolControls';
import { showToast } from './Toast';
import { openTextFile } from '../utils/fileOps';
import { api } from '../services/api';

/* v2.31: exported — the Outline Bar's right-click menu offers the SAME
   palette the board's color picker uses. One list. */
export const BEAT_COLORS = [
  '', '#8b5cf6', '#4f46e5', '#2563eb', '#059669',
  '#eab308', '#f97316', '#ef4444', '#000000', '#ffffff',
];
/* v6.49: names for the header Filter menu — one entry per palette color. */
export const BEAT_COLOR_NAMES: Record<string, string> = {
  '': 'Uncolored', '#8b5cf6': 'Purple', '#4f46e5': 'Indigo', '#2563eb': 'Blue',
  '#059669': 'Green', '#eab308': 'Yellow', '#f97316': 'Orange', '#ef4444': 'Red',
  '#000000': 'Black', '#ffffff': 'White',
};

/** v6.49: the header search + color filter, one predicate for every render
 *  path (sections, Unsorted, freeform canvas) and the header count.
 *  `colors` holds hex values ('' = uncolored); empty = no color filter. */
export function beatMatchesFilter(
  b: Pick<BeatInfo, 'title' | 'description' | 'color'>,
  search: string,
  colors: string[],
): boolean {
  if (colors.length > 0 && !colors.includes(b.color || '')) return false;
  const q = search.trim().toLowerCase();
  if (!q) return true;
  return b.title.toLowerCase().includes(q) || b.description.toLowerCase().includes(q);
}

/* ─── Outline presets (v1.89) ───
   One list drives the Presets dropdown; applying one appends its columns in
   order. Exported (with the apply helper) so the test exercises the same
   data the UI reads. */
export interface OutlinePreset {
  id: string;
  name: string;
  columns: string[];
  /** v2.20: default page budget per section, parallel to `columns`. Where a
   *  structure has conventional page counts they're used; every entry is at
   *  least 1 — a blank budget can't be grabbed on the Outline Bar. */
  pages: number[];
}
export const OUTLINE_PRESETS: OutlinePreset[] = [
  // Derek's spec: 40 pages per act.
  { id: '3act', name: '3-Act Structure', columns: ['Act I', 'Act II', 'Act III'], pages: [40, 40, 40] },
  {
    id: 'savethecat', name: 'Save the Cat (15 beats)',
    columns: [
      'Opening Image', 'Theme Stated', 'Set-Up', 'Catalyst', 'Debate',
      'Break into Two', 'B Story', 'Fun and Games', 'Midpoint',
      'Bad Guys Close In', 'All Is Lost', 'Dark Night of the Soul',
      'Break into Three', 'Finale', 'Final Image',
    ],
    // Snyder's beat sheet is written for a 110-page script; these spans tile
    // his page numbers (Catalyst p12, Break into Two p25, Midpoint p55,
    // All Is Lost p75, Break into Three p85, Final Image p110) in order.
    pages: [1, 1, 8, 2, 13, 1, 4, 25, 1, 19, 1, 9, 1, 23, 1],
  },
  {
    id: 'herojourney', name: "The Hero's Journey (12 stages)",
    columns: [
      'Ordinary World', 'Call to Adventure', 'Refusal of the Call',
      'Meeting the Mentor', 'Crossing the Threshold', 'Tests, Allies, Enemies',
      'Approach to the Inmost Cave', 'The Ordeal', 'Reward',
      'The Road Back', 'Resurrection', 'Return with the Elixir',
    ],
    // Vogler's act mapping on a 120-page feature: stages 1–5 = Act I (30),
    // 6–9 = Act II (60), 10–12 = Act III (30).
    pages: [10, 5, 5, 5, 5, 25, 10, 10, 15, 10, 15, 5],
  },
  {
    id: 'storycircle', name: 'Story Circle (8 steps)',
    columns: ['You', 'Need', 'Go', 'Search', 'Find', 'Take', 'Return', 'Change'],
    // Harmon's circle is eight EQUAL arcs — even eighths of a 120-page
    // feature. Scale down for a TV episode.
    pages: [15, 15, 15, 15, 15, 15, 15, 15],
  },
  {
    id: 'sequences', name: 'Sequence Method (8 sequences)',
    columns: [
      'Seq 1: Status Quo', 'Seq 2: Predicament', 'Seq 3: First Obstacle',
      'Seq 4: Midpoint', 'Seq 5: Rising Action', 'Seq 6: Main Culmination',
      'Seq 7: New Tension', 'Seq 8: Resolution',
    ],
    // The classic reel-length sequence: eight ~15-page sequences ≈ 120.
    pages: [15, 15, 15, 15, 15, 15, 15, 15],
  },
];

/** v2.26: a preset id resolves to a built-in, or (as `custom:<id>`) to one
 *  of the user's saved presets — one lookup for apply/override alike. */
export function resolveOutlinePreset(presetId: string): { name: string; columns: string[]; pages: number[] } | undefined {
  if (presetId.startsWith('custom:')) {
    return useOutlinePresetStore.getState().presets.find((p) => p.id === presetId.slice(7));
  }
  return OUTLINE_PRESETS.find((p) => p.id === presetId);
}

/** Deal `pages` pages across `count` beats, biggest shares first. The sum is
 *  exactly `pages` — unless there are more beats than pages, where a beat
 *  still can't be shorter than one page and the section runs over. */
export function splitPages(pages: number, count: number): number[] {
  const total = Math.max(1, Math.round(pages));
  const n = Math.max(0, Math.round(count));
  if (n === 0) return [];
  if (n >= total) return new Array(n).fill(1);
  const base = Math.floor(total / n);
  const extra = total - base * n;                     // 0..n-1 leftovers
  return Array.from({ length: n }, (_, i) => base + (i < extra ? 1 : 0));
}

/* ─── v6.59, Derek: "when a preset is used but beats already exist, it should
   use the existing beats instead of creating new ones. it can change the page
   estimates of existing beats to work with the new preset structure." ───
   So the beats the writer already has become the preset's beats. How many
   land in each section is the same question an election asks: hand out
   `count` seats in proportion to `pages`. Every section gets one first (a
   section with no beats is a hole in the outline), then each remaining beat
   goes to whichever section is currently the most under-served — the largest
   pages-per-beat. A section is capped at one beat per page, because a beat
   can't be shorter than a page. */
export function distributeBeats(pages: number[], count: number): number[] {
  const n = pages.length;
  const out = new Array<number>(n).fill(0);
  if (n === 0 || count <= 0) return out;
  const cap = pages.map((p) => Math.max(1, Math.round(p)));
  let left = count;
  // Pass 1: one each, biggest sections first — a short supply covers the
  // sections carrying the most story rather than dying out at the opening.
  for (const i of cap.map((_, i) => i).sort((a, b) => cap[b] - cap[a] || a - b)) {
    if (left <= 0) break;
    out[i] = 1;
    left--;
  }
  // Pass 2: proportional, respecting the one-beat-per-page ceiling.
  while (left > 0) {
    let best = -1;
    let bestQ = -1;
    for (let i = 0; i < n; i++) {
      if (out[i] >= cap[i]) continue;
      const q = cap[i] / (out[i] + 1);
      if (q > bestQ) { bestQ = q; best = i; }
    }
    if (best < 0) break;
    out[best]++;
    left--;
  }
  // Pass 3: more beats than the whole structure has pages. Nothing is thrown
  // away — the thinnest sections take the overflow and run over budget.
  while (left > 0) {
    let best = 0;
    for (let i = 1; i < n; i++) if (out[i] < out[best]) best = i;
    out[best]++;
    left--;
  }
  return out;
}

/** v6.59: the beats a preset may re-home, in the order it deals them out —
 *  the board's own reading order (section, then order within the section),
 *  with beats whose section is gone last. In 'append' the sections that are
 *  staying keep their beats; only the loose ones are dealt. */
export function presetReuseOrder(
  beats: BeatInfo[],
  columns: Array<{ id: string; position: number }>,
  mode: 'append' | 'override',
): BeatInfo[] {
  const pos = new Map(columns.map((c) => [c.id, c.position]));
  const pool = mode === 'override' ? beats : beats.filter((b) => !pos.has(b.columnId));
  return [...pool].sort((a, b) =>
    (pos.get(a.columnId) ?? Number.MAX_SAFE_INTEGER) - (pos.get(b.columnId) ?? Number.MAX_SAFE_INTEGER)
    || a.position - b.position);
}

export function applyOutlinePreset(presetId: string, mode: 'append' | 'override' = 'append'): void {
  const preset = resolveOutlinePreset(presetId);
  if (!preset) return;
  /* v6.48, Derek: the tab a preset lands in takes the preset's NAME — every
     door (dropdown, import, tests) goes through here, so the rename rides
     the apply itself. */
  const st = useEditorStore.getState();
  st.renameOutlineTab(st.viewedOutlineTab, preset.name);
  const pages = preset.columns.map((_, i) => Math.max(1, Math.round(preset.pages[i] ?? 1)));
  /* v6.59: beats already on the board are re-homed into the preset's sections
     and re-fitted.
     v7.75, Derek: "the outline presets should just be sections, not beats." A
     board with none now gets the sections and NOTHING in them — the starter
     cards a preset used to deal out were blank placeholders the writer had to
     clear before they could write their own. Re-homing stays: moving beats you
     already wrote into the new structure is not creating beats. */
  const reuse = presetReuseOrder(st.beats, st.beatColumns, mode);
  const counts = reuse.length > 0
    ? distributeBeats(pages, reuse.length)
    : pages.map(() => 0);
  st.applyPresetSections(
    preset.columns.map((title, i) => ({ title, pages: pages[i], spans: splitPages(pages[i], counts[i]) })),
    mode,
    reuse.map((b) => b.id),
  );
}

/** v2.23: beats whose section no longer exists. v6.60, Derek: deleting a
 *  section sends its beats here rather than destroying them — "no beats
 *  should ever be deleted unless they are individually deleted using the
 *  delete button on the beat itself". They wait in the temporary "Unsorted"
 *  column, furthest left, until dragged into a real section. Exported for
 *  the test. */
export function unsortedBeats(beats: BeatInfo[], columns: Array<{ id: string }>): BeatInfo[] {
  return beats
    .filter((b) => !columns.some((c) => c.id === b.columnId))
    .sort((a, b) => a.position - b.position);
}

/** v2.45: whether the Unsorted column renders. It must stay MOUNTED for
 *  the entire drag if it was there when the drag began — dragOver reassigns
 *  the beat's columnId live, so dragging the last orphan out would otherwise
 *  unmount the column (an active dnd-kit droppable) mid-drag, and dnd-kit's
 *  re-measuring then loops setState into React's "Maximum update depth
 *  exceeded" crash. Exported for the regression test. */
export function keepUnsortedMounted(orphanCount: number, dragActive: boolean, hadOrphansAtDragStart: boolean): boolean {
  return orphanCount > 0 || (dragActive && hadOrphansAtDragStart);
}

/* ─── URL detection ─── */
const URL_REGEX = /https?:\/\/[^\s<>"{}|\\^`\[\]]+/g;

function extractUrls(text: string): string[] {
  if (!text) return [];
  const matches = text.match(URL_REGEX);
  return matches ? [...new Set(matches)] : [];
}

/* ─── Link Preview fetcher with in-memory cache ─── */
const _previewCache = new Map<string, BeatLinkPreview | 'loading' | 'error'>();

/** v7.85 (security review D4) — previews are NO LONGER fetched automatically.
 *  A URL can arrive inside an opened file, and auto-fetching it (plus auto-
 *  loading its og:image) turned "open a stranger's script" into a silent
 *  beacon to the sender and a probe of the local network. This hook only
 *  reports the URLs in the description and any preview DATA already saved on
 *  the beat; nothing reaches the network — not the fetch, not the image —
 *  until the writer clicks "Load preview" (see loadPreview in BeatCard). */
export function useLinkPreviews(
  description: string,
  existingPreviews: BeatLinkPreview[] | undefined,
) {
  const urls = useMemo(() => extractUrls(description), [description]);
  const byUrl = useMemo(() => {
    const m = new Map<string, BeatLinkPreview>();
    for (const p of existingPreviews || []) {
      if (urls.includes(p.url)) m.set(p.url, p);
    }
    return m;
  }, [existingPreviews, urls]);
  return { urls, byUrl };
}

/** Hostname of a URL for the "Load preview" chip label, best-effort. */
export function prettyHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/* ─── Link Preview Card ─── */
const LinkPreviewCard: React.FC<{
  preview: BeatLinkPreview;
  onRemove: () => void;
}> = ({ preview, onRemove }) => (
  <a
    className="beat-link-preview"
    href={preview.url}
    target="_blank"
    rel="noopener noreferrer"
    title={preview.url}
    onClick={(e) => e.stopPropagation()}
  >
    {preview.image && (
      <div className="beat-link-preview-image">
        <img src={preview.image} alt="" loading="lazy" />
      </div>
    )}
    <div className="beat-link-preview-body">
      {preview.siteName && <div className="beat-link-preview-site">{preview.siteName}</div>}
      <div className="beat-link-preview-title">{preview.title || preview.url}</div>
      {preview.description && <div className="beat-link-preview-desc">{preview.description}</div>}
    </div>
    <button
      className="beat-link-preview-remove"
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); onRemove(); }}
      title="Remove preview"
    ><FaRegTrashAlt /></button>
  </a>
);

/* ─── Render description text with clickable links ─── */
const DescriptionWithLinks: React.FC<{ text: string }> = ({ text }) => {
  if (!text) return null;
  const parts = text.split(URL_REGEX);
  const urls = text.match(URL_REGEX) || [];
  const elements: React.ReactNode[] = [];
  for (let i = 0; i < parts.length; i++) {
    if (parts[i]) elements.push(<span key={`t${i}`}>{parts[i]}</span>);
    if (urls[i]) {
      elements.push(
        <a
          key={`u${i}`}
          className="beat-desc-link"
          href={urls[i]}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
        >
          {urls[i]}
        </a>,
      );
    }
  }
  return <div className="beat-card-description-rendered">{elements}</div>;
};

/* v2.17: the beat's page estimate — the SAME outlineSpan the Outline Bar
   draws, editable from the board card too. Whole pages only. */
const BeatPagesField: React.FC<{
  beat: BeatInfo; onUpdate: (id: string, updates: Partial<BeatInfo>) => void;
}> = ({ beat, onUpdate }) => (
  <label
    className="beat-card-pages"
    title="Page estimate"
    onClick={(e) => e.stopPropagation()}
  >
    {/* v2.20: never blank — a beat with no span can't be grabbed on the
        Outline Bar, so invalid input is ignored and blur restores the value. */}
    <input
      type="number"
      min={1}
      step={1}
      value={beat.outlineSpan ?? 1}
      onChange={(e) => {
        const n = Math.round(Number(e.target.value));
        if (Number.isFinite(n) && n >= 1) onUpdate(beat.id, { outlineSpan: n });
      }}
      onBlur={(e) => { if (!e.target.value) e.target.value = String(beat.outlineSpan ?? 1); }}
    />
    <span>pages</span>
  </label>
);


/* ─── Beat Card Resize Handle (pointer events for mouse + touch) ─── */
const useResizeHandle = (
  onResize: (dw: number, dh: number) => void,
) => {
  const startRef = useRef<{ x: number; y: number; w: number; h: number } | null>(null);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const el = (e.target as HTMLElement).closest('.beat-card') as HTMLElement;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      startRef.current = { x: e.clientX, y: e.clientY, w: rect.width, h: rect.height };

      const onMove = (ev: PointerEvent) => {
        if (!startRef.current) return;
        onResize(
          Math.max(160, startRef.current.w + (ev.clientX - startRef.current.x)),
          Math.max(80, startRef.current.h + (ev.clientY - startRef.current.y)),
        );
      };
      const onUp = () => {
        startRef.current = null;
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onUp);
      };
      document.addEventListener('pointermove', onMove);
      document.addEventListener('pointerup', onUp);
    },
    [onResize],
  );

  return onPointerDown;
};

/* ─── Column Resize Handle (pointer events for mouse + touch) ─── */
const useColumnResize = (onResize: (width: number) => void) => {
  const startRef = useRef<{ x: number; w: number } | null>(null);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const col = (e.target as HTMLElement).closest('.beat-column') as HTMLElement;
      if (!col) return;
      startRef.current = { x: e.clientX, w: col.getBoundingClientRect().width };

      const onMove = (ev: PointerEvent) => {
        if (!startRef.current) return;
        onResize(Math.max(200, startRef.current.w + (ev.clientX - startRef.current.x)));
      };
      const onUp = () => {
        startRef.current = null;
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onUp);
      };
      document.addEventListener('pointermove', onMove);
      document.addEventListener('pointerup', onUp);
    },
    [onResize],
  );

  return onPointerDown;
};

/* ─── Shared Beat Card Content (used in both auto and custom modes) ─── */
interface BeatCardContentProps {
  beat: BeatInfo;
  onUpdate: (id: string, updates: Partial<BeatInfo>) => void;
  onDelete: (id: string) => void;
  dragHandleProps?: Record<string, unknown>;
  /** v6.52 (freeform): the WHOLE header row is a drag surface, windows-style
   *  — spread on .beat-card-top. The handler guards its own targets. */
  headerDragProps?: Record<string, unknown>;
  /** The bottom-right corner grip. Sections-mode cards only since v6.53 —
   *  freeform cards resize from any edge (EdgeResizeZones) and their corner
   *  belongs to the Connect button. */
  resizePointerDown?: (e: React.PointerEvent) => void;
  /** v2.46: an extra header button, first in the right-hand group — the
   *  freeform card's Connect button rides here. */
  headExtra?: React.ReactNode;
}

const BeatCardContent: React.FC<BeatCardContentProps> = ({
  beat, onUpdate, onDelete, dragHandleProps, headerDragProps, resizePointerDown, headExtra,
}) => {
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [descFocused, setDescFocused] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const descRef = useRef<HTMLTextAreaElement>(null);
  const imgH = beat.imageHeight || 0;
  const isImgFull = imgH === -1; // -1 = full card

  // v7.84 (D4): link previews load on an explicit click, never on open.
  const { urls: descUrls, byUrl: previewByUrl } = useLinkPreviews(beat.description, beat.linkPreviews);
  const [revealedPreviews, setRevealedPreviews] = useState<Set<string>>(() => new Set());
  const [loadingPreviews, setLoadingPreviews] = useState<Set<string>>(() => new Set());

  const loadPreview = useCallback(
    (url: string) => {
      // Already have the data (saved on the beat, or fetched earlier this
      // session) → just reveal it. The network is touched only for a
      // first-time fetch, and only on this explicit click.
      const cached = _previewCache.get(url);
      if (previewByUrl.has(url) || (cached && typeof cached === 'object')) {
        setRevealedPreviews((s) => new Set(s).add(url));
        return;
      }
      setLoadingPreviews((s) => new Set(s).add(url));
      api.fetchLinkPreview(url)
        .then((resp) => {
          const preview: BeatLinkPreview = {
            url: resp.url,
            title: resp.title,
            description: resp.description,
            image: resp.image,
            siteName: resp.site_name,
          };
          _previewCache.set(url, preview);
          const current = beat.linkPreviews || [];
          if (!current.some((p) => p.url === url)) {
            onUpdate(beat.id, { linkPreviews: [...current, preview] });
          }
          setRevealedPreviews((s) => new Set(s).add(url));
        })
        .catch(() => {
          _previewCache.set(url, 'error');
        })
        .finally(() => {
          setLoadingPreviews((s) => {
            const n = new Set(s);
            n.delete(url);
            return n;
          });
        });
    },
    [beat.id, beat.linkPreviews, previewByUrl, onUpdate],
  );

  const handleRemovePreview = useCallback(
    (url: string) => {
      const updated = (beat.linkPreviews || []).filter((p) => p.url !== url);
      onUpdate(beat.id, { linkPreviews: updated });
      _previewCache.set(url, 'error'); // prevent re-fetch
      setRevealedPreviews((s) => {
        const n = new Set(s);
        n.delete(url);
        return n;
      });
    },
    [beat.id, beat.linkPreviews, onUpdate],
  );

  // ONE render for both card layouts (was duplicated) — a revealed preview
  // shows its card; everything else is a click-to-load chip, so no URL in an
  // opened file fetches or renders a remote image on its own.
  const linkPreviewsBlock = descUrls.length > 0 ? (
    <div className="beat-link-previews">
      {descUrls.map((url) => {
        const cached = _previewCache.get(url);
        const data = previewByUrl.get(url)
          ?? (cached && typeof cached === 'object' ? cached : undefined);
        if (revealedPreviews.has(url) && data) {
          return <LinkPreviewCard key={url} preview={data} onRemove={() => handleRemovePreview(url)} />;
        }
        return (
          <button
            key={url}
            type="button"
            className="beat-link-preview-load"
            title={`Load a preview for ${url}`}
            onClick={(e) => { e.stopPropagation(); loadPreview(url); }}
          >
            <FaLink aria-hidden />
            <span>{loadingPreviews.has(url) ? 'Loading preview…' : `Load preview — ${prettyHost(url)}`}</span>
          </button>
        );
      })}
    </div>
  ) : null;

  // v2.44, Derek: the color paints the WHOLE block, not just the edge.
  // (v6.49: always — the v2.46 "Show beat color on all tabs" checkbox and
  // its edge-stripe fallback are gone.)
  const wholeColor = Boolean(beat.color);
  const cardStyle: React.CSSProperties = {
    ...(wholeColor ? { background: beat.color, color: readableTextOn(beat.color) } : {}),
    ...(beat.cardHeight ? { height: beat.cardHeight, overflow: 'auto' } : {}),
  };

  /* v2.46: the color picker is PORTALLED — its trigger sits in the header
     row, and the card (overflow:auto when resized), the column and the
     canvas all clip absolutely-positioned children (footgun §4). Fixed
     coordinates measured from the trigger, dropdown hangs below. */
  const colorBtnRef = useRef<HTMLButtonElement>(null);
  const [pickerPos, setPickerPos] = useState<{ top: number; left: number } | null>(null);
  const toggleColorPicker = useCallback(() => {
    if (!showColorPicker && colorBtnRef.current) {
      const r = colorBtnRef.current.getBoundingClientRect();
      setPickerPos({ top: r.bottom + 4, left: Math.max(8, Math.min(r.right - 140, window.innerWidth - 148)) });
    }
    setShowColorPicker((v) => !v);
  }, [showColorPicker]);
  useEffect(() => {
    if (!showColorPicker) return;
    const close = (e: PointerEvent) => {
      const t = e.target as HTMLElement;
      if (!t.closest('.beat-color-picker') && t !== colorBtnRef.current) setShowColorPicker(false);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [showColorPicker]);

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file || !file.type.startsWith('image/')) return;
      const reader = new FileReader();
      reader.onload = () => onUpdate(beat.id, { imageUrl: reader.result as string });
      reader.readAsDataURL(file);
      e.target.value = '';
    },
    [beat.id, onUpdate],
  );

  /* Image resize via bottom-edge drag */
  const imgResizeRef = useRef<{ startY: number; startH: number } | null>(null);
  const onImgResizeDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const imgContainer = (e.target as HTMLElement).closest('.beat-card-image') as HTMLElement;
      if (!imgContainer) return;
      imgResizeRef.current = { startY: e.clientY, startH: imgContainer.getBoundingClientRect().height };

      const onMove = (ev: PointerEvent) => {
        if (!imgResizeRef.current) return;
        const newH = Math.max(40, imgResizeRef.current.startH + (ev.clientY - imgResizeRef.current.startY));
        onUpdate(beat.id, { imageHeight: newH });
      };
      const onUp = () => {
        imgResizeRef.current = null;
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onUp);
      };
      document.addEventListener('pointermove', onMove);
      document.addEventListener('pointerup', onUp);
    },
    [beat.id, onUpdate],
  );

  const imgStyle: React.CSSProperties = isImgFull
    ? { flex: 1, maxHeight: 'none' }
    : imgH > 0
      ? { height: imgH, maxHeight: 'none' }
      : {};

  const imgElStyle: React.CSSProperties = isImgFull
    ? { maxHeight: 'none', height: '100%' }
    : imgH > 0
      ? { maxHeight: imgH }
      : {};

  /* v2.46: ONE header row — it used to be pasted into both layout branches.
     v6.54, Derek: with headerDragProps the card wears WINDOW CHROME — the row
     becomes a real title bar (its own band, at the very top of the card, the
     whole thing a drag surface), so the ⋮⋮ grip retires: there is nothing
     left for it to do that the bar doesn't. Sections-mode cards have no such
     bar and keep the grip, which is also their dnd-kit handle. */
  const windowChrome = !!headerDragProps;
  const headerRow = (
    <div className={`beat-card-top${windowChrome ? ' beat-card-titlebar' : ''}`} {...(headerDragProps || {})}>
      {!windowChrome && (
        <span className="beat-drag-icon" {...(dragHandleProps || {})} style={{ touchAction: 'none' }}>⋮⋮</span>
      )}
      <input
        className="beat-card-title"
        value={beat.title}
        onChange={(e) => onUpdate(beat.id, { title: e.target.value })}
        placeholder="Beat title..."
      />
      <span className="beat-card-headbtns">
        {headExtra}
        <button ref={colorBtnRef} className="beat-toolbar-btn" onClick={toggleColorPicker} title="Card color">&#9679;</button>
        <button className="beat-toolbar-btn" onClick={() => fileInputRef.current?.click()} title="Attach image"><FaPaperclip /></button>
        <button className="beat-card-delete" onClick={() => onDelete(beat.id)} title="Delete beat"><FaRegTrashAlt /></button>
      </span>
      {showColorPicker && pickerPos && createPortal(
        <div className="beat-color-picker beat-color-picker-fixed" style={{ top: pickerPos.top, left: pickerPos.left }}>
          {BEAT_COLORS.map((c) => (
            <button
              key={c || 'none'}
              className={`beat-color-swatch${beat.color === c ? ' active' : ''}`}
              style={c ? { background: c } : undefined}
              onClick={() => { onUpdate(beat.id, { color: c }); setShowColorPicker(false); }}
              title={c || 'No color'}
            >{!c && <span className="beat-color-none">&times;</span>}</button>
          ))}
        </div>,
        document.body,
      )}
    </div>
  );

  return (
    <div className={`beat-card${isImgFull ? ' beat-card-img-full' : ''}${wholeColor ? ' beat-card-colored' : ''}${windowChrome ? ' beat-card-windowed' : ''}`} style={cardStyle}>
      {/* v6.54: a windowed card's title bar sits at the very top, above the
          picture — where a window's title bar belongs. */}
      {windowChrome && headerRow}
      {/* Floating drag handle over image (grip-mode cards only) */}
      {beat.imageUrl && !windowChrome && (
        <span className="beat-drag-icon beat-drag-icon-floating" {...(dragHandleProps || {})} style={{ touchAction: 'none' }}>⋮⋮</span>
      )}
      {beat.imageUrl && (
        <>
          <div className="beat-card-image" style={imgStyle}>
            <img src={beat.imageUrl} alt="" style={imgElStyle} />
            {!isImgFull && (
              <>
                <div className="beat-card-image-actions">
                  <button
                    className="beat-card-image-action-btn"
                    onClick={() => onUpdate(beat.id, { imageHeight: -1 })}
                    title="Fill card"
                  >&#x229E;</button>
                  {imgH !== 0 && (
                    <button
                      className="beat-card-image-action-btn"
                      onClick={() => onUpdate(beat.id, { imageHeight: 0 })}
                      title="Reset image size"
                    ><LuRotateCcw /></button>
                  )}
                  <button
                    className="beat-card-image-remove"
                    onClick={() => onUpdate(beat.id, { imageUrl: '', imageHeight: 0 })}
                    title="Remove image"
                  ><FaRegTrashAlt /></button>
                </div>
                <div
                  className="beat-card-image-resize-handle"
                  onPointerDown={onImgResizeDown}
                  style={{ touchAction: 'none' }}
                />
              </>
            )}
          </div>
          {isImgFull && (
            <div className="beat-card-image-actions-floating">
              <button
                className="beat-card-image-action-btn"
                onClick={() => onUpdate(beat.id, { imageHeight: 0 })}
                title="Default size"
              >&#x229F;</button>
              <button
                className="beat-card-image-remove"
                onClick={() => onUpdate(beat.id, { imageUrl: '', imageHeight: 0 })}
                title="Remove image"
              ><FaRegTrashAlt /></button>
            </div>
          )}
        </>
      )}

      {isImgFull ? (
        <div className="beat-card-content-bottom">
          {!windowChrome && headerRow}
          {descFocused ? (
            <textarea
              ref={descRef}
              className="beat-card-description"
              value={beat.description}
              onChange={(e) => onUpdate(beat.id, { description: e.target.value })}
              onBlur={() => setDescFocused(false)}
              placeholder="Describe this beat..."
              rows={2}
              autoFocus
            />
          ) : (
            <div className="beat-card-description-view" onClick={() => setDescFocused(true)}>
              {beat.description ? <DescriptionWithLinks text={beat.description} /> : (
                <span className="beat-card-desc-placeholder">Describe this beat...</span>
              )}
            </div>
          )}
          {linkPreviewsBlock}
        </div>
      ) : (
        <>
          {!windowChrome && headerRow}
          {descFocused ? (
            <textarea
              ref={descRef}
              className="beat-card-description"
              value={beat.description}
              onChange={(e) => onUpdate(beat.id, { description: e.target.value })}
              onBlur={() => setDescFocused(false)}
              placeholder="Describe this beat..."
              rows={2}
              autoFocus
            />
          ) : (
            <div className="beat-card-description-view" onClick={() => setDescFocused(true)}>
              {beat.description ? <DescriptionWithLinks text={beat.description} /> : (
                <span className="beat-card-desc-placeholder">Describe this beat...</span>
              )}
            </div>
          )}
          {linkPreviewsBlock}
        </>
      )}

      {/* v2.44: color/attach moved to the header, reset-size is gone —
          only the page estimate lives down here now. */}
      <div className="beat-card-foot" style={{ marginTop: 'auto' }}>
        <BeatPagesField beat={beat} onUpdate={onUpdate} />
      </div>
      <input ref={fileInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleFileChange} />

      {/* Resize handle (sections mode; freeform resizes from any edge) */}
      {resizePointerDown && (
        <div className="beat-card-resize-handle" onPointerDown={resizePointerDown} style={{ touchAction: 'none' }} />
      )}
    </div>
  );
};

/* ─── Sortable Beat Card (auto-arrange mode) ─── */
interface SortableBeatCardProps {
  beat: BeatInfo;
  onUpdate: (id: string, updates: Partial<BeatInfo>) => void;
  onDelete: (id: string) => void;
}

const SortableBeatCard: React.FC<SortableBeatCardProps> = ({ beat, onUpdate, onDelete }) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: beat.id });

  const wrapStyle: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
    width: beat.cardWidth || undefined,
    flexShrink: 0,
  };

  const handleResize = useCallback(
    (w: number, h: number) => {
      onUpdate(beat.id, { cardWidth: w, cardHeight: h });
    },
    [beat.id, onUpdate],
  );
  const resizePointerDown = useResizeHandle(handleResize);

  return (
    <div ref={setNodeRef} style={wrapStyle} className="beat-card-wrap">
      <BeatCardContent
        beat={beat}
        onUpdate={onUpdate}
        onDelete={onDelete}
        dragHandleProps={{ ...attributes, ...listeners }}
        resizePointerDown={resizePointerDown}
      />
    </div>
  );
};

/* ─── Free-position Beat Card (custom-arrange mode) ─── */
interface FreeBeatCardProps {
  beat: BeatInfo;
  onUpdate: (id: string, updates: Partial<BeatInfo>) => void;
  onDelete: (id: string) => void;
}

/* v2.33 mind-map helpers — pure, exported for the test. (v2.44: the shape
   cycler is gone with the shape feature; connections + emphasis remain.) */
export function toggleMindLink(links: string[] | undefined, target: string): string[] {
  const cur = links ?? [];
  return cur.includes(target) ? cur.filter((x) => x !== target) : [...cur, target];
}

/** v3.25, Derek (task #138 — "fix outline beat linking"): addBeat initializes
 *  every beat at x:0/y:0, so beats never hand-placed on the Freeform canvas
 *  ALL piled onto the same spot at the origin. Perfectly stacked cards made
 *  the Connect drag land on whichever card was on top — linking looked broken
 *  because the targets were unreachable. Beats still at the origin (or with
 *  no coords at all — legacy data) now lay out in a cascade grid (3 across,
 *  then wrap), derived from board order so it's stable across renders; a
 *  beat keeps its stored spot the moment it's dragged anywhere else. (The
 *  one sacrifice: a card deliberately parked at exactly 0,0 re-flows — the
 *  origin is the tool's "never placed" value, it can't also mean "placed
 *  here".) Pure + exported for the test. */
export function freeformAutoLayout(beats: BeatInfo[]): BeatInfo[] {
  let slot = 0;
  return beats.map((b) => {
    const placed = (b.x != null && b.x !== 0) || (b.y != null && b.y !== 0);
    if (placed) return b;
    const i = slot++;
    return { ...b, x: 24 + (i % 3) * 270, y: 24 + Math.floor(i / 3) * 150 };
  });
}
/** Emphasis: the title grows with the card, clamped to stay readable.
 *  v6.55, Derek ("make the beat title smaller so that the area for grabbing
 *  and moving is bigger"): the range came down from 13–24 to 12–16 — a
 *  default card now reads at 13px, the same as every other beat card's
 *  title, and the title bar keeps more bare band to grab. */
export function mindTitleSize(cardWidth: number): number {
  return Math.max(12, Math.min(16, Math.round((cardWidth || 240) / 18)));
}

/* ─── v6.53 connection anchors (Derek: "you place [a circle] anywhere on the
   edge of the first beat … you also choose a space on the edge" of the
   second) ───
   An anchor is stored NORMALIZED to its card's box — ax/ay in 0..1, with one
   of them pinned to 0 or 1 so the point sits ON the perimeter. Normalized
   means a resized or re-typed card keeps its connection where the writer put
   it, in proportion. Pure + exported for the tests. */
export interface CardBox { left: number; top: number; w: number; h: number }

/** The perimeter point nearest a canvas-space pointer. Works from anywhere —
 *  outside the card it projects onto the closest edge. */
export function nearestEdgeAnchor(box: CardBox, px: number, py: number): BeatAnchor {
  const w = Math.max(1, box.w);
  const h = Math.max(1, box.h);
  const rx = Math.min(1, Math.max(0, (px - box.left) / w));
  const ry = Math.min(1, Math.max(0, (py - box.top) / h));
  const dLeft = rx * w;
  const dRight = (1 - rx) * w;
  const dTop = ry * h;
  const dBottom = (1 - ry) * h;
  const nearest = Math.min(dLeft, dRight, dTop, dBottom);
  if (nearest === dLeft) return { ax: 0, ay: ry };
  if (nearest === dRight) return { ax: 1, ay: ry };
  if (nearest === dTop) return { ax: rx, ay: 0 };
  return { ax: rx, ay: 1 };
}

/** Anchor → canvas point. No anchor (every pre-v6.53 link) = the card's
 *  center, which is exactly what those links drew before. */
export function anchorPoint(box: CardBox, a?: BeatAnchor): { x: number; y: number } {
  if (!a) return { x: box.left + box.w / 2, y: box.top + box.h / 2 };
  return { x: box.left + a.ax * box.w, y: box.top + a.ay * box.h };
}

/** v6.53: put the caret where the writer clicked, after a click that turned
 *  out NOT to be a drag. (The header preventDefaults its pointerdown — see
 *  beginCardDrag — so the browser never gets to focus the field itself.) */
function focusTitleAt(input: HTMLInputElement, clientX: number, clientY: number) {
  input.focus();
  const doc = document as Document & { caretRangeFromPoint?: (x: number, y: number) => Range | null };
  let offset = input.value.length;
  try {
    const r = doc.caretRangeFromPoint?.(clientX, clientY);
    if (r && typeof r.startOffset === 'number') offset = Math.min(r.startOffset, input.value.length);
    input.setSelectionRange(offset, offset);
  } catch { /* older engines: focus alone, caret at the end */ }
}

/* v2.46: connecting was arm-then-drag. v6.53, Derek: the Connect button
   moved to the card's BOTTOM-RIGHT corner and the flow is click-place-click
   — click it, place a circle on this card's edge, then place one on the
   other card's edge. The canvas owns that state machine; the card only
   reports its own pointer events and paints the highlights. */
const FreeBeatCard: React.FC<FreeBeatCardProps & {
  armed: boolean;
  linkOrigin: boolean;
  linkTarget: boolean;
  onToggleArm: (id: string) => void;
}> = ({ beat, onUpdate, onDelete, armed, linkOrigin, linkTarget, onToggleArm }) => {
  const dragRef = useRef<{ startX: number; startY: number; beatX: number; beatY: number } | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  const bx = beat.x || 0;
  const by = beat.y || 0;

  /* v6.52: ONE drag engine for the grip and the header row. v6.53 fix,
     Derek ("i still cannot move the cards by dragging the window"): the
     header ALWAYS preventDefaults its pointerdown now. The v6.52 threshold
     mode deliberately let the default through so the title could focus —
     which handed the gesture to the browser's native text-selection drag
     inside that input, and the card never moved. Nothing native starts
     here any more; a press that never travels far enough to be a drag is
     replayed as a click through opts.onTap (which focuses the title and
     places the caret). */
  const beginCardDrag = useCallback(
    (e: React.PointerEvent, opts?: { threshold?: number; onTap?: (ev: PointerEvent) => void }) => {
      e.preventDefault();
      e.stopPropagation();
      const threshold = opts?.threshold ?? 0;
      let engaged = threshold === 0;
      dragRef.current = { startX: e.clientX, startY: e.clientY, beatX: bx, beatY: by };

      const onMove = (ev: PointerEvent) => {
        if (!dragRef.current) return;
        if (!engaged) {
          if (Math.abs(ev.clientX - dragRef.current.startX) < threshold
            && Math.abs(ev.clientY - dragRef.current.startY) < threshold) return;
          engaged = true;
        }
        const newX = Math.max(0, dragRef.current.beatX + (ev.clientX - dragRef.current.startX));
        const newY = Math.max(0, dragRef.current.beatY + (ev.clientY - dragRef.current.startY));
        onUpdate(beat.id, { x: newX, y: newY });
      };
      const onUp = (ev: PointerEvent) => {
        dragRef.current = null;
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onUp);
        if (!engaged) opts?.onTap?.(ev);
      };
      document.addEventListener('pointermove', onMove);
      document.addEventListener('pointerup', onUp);
    },
    [beat.id, bx, by, onUpdate],
  );

  /* v6.52, Derek: "allow dragging the freeform cards from the top of each
     card, like all windows work" — the whole header row drags, buttons keep
     their jobs (the window-header guard). v6.53: over the TITLE the press
     starts a 4px-threshold drag with a tap fallback that focuses the field
     and drops the caret where you clicked; once the title HAS focus it is
     being edited, so text selection wins there. */
  const onHeaderPointerDown = useCallback((e: React.PointerEvent) => {
    const t = e.target as HTMLElement;
    if (t.closest('button')) return;
    if (t.classList.contains('beat-card-title')) {
      if (document.activeElement === t) return;
      beginCardDrag(e, {
        threshold: 4,
        onTap: (ev) => focusTitleAt(t as HTMLInputElement, ev.clientX, ev.clientY),
      });
      return;
    }
    beginCardDrag(e);
  }, [beginCardDrag]);

  /* v6.53, Derek: "freeform beat windows should also be able to change size
     by adjusting any side of the window" — the shared EdgeResizeZones the
     tool windows use (v5.46), so the card resizes from any edge or corner
     and the west/north edges move x/y as they shrink. The card's geometry
     IS its store fields, so apply() writes them straight through. */
  const beginEdge = useCallback((zone: EdgeZone, e: React.PointerEvent) => {
    const el = wrapRef.current;
    startEdgeResize(e, zone, {
      rect: () => ({
        left: bx,
        top: by,
        w: beat.cardWidth || el?.offsetWidth || 240,
        // an auto-height card has no stored height until it is resized once
        h: beat.cardHeight || el?.offsetHeight || 110,
      }),
      min: { w: 160, h: 90 },
      apply: (g) => onUpdate(beat.id, {
        x: Math.max(0, g.left), y: Math.max(0, g.top), cardWidth: g.w, cardHeight: g.h,
      }),
    });
  }, [beat.id, beat.cardWidth, beat.cardHeight, bx, by, onUpdate]);

  const wrapStyle: React.CSSProperties = {
    position: 'absolute',
    left: bx,
    top: by,
    width: beat.cardWidth || 240,
    zIndex: 1,
    // v2.33: emphasis — the title scales with the card's size.
    ['--mind-title-size' as string]: `${mindTitleSize(beat.cardWidth)}px`,
  };

  return (
    <div
      ref={wrapRef}
      style={wrapStyle}
      className={`beat-card-wrap beat-card-wrap-free${armed ? ' mind-armed' : ''}${linkOrigin ? ' mind-link-origin' : ''}${linkTarget ? ' mind-link-target' : ''}`}
      data-beat-id={beat.id}
    >
      <BeatCardContent
        beat={beat}
        onUpdate={onUpdate}
        onDelete={onDelete}
        headerDragProps={{ onPointerDown: onHeaderPointerDown, style: { touchAction: 'none' } }}
      />
      {/* v6.53: any-edge resize replaces the corner grip (which the Connect
          button now occupies). */}
      <EdgeResizeZones onStart={beginEdge} />
      <button
        className={`beat-card-linkbtn${armed ? ' active' : ''}`}
        title={armed
          ? ''
          : 'Connect beats'}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => { e.stopPropagation(); onToggleArm(beat.id); }}
      ><FaLink /></button>
    </div>
  );
};

/* ─── DragOverlay card ─── */
const BeatCardOverlay: React.FC<{ beat: BeatInfo }> = ({ beat }) => (
  <div className="beat-card beat-card-overlay" style={beat.color ? { background: beat.color, color: readableTextOn(beat.color) } : {}}>
    <div className="beat-card-top"><span className="beat-drag-icon">⋮⋮</span><input className="beat-card-title" value={beat.title} readOnly /></div>
  </div>
);

/* ─── Custom Canvas (free-form mode) ─── */
interface CustomCanvasProps {
  beats: BeatInfo[];
  onUpdateBeat: (id: string, updates: Partial<BeatInfo>) => void;
  onDeleteBeat: (id: string) => void;
}

const CustomCanvas: React.FC<CustomCanvasProps> = ({
  beats: rawBeats, onUpdateBeat, onDeleteBeat,
}) => {
  // v3.25 (task #138): unplaced beats get a derived cascade position so they
  // never stack — see freeformAutoLayout. Everything below (cards, line
  // endpoints, the drag maths) reads these effective coordinates.
  const beats = useMemo(() => freeformAutoLayout(rawBeats), [rawBeats]);
  /* v2.46 connected by arm-then-drag. v6.53, Derek: CLICK-PLACE-CLICK —
     the Connect button (bottom-right corner) starts it, the next click
     places the circle on THIS card's edge, and the click after that places
     one on the other card's edge; both anchors are stored on the source
     beat (mindAnchors, keyed by target). Click a line to SELECT it, then
     Delete/Backspace removes it. Coordinates are canvas-content space:
     client minus the canvas rect, plus its scroll — the same space the
     beats' x/y live in. */
  const canvasRef = useRef<HTMLDivElement>(null);
  const [linkPlace, setLinkPlace] = useState<{ fromId: string; from?: BeatAnchor } | null>(null);
  const [pointer, setPointer] = useState<{ x: number; y: number } | null>(null);
  /** The edge circle under the pointer right now (which card, and where). */
  const [preview, setPreview] = useState<{ id: string; a: BeatAnchor } | null>(null);
  const [selectedLine, setSelectedLine] = useState<{ fromId: string; toId: string } | null>(null);

  /* v6.53: MEASURED card boxes. Anchors are normalized to a card's real box,
     so a guessed height (the old `cardHeight || 110`) would float the circle
     off the card's edge — and it was already skewing every line's endpoints.
     One observer over the canvas keeps the real sizes. */
  const [boxes, setBoxes] = useState<Record<string, { w: number; h: number }>>({});
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const read = () => {
      const next: Record<string, { w: number; h: number }> = {};
      canvas.querySelectorAll<HTMLElement>('[data-beat-id]').forEach((el) => {
        const id = el.getAttribute('data-beat-id');
        if (id) next[id] = { w: el.offsetWidth, h: el.offsetHeight };
      });
      setBoxes((prev) => {
        const ids = Object.keys(next);
        const same = ids.length === Object.keys(prev).length
          && ids.every((id) => prev[id] && prev[id].w === next[id].w && prev[id].h === next[id].h);
        return same ? prev : next;
      });
    };
    read();
    if (typeof ResizeObserver === 'undefined') return;          // jsdom
    const ro = new ResizeObserver(read);
    canvas.querySelectorAll('[data-beat-id]').forEach((el) => ro.observe(el));
    return () => ro.disconnect();
  }, [beats]);

  const boxOf = useCallback((b: BeatInfo): CardBox => ({
    left: b.x || 0,
    top: b.y || 0,
    w: boxes[b.id]?.w || b.cardWidth || 240,
    h: boxes[b.id]?.h || b.cardHeight || 110,
  }), [boxes]);

  const toCanvas = useCallback((ev: { clientX: number; clientY: number }) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const r = canvas.getBoundingClientRect();
    return { x: ev.clientX - r.left + canvas.scrollLeft, y: ev.clientY - r.top + canvas.scrollTop };
  }, []);

  const cardUnder = useCallback((clientX: number, clientY: number): string | null => {
    const hit = (document.elementFromPoint(clientX, clientY) as HTMLElement | null)?.closest('[data-beat-id]');
    return hit?.getAttribute('data-beat-id') ?? null;
  }, []);

  const handleToggleArm = useCallback((id: string) => {
    setLinkPlace((cur) => (cur && cur.fromId === id ? null : { fromId: id }));
  }, []);

  /* While placing, the circle follows the pointer along the relevant card's
     perimeter: the ORIGIN's while you pick the start, then whichever card
     you hover while you pick the end. */
  useEffect(() => {
    if (!linkPlace) { setPointer(null); setPreview(null); return; }
    const onMove = (ev: PointerEvent) => {
      const p = toCanvas(ev);
      setPointer(p);
      if (!linkPlace.from) {
        const b = beats.find((x) => x.id === linkPlace.fromId);
        setPreview(b ? { id: b.id, a: nearestEdgeAnchor(boxOf(b), p.x, p.y) } : null);
        return;
      }
      const id = cardUnder(ev.clientX, ev.clientY);
      const target = id && id !== linkPlace.fromId ? beats.find((x) => x.id === id) : null;
      setPreview(target ? { id: target.id, a: nearestEdgeAnchor(boxOf(target), p.x, p.y) } : null);
    };
    document.addEventListener('pointermove', onMove);
    return () => document.removeEventListener('pointermove', onMove);
  }, [linkPlace, beats, boxOf, toCanvas, cardUnder]);

  /** Every click while a connection is being placed lands here first (the
   *  canvas takes it in the CAPTURE phase, so no card drag starts). */
  const handlePlaceClick = useCallback((e: React.PointerEvent) => {
    if (!linkPlace) return;
    e.preventDefault();
    e.stopPropagation();
    // the Connect button stays a toggle at every stage
    if ((e.target as HTMLElement).closest('.beat-card-linkbtn')) { setLinkPlace(null); return; }
    const p = toCanvas(e);
    if (!linkPlace.from) {
      const b = beats.find((x) => x.id === linkPlace.fromId);
      if (!b) { setLinkPlace(null); return; }
      setLinkPlace({ fromId: b.id, from: nearestEdgeAnchor(boxOf(b), p.x, p.y) });
      return;
    }
    const targetId = cardUnder(e.clientX, e.clientY);
    const target = targetId && targetId !== linkPlace.fromId ? beats.find((x) => x.id === targetId) : null;
    if (!target) { setLinkPlace(null); return; }        // clicked away = cancel
    const toAnchor = nearestEdgeAnchor(boxOf(target), p.x, p.y);
    // Read the LATEST links from the store — this closure's beats can be a
    // render behind. Adding only; an existing pair in either direction is
    // left alone so the same connection can't be drawn twice.
    const st = useEditorStore.getState();
    const from = st.beats.find((b) => b.id === linkPlace.fromId);
    const already = !!from && ((from.mindLinks ?? []).includes(target.id)
      || ((st.beats.find((b) => b.id === target.id)?.mindLinks) ?? []).includes(from.id));
    if (from && !already && linkPlace.from) {
      onUpdateBeat(from.id, {
        mindLinks: [...(from.mindLinks ?? []), target.id],
        mindAnchors: { ...(from.mindAnchors ?? {}), [target.id]: { from: linkPlace.from, to: toAnchor } },
      });
    }
    setLinkPlace(null);
  }, [linkPlace, beats, boxOf, toCanvas, cardUnder, onUpdateBeat]);

  /** Drop a link and the anchors that positioned it. */
  const removeLink = useCallback((fromId: string, toId: string) => {
    const from = useEditorStore.getState().beats.find((b) => b.id === fromId);
    if (!from) return;
    const anchors = { ...(from.mindAnchors ?? {}) };
    delete anchors[toId];
    onUpdateBeat(fromId, { mindLinks: toggleMindLink(from.mindLinks, toId), mindAnchors: anchors });
  }, [onUpdateBeat]);

  /* Delete/Backspace removes the selected line; Escape clears selection and
     cancels a half-placed connection. Never while typing in a field. */
  useEffect(() => {
    if (!selectedLine && !linkPlace) return;
    const handler = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (e.key === 'Escape') {
        setSelectedLine(null);
        setLinkPlace(null);
        return;
      }
      if (selectedLine && (e.key === 'Delete' || e.key === 'Backspace')) {
        e.preventDefault();
        removeLink(selectedLine.fromId, selectedLine.toId);
        setSelectedLine(null);
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [selectedLine, linkPlace, removeLink]);

  const lines: Array<{ from: BeatInfo; to: BeatInfo; anchors?: { from: BeatAnchor; to: BeatAnchor } }> = [];
  for (const b of beats) {
    for (const t of b.mindLinks ?? []) {
      const other = beats.find((x) => x.id === t);
      if (other) lines.push({ from: b, to: other, anchors: b.mindAnchors?.[t] });
    }
  }

  const placeFrom = linkPlace ? beats.find((b) => b.id === linkPlace.fromId) : null;
  const previewBeat = preview ? beats.find((b) => b.id === preview.id) : null;
  const previewPt = preview && previewBeat ? anchorPoint(boxOf(previewBeat), preview.a) : null;
  const fixedPt = placeFrom && linkPlace?.from ? anchorPoint(boxOf(placeFrom), linkPlace.from) : null;

  return (
    <div
      className={`beat-custom-canvas${linkPlace ? ' mind-linking' : ''}`}
      ref={canvasRef}
      /* v6.53: while a connection is being placed the canvas takes the click
         in the CAPTURE phase, so it lands on an edge instead of starting a
         card drag. Otherwise a click on empty canvas just deselects. */
      onPointerDownCapture={linkPlace ? handlePlaceClick : undefined}
      onPointerDown={(e) => {
        if (e.target === e.currentTarget || (e.target as HTMLElement).classList?.contains('mind-lines')) {
          setSelectedLine(null);
          setLinkPlace(null);
        }
      }}
    >
      <svg className="mind-lines" aria-hidden="true">
        {lines.map(({ from, to, anchors }) => {
          // v6.53: draw between the chosen edge points; a link made before
          // anchors existed has none and still runs center to center.
          const a = anchorPoint(boxOf(from), anchors?.from);
          const b = anchorPoint(boxOf(to), anchors?.to);
          const selected = selectedLine?.fromId === from.id && selectedLine?.toId === to.id;
          return (
            <g
              key={`${from.id}-${to.id}`}
              className={selected ? 'selected' : undefined}
              onClick={(e) => { e.stopPropagation(); setSelectedLine({ fromId: from.id, toId: to.id }); }}
            >
              {/* Fat invisible twin makes the 1.5px line clickable. */}
              <line className="mind-line-hit" x1={a.x} y1={a.y} x2={b.x} y2={b.y} />
              <line x1={a.x} y1={a.y} x2={b.x} y2={b.y}>
                <title>Click to select — press Delete to remove</title>
              </line>
              <circle className="mind-line-dot" cx={a.x} cy={a.y} r={3} />
              <circle className="mind-line-dot" cx={b.x} cy={b.y} r={3} />
            </g>
          );
        })}
        {/* The line being placed: from the fixed start circle to the target
            circle under the pointer (or to the pointer itself). */}
        {fixedPt && (pointer || previewPt) && (
          <line
            className="mind-line-draft"
            x1={fixedPt.x} y1={fixedPt.y}
            x2={(previewPt ?? pointer)!.x} y2={(previewPt ?? pointer)!.y}
          />
        )}
        {fixedPt && <circle className="mind-anchor-set" cx={fixedPt.x} cy={fixedPt.y} r={5} />}
        {previewPt && <circle className="mind-anchor-preview" cx={previewPt.x} cy={previewPt.y} r={6} />}
      </svg>
      {beats.map((beat) => (
        <FreeBeatCard
          key={beat.id}
          beat={beat}
          onUpdate={onUpdateBeat}
          onDelete={onDeleteBeat}
          /* armed = this card's edge is the one being picked; linkOrigin =
             its start circle is set and the line is out looking for a home. */
          armed={!!linkPlace && linkPlace.fromId === beat.id && !linkPlace.from}
          linkOrigin={!!linkPlace?.from && linkPlace.fromId === beat.id}
          linkTarget={!!linkPlace?.from && preview?.id === beat.id}
          onToggleArm={handleToggleArm}
        />
      ))}
    </div>
  );
};

/* ─── Custom collision detection: prefer beat cards, fallback to column droppables ─── */
const beatCollisionDetection: CollisionDetection = (args) => {
  const centerCollisions = closestCenter(args);
  if (centerCollisions.length > 0) return centerCollisions;
  return pointerWithin(args);
};

/* ─── Outline header controls (v2.41) ───
   Beat count, Arrangement toggle, ? help, Presets and the add button — ONE
   component, rendered in the tool window's chrome (TOOL_CHROME Controls slot)
   and in the takeover view's own row. Everything reads the store directly. */
/* v2.48, Derek: Presets and the add button live in the TABS row now,
   right-aligned — this component renders them there, in both arrangements. */
export function OutlineTabActions() {
  const beatArrangeMode = useEditorStore((s) => s.beatArrangeMode);
  const customPresets = useOutlinePresetStore((s) => s.presets);

  const handlePresetAction = useCallback(async (value: string) => {
    if (!value) return;
    const store = useOutlinePresetStore.getState();
    if (value === '__save') {
      const cols = [...useEditorStore.getState().beatColumns].sort((a, b) => a.position - b.position);
      if (cols.length === 0) { showToast('Nothing to save — the outline has no sections yet.', 'error'); return; }
      const name = await promptDialog('Name this preset', 'My Structure', { title: 'Save Outline Preset', confirmLabel: 'Save' });
      if (!name || !name.trim()) return;
      store.savePreset(name, cols.map((c) => c.title), cols.map((c) => c.targetPages ?? 1));
      showToast(`Preset "${name.trim()}" saved.`, 'success');
      return;
    }
    if (value === '__export') {
      /* v7.28, Derek's ONE PRESET EXPORT WINDOW: outline presets are the
         `outline` category. This ran its own saveFile before — the fourth
         and last door that did. */
      useEditorStore.getState().openPresetExport(['outline']);
      return;
    }
    if (value === '__import') {
      try {
        const file = await openTextFile([{ name: 'Outline Presets', extensions: ['json'] }]);
        if (!file) return;
        const result = store.importPresets(file.content);
        if (result.error) showToast(result.error, 'error');
        else showToast(`Imported ${result.added} preset${result.added === 1 ? '' : 's'}${result.skipped ? ` (${result.skipped} skipped)` : ''}.`, result.added > 0 ? 'success' : 'info');
      } catch (err) {
        showToast(`Import failed: ${err instanceof Error ? err.message : String(err)}`, 'error');
      }
      return;
    }
    // A preset id (built-in or custom:<id>) — v2.23 override rules apply.
    if (useEditorStore.getState().beatColumns.length === 0) { applyOutlinePreset(value); return; }
    const ok = await confirmDialog(
      'This preset will replace your current sections. Your beats are NOT deleted — this preset moves them into its own sections and re-fits their page estimates to the new structure.',
      { title: 'Replace the current outline?', confirmLabel: 'Replace Sections', danger: true },
    );
    if (ok) applyOutlinePreset(value, 'override');
  }, []);

  const handleAddColumn = useCallback(() => {
    const st = useEditorStore.getState();
    st.addBeatColumn(`Section ${st.beatColumns.length + 1}`);
  }, []);

  const handleAddBeatFree = useCallback(() => {
    const st = useEditorStore.getState();
    const sorted = [...st.beatColumns].sort((a, b) => a.position - b.position);
    const colId = sorted[0]?.id || st.addBeatColumn('Section 1');
    const offset = (st.beats.length % 10) * 30;
    st.addBeat('New Beat', colId);
    setTimeout(() => {
      const store = useEditorStore.getState();
      const latest = store.beats[store.beats.length - 1];
      if (latest && (latest.x || 0) === 0 && (latest.y || 0) === 0) {
        store.updateBeat(latest.id, { x: 40 + offset, y: 40 + offset });
      }
    }, 0);
  }, []);

  return (
    <span className="beat-tabs-actions">
      {/* v6.50, Derek: the add button leads (far left), Presets follows
          with its own breathing room (the CSS margin). */}
      {beatArrangeMode === 'auto' ? (
        // v6.38, Derek: the standard blue primary look (fs-btn-primary) —
        // both modes' add button, one slot.
        <button className="beat-board-add-col-btn fs-btn-primary" onClick={handleAddColumn}>+ Add Section</button>
      ) : (
        <button className="beat-board-add-col-btn fs-btn-primary" onClick={handleAddBeatFree}>+ Add Beat</button>
      )}
      {beatArrangeMode === 'auto' && (
        <select
          className="beat-board-preset"
          value=""
          title="Apply an outline structure, or save your own"
          onChange={(e) => { void handlePresetAction(e.target.value); }}
        >
          <option value="">Presets…</option>
          <optgroup label="Built-in">
            {OUTLINE_PRESETS.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </optgroup>
          {customPresets.length > 0 && (
            <optgroup label="My Presets">
              {customPresets.map((p) => (
                <option key={p.id} value={`custom:${p.id}`}>{p.name}</option>
              ))}
            </optgroup>
          )}
          <optgroup label="Manage">
            <option value="__save">Save current as preset…</option>
            {customPresets.length > 0 && <option value="__export">Export my presets…</option>}
            <option value="__import">Import presets…</option>
          </optgroup>
        </select>
      )}
    </span>
  );
}

/* v6.48 put a "Show in Outline Bar" checkbox in the header; v6.49 moved it
   to the body's first row, right-aligned (Derek). Semantics unchanged: it
   says whether the tab you're LOOKING AT feeds the Outline Bar. Exactly one
   tab always does, so the box can't be unchecked directly — you check it on
   another tab instead (the title explains). */
export function OutlineBarCheck() {
  const viewedTab = useEditorStore((s) => s.viewedOutlineTab);
  const barTab = useEditorStore((s) => s.outlineBarTab);
  const isBarTab = barTab === viewedTab;
  return (
    <label
      className={`beat-bar-check${isBarTab ? ' on' : ''}`}
      title={isBarTab
        ? 'The Outline Bar shows this tab'
        : 'Show this tab in the Outline Bar'}
    >
      <input
        type="checkbox"
        checked={isBarTab}
        disabled={isBarTab}
        onChange={() => useEditorStore.getState().setOutlineBarTab(viewedTab)}
      />
      Use this variation in the outline toolbar
    </label>
  );
}

export function OutlineHeaderControls() {
  const beatArrangeMode = useEditorStore((s) => s.beatArrangeMode);
  const goToArrangement = useEditorStore((s) => s.goToArrangement);
  /* v6.49, Derek: search + color filter in the header (standard cluster
     order Filter · View · Search). Transient store state — the board body
     reads the same fields to hide non-matching cards. */
  const beats = useEditorStore((s) => s.beats);
  const beatSearch = useEditorStore((s) => s.beatSearch);
  const setBeatSearch = useEditorStore((s) => s.setBeatSearch);
  const beatColorFilter = useEditorStore((s) => s.beatColorFilter);
  const { toggleBeatColorFilter, clearBeatColorFilter } = useEditorStore.getState();
  // The Filter menu lists the colors this outline actually uses (plus
  // Uncolored when uncolored beats exist) — like Characters' data-derived
  // relationship types, not the whole palette.
  const colorsInUse = BEAT_COLORS.filter((c) => beats.some((b) => (b.color || '') === c));

  /* Derek's rule: helper info lives behind a ? button, not on screen. */
  const [helpOpen, setHelpOpen] = useState(false);
  const helpBtnRef = useRef<HTMLButtonElement>(null);
  const [helpPos, setHelpPos] = useState<{ top: number; left: number } | null>(null);
  useEffect(() => {
    if (!helpOpen) return;
    const close = (e: PointerEvent) => {
      const t = e.target as HTMLElement;
      if (!t.closest('.fs-help-pop') && t !== helpBtnRef.current) setHelpOpen(false);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [helpOpen]);
  const toggleHelp = () => {
    if (!helpOpen && helpBtnRef.current) {
      const r = helpBtnRef.current.getBoundingClientRect();
      setHelpPos({ top: r.bottom + 6, left: Math.max(8, Math.min(r.left - 120, window.innerWidth - 288)) });
    }
    setHelpOpen((v) => !v);
  };

  /* v6.49, Derek: the header carries the standard control cluster now —
     Filter · View · Search (+ the ? at the very end). The Arrangement
     buttons became the View dropdown; Presets/Add and the bar checkbox
     moved down to the body's first row. v6.52: the beat count moved LEFT,
     beside the tab strip (OutlineBeatCount) — this cluster starts at View. */
  return (
    <span className="beat-header-controls">
      {/* v5.80's canonical cluster order: View · Filter · Sort · Search.
          v6.50, Derek: the trigger shows just the CURRENT view (icon +
          name, the Characters-window pattern) — no "View" word. v2.47's
          rule still holds: a tab is bound to its arrangement for life, so
          picking a view NAVIGATES — it jumps to a tab of the asked-for
          arrangement, creating one if none exists. */}
      <ControlDropdown
        title="View"
        icon={beatArrangeMode === 'auto' ? <LuColumns3 /> : <LuWaypoints />}
        current={beatArrangeMode === 'auto' ? 'Sections' : 'Freeform'}
        items={[
          { label: 'Sections', icon: <LuColumns3 />, active: beatArrangeMode === 'auto', onSelect: () => goToArrangement('auto') },
          { label: 'Freeform', icon: <LuWaypoints />, active: beatArrangeMode === 'custom', onSelect: () => goToArrangement('custom') },
        ]}
      />
      <ControlDropdown
        label="Filter"
        chip={beatColorFilter.length}
        items={[
          { label: 'All colors', active: beatColorFilter.length === 0, onSelect: clearBeatColorFilter },
          ...colorsInUse.map((c) => ({
            label: BEAT_COLOR_NAMES[c] ?? c,
            active: beatColorFilter.includes(c),
            keepOpen: true,
            swatch: c || 'transparent',
            onSelect: () => toggleBeatColorFilter(c),
          })),
        ]}
      />
      <ControlSearch value={beatSearch} onChange={setBeatSearch} placeholder="Search beats..." />
      <button ref={helpBtnRef} className="fs-help-btn" title="How to use the Outline" onClick={toggleHelp}><FaRegQuestionCircle /></button>
      {/* v6.51: the body rides ht() so the Helper Text window can edit it —
          the TypewriterTool convention this popover had missed. */}
      {helpOpen && helpPos && createPortal(
        <div className="fs-help-pop" style={{ top: helpPos.top, left: helpPos.left }}>
          {ht('Create sections (Act 1, Act 2…) and drop beats into them. Create manually or pick a Preset.')}
        </div>,
        document.body,
      )}
    </span>
  );
}

/* ─── v6.48: the variation tabs live in the WINDOW HEADER (Derek: "move
   outline tabs to header like all other windows"). The tab DATA feeds the
   shared ChromeTabs strip via TOOL_CHROME.useTabs; rename (double-click),
   delete (×) and the + button ride the shared strip's optional slots. The
   takeover view has no chrome, so it keeps an in-board copy of the same
   row (see BeatBoard below). */

async function confirmDeleteOutlineTab(id: string, name: string): Promise<void> {
  const ok = await confirmDialog(
    `Delete "${name}"? Your beats are safe — they live in every tab. Only this arrangement of sections is deleted.`,
    { title: 'Delete Outline Tab', confirmLabel: 'Delete Tab', danger: true },
  );
  if (ok) useEditorStore.getState().deleteOutlineTab(id);
}

export function useOutlineTabs(): ToolChromeTab[] {
  const outlineTabs = useEditorStore((s) => s.outlineTabs);
  const viewedTab = useEditorStore((s) => s.viewedOutlineTab);
  const { switchOutlineTab, renameOutlineTab } = useEditorStore.getState();
  return outlineTabs.map((t) => ({
    key: t.id,
    label: t.name,
    active: viewedTab === t.id,
    onSelect: () => switchOutlineTab(t.id),
    onRename: (name: string) => renameOutlineTab(t.id, name),
    onClose: outlineTabs.length > 1 ? () => { void confirmDeleteOutlineTab(t.id, t.name); } : undefined,
    closeTitle: 'Delete this outline variation. Beats are not deleted',
  }));
}

/** v6.52, Derek: the beat count sits LEFT — right of the tab strip — in the
 *  window header and the takeover's tabs row alike. Shows "M of N" while
 *  the header search/filter narrows the board. */
export function OutlineBeatCount() {
  const beatCount = useEditorStore((s) => s.beats.length);
  const beats = useEditorStore((s) => s.beats);
  const beatSearch = useEditorStore((s) => s.beatSearch);
  const beatColorFilter = useEditorStore((s) => s.beatColorFilter);
  const filterActive = beatSearch.trim() !== '' || beatColorFilter.length > 0;
  const shown = filterActive
    ? beats.filter((b) => beatMatchesFilter(b, beatSearch, beatColorFilter)).length
    : beatCount;
  return (
    <span className="beat-board-info">
      {filterActive
        ? `${shown} of ${beatCount} beat${beatCount !== 1 ? 's' : ''}`
        : `${beatCount} beat${beatCount !== 1 ? 's' : ''}`}
    </span>
  );
}

/** The + (new variation) button, hugging the header tab strip — INSIDE its
 *  bordered pill, since it reads as one of the tabs. (v6.56, Derek: the beat
 *  count moved out of that pill — it was picking up the border as a box —
 *  and rides the AfterTabs slot instead.) */
export function OutlineTabsExtra() {
  return (
    <button
      className="beat-tab-add"
      title="New outline variation"
      onClick={() => useEditorStore.getState().addOutlineTab()}
    >+</button>
  );
}

/* ─── Main Beat Board ─── */
const BeatBoard: React.FC<{ embedded?: boolean }> = ({ embedded = false }) => {
  const {
    beats, beatBoardOpen, beatColumns, beatArrangeMode,
    addBeat, updateBeat, deleteBeat, setBeats,
    updateBeatColumn, deleteBeatColumn,
    beatUndo, beatRedo,
  } = useEditorStore();

  const boardRef = useRef<HTMLDivElement>(null);
  const [activeDragId, setActiveDragId] = useState<string | null>(null);
  const [maximizedColumnId, setMaximizedColumnId] = useState<string | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  );

  // Undo/redo + Escape keyboard shortcuts — only when focus is inside the beat board
  useEffect(() => {
    // v2.36: the takeover board AND the embedded Outline window both listen.
    if (!beatBoardOpen && !embedded) return;
    const handler = (e: KeyboardEvent) => {
      // Escape restores maximized column
      if (e.key === 'Escape' && maximizedColumnId) {
        e.preventDefault();
        setMaximizedColumnId(null);
        return;
      }
      // v2.36: after closing a beat the focused button is GONE and focus
      // falls to <body> — undo must still reach the beat history.
      const ae = document.activeElement;
      if (!(boardRef.current?.contains(ae) || ae === document.body || ae === null)) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        e.stopPropagation();
        beatUndo();
      } else if (mod && ((e.key === 'z' && e.shiftKey) || e.key === 'y')) {
        e.preventDefault();
        e.stopPropagation();
        beatRedo();
      }
    };
    document.addEventListener('keydown', handler, true);
    return () => document.removeEventListener('keydown', handler, true);
  }, [beatBoardOpen, embedded, beatUndo, beatRedo, maximizedColumnId]);

  const sortedColumns = [...beatColumns].sort((a, b) => a.position - b.position);
  // v2.23: beats with no section (v6.60: including the ones a deleted
  // section left behind) wait in "Unsorted".
  const orphanBeats = unsortedBeats(beats, beatColumns);
  /* v6.61: Unsorted is a phantom column — there is no column record to hold
     a width, so its own is a view preference. 0 = the shared default. */
  const unsortedWidth = useEditorStore((s) => s.outlineUnsortedWidth);
  const setUnsortedWidth = useEditorStore((s) => s.setOutlineUnsortedWidth);
  const unsortedResizePointerDown = useColumnResize(setUnsortedWidth);

  /* v6.49: the header's search + color filter hide non-matching cards in
     every view — sections, Unsorted and the freeform canvas alike. */
  const beatSearch = useEditorStore((s) => s.beatSearch);
  const beatColorFilter = useEditorStore((s) => s.beatColorFilter);
  const matchesFilter = useCallback(
    (b: BeatInfo) => beatMatchesFilter(b, beatSearch, beatColorFilter),
    [beatSearch, beatColorFilter],
  );
  const visibleOrphans = orphanBeats.filter(matchesFilter);

  // v2.30: outline variation tabs — one beat pool, many arrangements.
  // (v6.48: the window renders them in its chrome header; only the takeover
  // still reads these for its in-board row.)
  const outlineTabs = useEditorStore((s) => s.outlineTabs);
  const viewedTab = useEditorStore((s) => s.viewedOutlineTab);
  const { addOutlineTab, switchOutlineTab, renameOutlineTab } = useEditorStore.getState();
  const [renamingTab, setRenamingTab] = useState<string | null>(null);

  /* v2.45: remember whether Unsorted was showing when the drag began —
     see keepUnsortedMounted. */
  const [dragStartedWithOrphans, setDragStartedWithOrphans] = useState(false);

  /* v6.62, Derek: "when i deleted the Act II column, instead of the beats
     going to the unsorted section, they went into the act I column instead."
     They had NOT — the store put them in Unsorted. The layout lied: a lone
     section takes flex:1 and wraps its cards into a grid, so deleting the
     second-to-last section blew a 20-card list open into a wide block that
     read as "everything landed here". Unsorted IS a column on the board, so
     a section is only the single column when Unsorted isn't up. ONE source
     for that, read by the layout and by the render below. */
  const unsortedShowing = keepUnsortedMounted(orphanBeats.length, activeDragId !== null, dragStartedWithOrphans);
  const isSingleColumn = sortedColumns.length === 1 && !unsortedShowing;

  const handleDragStart = useCallback((e: DragStartEvent) => {
    setActiveDragId(String(e.active.id));
    const st = useEditorStore.getState();
    setDragStartedWithOrphans(unsortedBeats(st.beats, st.beatColumns).length > 0);
  }, []);

  const handleDragCancel = useCallback(() => setActiveDragId(null), []);

  const handleDragOver = useCallback(
    (event: DragOverEvent) => {
      const { active, over } = event;
      if (!over) return;
      const activeBeat = beats.find((b) => b.id === active.id);
      if (!activeBeat) return;

      const overId = String(over.id);

      // Check if dragging over a beat in a different column
      const overBeat = beats.find((b) => b.id === overId);
      if (overBeat && overBeat.columnId !== activeBeat.columnId) {
        setBeats(beats.map((b) => b.id === activeBeat.id ? { ...b, columnId: overBeat.columnId } : b));
        return;
      }

      // Check if dragging over an empty column droppable (id starts with "column-drop-")
      if (overId.startsWith('column-drop-')) {
        const targetColId = overId.replace('column-drop-', '');
        if (targetColId !== activeBeat.columnId) {
          setBeats(beats.map((b) => b.id === activeBeat.id ? { ...b, columnId: targetColId, position: 0 } : b));
        }
      }
    },
    [beats, setBeats],
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      setActiveDragId(null);
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      const activeBeat = beats.find((b) => b.id === active.id);
      const overBeat = beats.find((b) => b.id === over.id);
      if (!activeBeat || !overBeat) return;

      const columnId = overBeat.columnId;
      const updated = beats.map((b) => b.id === activeBeat.id ? { ...b, columnId } : b);
      const colBeats = updated.filter((b) => b.columnId === columnId).sort((a, b) => a.position - b.position);
      const oldIdx = colBeats.findIndex((b) => b.id === active.id);
      const newIdx = colBeats.findIndex((b) => b.id === over.id);
      if (oldIdx === -1 || newIdx === -1) return;
      const reordered = arrayMove(colBeats, oldIdx, newIdx);
      const posMap = new Map(reordered.map((b, i) => [b.id, i]));
      setBeats(updated.map((b) => { const p = posMap.get(b.id); return p !== undefined ? { ...b, position: p } : b; }));
    },
    [beats, setBeats],
  );

  const activeBeat = activeDragId ? beats.find((b) => b.id === activeDragId) : null;


  if (!beatBoardOpen && !embedded) return null;

  return (
    <div className="beat-board" ref={boardRef}>
      {/* v2.41, Derek: the controls live in the WINDOW HEADER (chrome) when
          this board is the docked/popped Outline window — TOOL_CHROME
          hosts OutlineHeaderControls there. The takeover view has no chrome,
          so it keeps its own row, same component. */}
      {!embedded && (
        <div className="beat-board-header">
          <OutlineHeaderControls />
        </div>
      )}
      {/* v6.48, Derek: in the Outline WINDOW the variation tabs render in
          the window header (TOOL_CHROME.useTabs → the shared ChromeTabs
          strip), so this in-board row only remains for the chrome-less
          takeover view. The per-tab ◉ is gone from both — the header's
          "Show in Outline Bar" checkbox owns that choice now, and Presets +
          Add moved into the header controls. */}
      {!embedded && (
        <div className="beat-tabs">
          {outlineTabs.map((t) => (
            <div
              key={t.id}
              className={`beat-tab${viewedTab === t.id ? ' active' : ''}`}
              onClick={() => switchOutlineTab(t.id)}
              onDoubleClick={() => setRenamingTab(t.id)}
              title={viewedTab === t.id ? t.name : `Switch to ${t.name}`}
            >
              {renamingTab === t.id ? (
                <input
                  autoFocus
                  className="beat-tab-rename"
                  defaultValue={t.name}
                  onClick={(e) => e.stopPropagation()}
                  onBlur={(e) => { renameOutlineTab(t.id, e.target.value); setRenamingTab(null); }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                    if (e.key === 'Escape') setRenamingTab(null);
                  }}
                />
              ) : (
                <span className="beat-tab-name">{t.name}</span>
              )}
              {outlineTabs.length > 1 && (
                <button
                  className="beat-tab-x"
                  title="Delete this outline variation. Beats are not deleted"
                  onClick={(e) => { e.stopPropagation(); void confirmDeleteOutlineTab(t.id, t.name); }}
                >×</button>
              )}
            </div>
          ))}
          <button className="beat-tab-add" title="New outline variation" onClick={() => addOutlineTab()}>+</button>
          {/* v6.52: the count rides beside the tabs here too. */}
          <OutlineBeatCount />
        </div>
      )}

      {/* v6.49, Derek: the body's FIRST ROW — Presets + Add on the left,
          "Show in Outline Bar" on the right. Both used to live in the
          header; the header keeps the standard Filter/View/Search cluster. */}
      <div className="beat-board-actions-row">
        <OutlineTabActions />
        <OutlineBarCheck />
      </div>

      {beatArrangeMode === 'auto' ? (
        <DndContext sensors={sensors} collisionDetection={beatCollisionDetection} onDragStart={handleDragStart} onDragOver={handleDragOver} onDragEnd={handleDragEnd} onDragCancel={handleDragCancel}>
          <div className={`beat-board-columns${maximizedColumnId ? ' beat-board-columns-maximized' : ''}`}>
            {/* v2.23: the holding pen for beats with no section — v6.60,
                the ones a deleted section left behind. Looks like a section
                but isn't one — no title input, no page budget, no delete.
                It sits before the first section (Derek: "make it the
                furthest left column") and goes once it's empty. */}
            {unsortedShowing && !maximizedColumnId && (
              <div
                className="beat-column beat-column-unsorted"
                style={unsortedWidth > 0 ? { width: unsortedWidth, minWidth: 200, maxWidth: 'none' } : undefined}
              >
                <div className="beat-column-header">
                  <span className="beat-column-unsorted-title">Unsorted</span>
                </div>
                <SortableContext items={visibleOrphans.map((b) => b.id)} strategy={verticalListSortingStrategy}>
                  <div className="beat-column-cards">
                    {visibleOrphans.map((beat) => (
                      <SortableBeatCard key={beat.id} beat={beat} onUpdate={updateBeat} onDelete={deleteBeat} />
                    ))}
                  </div>
                </SortableContext>
                <div className="beat-column-unsorted-hint">
                  Beats with no section wait here — drag each into one. This column disappears when it's empty.
                </div>
                {/* v6.61: Unsorted resizes from its right edge like any other
                    column — a column you can see but can't drag would be a
                    control that does nothing. */}
                <div className="beat-column-resize-handle" onPointerDown={unsortedResizePointerDown} style={{ touchAction: 'none' }} />
              </div>
            )}
            {sortedColumns.map((col) => {
              if (maximizedColumnId && maximizedColumnId !== col.id) return null;
              const colBeats = beats
                .filter((b) => b.columnId === col.id && matchesFilter(b))
                .sort((a, b) => a.position - b.position);

              return <BeatColumnView
                key={col.id}
                col={col}
                colBeats={colBeats}
                isSingleColumn={isSingleColumn || maximizedColumnId === col.id}
                isMaximized={maximizedColumnId === col.id}
                onToggleMaximize={() => setMaximizedColumnId(maximizedColumnId === col.id ? null : col.id)}
                showMaximizeBtn={true}
                onUpdateColumn={updateBeatColumn}
                onDeleteColumn={deleteBeatColumn}
                onAddBeat={addBeat}
                onUpdateBeat={updateBeat}
                onDeleteBeat={deleteBeat}
              />;
            })}
          </div>
          <DragOverlay dropAnimation={{ duration: 200, easing: 'ease' }}>{activeBeat ? <BeatCardOverlay beat={activeBeat} /> : null}</DragOverlay>
        </DndContext>
      ) : (
        <CustomCanvas
          beats={beats.filter(matchesFilter)}
          onUpdateBeat={updateBeat}
          onDeleteBeat={deleteBeat}
        />
      )}
    </div>
  );
};

/* ─── Column component with resize handle ─── */
interface BeatColumnViewProps {
  col: { id: string; title: string; width: number; targetPages?: number };
  colBeats: BeatInfo[];
  isSingleColumn: boolean;
  isMaximized: boolean;
  onToggleMaximize: () => void;
  showMaximizeBtn: boolean;
  onUpdateColumn: (id: string, updates: Partial<{ title: string; width: number; targetPages: number }>) => void;
  onDeleteColumn: (id: string) => void;
  onAddBeat: (title: string, columnId: string) => void;
  onUpdateBeat: (id: string, updates: Partial<BeatInfo>) => void;
  onDeleteBeat: (id: string) => void;
}

const BeatColumnView: React.FC<BeatColumnViewProps> = ({
  col, colBeats, isSingleColumn, isMaximized, onToggleMaximize, showMaximizeBtn,
  onUpdateColumn, onDeleteColumn, onAddBeat, onUpdateBeat, onDeleteBeat,
}) => {
  const colResizePointerDown = useColumnResize((w) => onUpdateColumn(col.id, { width: w }));
  const { setNodeRef: setDropRef } = useDroppable({ id: `column-drop-${col.id}` });

  const colStyle: React.CSSProperties = isMaximized
    ? { flex: 1, maxWidth: 'none', minWidth: 0 }
    : isSingleColumn
      ? { flex: 1, maxWidth: 'none', minWidth: 0 }
      : col.width > 0
        ? { width: col.width, minWidth: 200, maxWidth: 'none', flexShrink: 0 }
        : {};

  return (
    <div className={`beat-column${isMaximized ? ' beat-column-maximized' : ''}`} style={colStyle}>
      <div className="beat-column-header">
        <input
          className="beat-column-title-input"
          value={col.title}
          onChange={(e) => onUpdateColumn(col.id, { title: e.target.value })}
          placeholder="Section name..."
        />
        {/* v2.11: the section's page budget — drives its block width on the
            Outline Bar's top row (also settable by right-click there). */}
        <label className="beat-column-target" title="Target pages for this section on the Outline Bar">
          {/* v2.20: never blank (see BeatPagesField). */}
          <input
            type="number"
            min={1}
            value={col.targetPages ?? 1}
            onChange={(e) => {
              const n = Number(e.target.value);
              if (Number.isFinite(n) && n >= 1) onUpdateColumn(col.id, { targetPages: Math.round(n) });
            }}
            onBlur={(e) => { if (!e.target.value) e.target.value = String(col.targetPages ?? 1); }}
          />
          <span>pages</span>
        </label>
        {showMaximizeBtn && (
          <button
            className="beat-column-maximize"
            onClick={onToggleMaximize}
            title={isMaximized ? 'Restore section' : 'Maximize section'}
          >{isMaximized ? <ShrinkIcon /> : <ExpandIcon />}</button>
        )}
        <button className="beat-column-delete" onClick={() => onDeleteColumn(col.id)} title="Delete section. Beats are not deleted"><FaRegTrashAlt /></button>
      </div>
      <SortableContext items={colBeats.map((b) => b.id)} strategy={verticalListSortingStrategy}>
        <div ref={setDropRef} className={`beat-column-cards${isSingleColumn ? ' beat-column-cards-wrap' : ''}`}>
          {colBeats.map((beat) => (
            <SortableBeatCard key={beat.id} beat={beat} onUpdate={onUpdateBeat} onDelete={onDeleteBeat} />
          ))}
        </div>
      </SortableContext>
      <button className="beat-add-btn" onClick={() => onAddBeat('New Beat', col.id)}>+ Add Beat</button>
      {/* Column resize handle (right edge) */}
      {!isSingleColumn && !isMaximized && <div className="beat-column-resize-handle" onPointerDown={colResizePointerDown} style={{ touchAction: 'none' }} />}
    </div>
  );
};

export default BeatBoard;
