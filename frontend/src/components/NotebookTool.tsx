/**
 * NotebookTool (v1.87; reshaped in v1.96) — a Notion / OneNote-style notebook.
 *
 * Adapted from Derek's Airtable Notebook extension. What survived: the
 * sidebar tree (sections with unlimited nesting, drag pages/sections
 * anywhere, drop into/before/after/top), the structured editable tables
 * (uncontrolled cells — his "first character disappears" fix), the
 * draggable/resizable canvas boxes (text, table, image with aspect-locked
 * resize), and image compression.
 *
 * v1.96, per Derek: the Notebook is NOT a normal tool window. The panel
 * window holds ONLY the tree (sections/pages) and always sits inline in
 * the dock; opening it puts the notebook's writing surface — a free canvas,
 * the flowing-document type is gone — over the entire editor area
 * (NotebookSurface, rendered by ScreenplayEditor like Statistics/Outline).
 * "Return to editor" in the surface header closes both.
 *
 * Tags that link notebook items to other tools come later, per Derek.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  useNotebookStore, newTable, nbUid,
  type NbNode, type NbTable, type NbBox,
} from '../stores/notebookStore';
import { useEditorStore } from '../stores/editorStore';
import { CloseIcon } from './uiIcons';
import {
  FaRegFileAlt, FaRegFolder, FaRegFolderOpen,
  FaFolderPlus, FaRegEdit, FaRegTrashAlt, FaRegEye, FaRegEyeSlash,
  FaChevronRight, FaChevronDown,
} from 'react-icons/fa';
import { useSettingsStore } from '../stores/settingsStore';
import { showToast } from './Toast';
import { confirmDialog } from './ConfirmDialog';
/* image helpers: shared with the annotation window (v5.46) */
import { fileToDataUrl, compressImage } from '../utils/imageIntake';

const IMAGE_BUDGET = 300_000;   // dataURL chars — localStorage is the store

/* ── structured table (his EditableTable, typed) ── */
function Cell({ value, onCommit, onCellFocus, align }: {
  value: string; onCommit: (v: string) => void; onCellFocus: () => void; align: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // v3.85, Derek: RECONCILE the uncontrolled contentEditable with its data on
    // every value change — including when this cell is focused. Cells are keyed
    // by array index, so a row/column insert or delete reuses a DOM node for a
    // DIFFERENT logical cell; and the menu bar never takes focus off the cell,
    // so the reused node stays the activeElement. The v3.84 "skip if focused"
    // guard therefore left the just-restructured focused cell showing its old
    // neighbour's text (insert copied the active cell up; delete left the value
    // behind). This can't eat a typed character: there is no onInput, so `value`
    // only changes on blur-commit or a structural edit, never mid-keystroke.
    const el = ref.current;
    if (!el) return;
    const next = value || '';
    if (el.textContent !== next) el.textContent = next;
  }, [value]);
  return (
    <div
      ref={ref}
      className="fs-nb-cell"
      style={{ textAlign: align as 'left' }}
      contentEditable
      suppressContentEditableWarning
      onMouseDown={(e) => e.stopPropagation()}
      onFocus={onCellFocus}
      onBlur={() => onCommit(ref.current ? ref.current.textContent || '' : '')}
    />
  );
}

/* v2.13: table mutations are PURE, POSITIONAL helpers — the Scrapbook's
   Table menu (Word's model) acts relative to the focused cell. Exported
   for the test. */
const insertAt = <T,>(arr: T[], idx: number, v: T): T[] =>
  [...arr.slice(0, idx), v, ...arr.slice(idx)];
const removeAt = <T,>(arr: T[], idx: number): T[] =>
  arr.filter((_, i) => i !== idx);

export const tableInsertRow = (t: NbTable, idx: number): NbTable => ({
  ...t,
  rows: insertAt(t.rows, Math.max(0, Math.min(idx, t.rows.length)), Array(t.rows[0]?.length || 2).fill('')),
  rowHeights: insertAt(t.rowHeights, Math.max(0, Math.min(idx, t.rowHeights.length)), 32),
});
export const tableDeleteRow = (t: NbTable, idx: number): NbTable =>
  t.rows.length > 1 && idx >= 0 && idx < t.rows.length
    ? { ...t, rows: removeAt(t.rows, idx), rowHeights: removeAt(t.rowHeights, idx) }
    : t;
export const tableInsertCol = (t: NbTable, idx: number): NbTable => {
  const cols = t.rows[0]?.length || 0;
  const at = Math.max(0, Math.min(idx, cols));
  return {
    ...t,
    rows: t.rows.map((r) => insertAt(r, at, '')),
    colWidths: insertAt(t.colWidths, at, 90),
  };
};
export const tableDeleteCol = (t: NbTable, idx: number): NbTable =>
  (t.rows[0]?.length || 0) > 1 && idx >= 0 && idx < (t.rows[0]?.length || 0)
    ? { ...t, rows: t.rows.map((r) => removeAt(r, idx)), colWidths: removeAt(t.colWidths, idx) }
    : t;
/** Sort rows by a column's text. Row heights travel with their rows. */
export const tableSort = (t: NbTable, ci: number, dir: 'asc' | 'desc'): NbTable => {
  const paired = t.rows.map((r, i) => ({ r, h: t.rowHeights[i] ?? 32 }));
  paired.sort((a, b) => (a.r[ci] || '').localeCompare(b.r[ci] || '') * (dir === 'asc' ? 1 : -1));
  return { ...t, rows: paired.map((p) => p.r), rowHeights: paired.map((p) => p.h) };
};
export const tableIsEmpty = (rows: string[][]): boolean =>
  rows.every((r) => r.every((c) => !c || !c.trim()));

function EditableTable({ data, onChange, onCellFocus, zoom = 1 }: {
  data: NbTable; onChange: (t: NbTable) => void;
  /** v2.13: the Table menu acts relative to the last-focused cell. */
  onCellFocus?: (ri: number, ci: number) => void;
  /** v3.88: the board's Page Zoom — grip drags divide mouse travel by it. */
  zoom?: number;
}) {
  const colWidths = data.colWidths;
  const rowHeights = data.rowHeights;
  const setCell = (ri: number, ci: number, value: string) =>
    onChange({ ...data, rows: data.rows.map((r, i) => (i === ri ? r.map((c, j) => (j === ci ? value : c)) : r)) });

  const startColResize = (ci: number) => (e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation();
    const startX = e.clientX;
    const startW = colWidths[ci] || 90;
    const z = zoom || 1;
    const move = (ev: MouseEvent) => {
      const next = colWidths.slice();
      next[ci] = Math.max(36, startW + (ev.clientX - startX) / z);
      onChange({ ...data, colWidths: next });
    };
    const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
  };
  const startRowResize = (ri: number) => (e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation();
    const startY = e.clientY;
    const startH = rowHeights[ri] || 32;
    const z = zoom || 1;
    const move = (ev: MouseEvent) => {
      const next = rowHeights.slice();
      next[ri] = Math.max(24, startH + (ev.clientY - startY) / z);
      onChange({ ...data, rowHeights: next });
    };
    const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
  };

  // v1.99: an all-empty table is invisible on the canvas without help —
  // it gets the defined "I'm empty" border (same rule as empty text boxes).
  // v2.05: the row/col/align buttons moved to the surface toolbar's Table
  // section — nothing is attached to the item anymore.
  const isEmpty = tableIsEmpty(data.rows);

  return (
    <div
      className={`fs-nb-table-wrap${isEmpty ? ' fs-nb-table-empty' : ''}${data.borderless ? ' fs-nb-table-borderless' : ''}`}
      // v3.86, Derek: Table menu > Grid Color / Grid Thickness. The cell borders
      // read these vars (CSS falls back to the default grid when unset).
      style={{
        ...(data.borderColor ? { ['--nb-grid-color' as string]: data.borderColor } : {}),
        ...(data.borderW ? { ['--nb-grid-w' as string]: `${data.borderW}px` } : {}),
      } as React.CSSProperties}
    >
      <table
        className="fs-nb-table"
        style={{ tableLayout: 'fixed', background: data.shading || undefined }}
      >
        <colgroup>{colWidths.map((w, ci) => <col key={ci} style={{ width: w }} />)}</colgroup>
        <tbody>
          {data.rows.map((row, ri) => (
            <tr key={ri} style={{ height: rowHeights[ri] || 32 }}>
              {row.map((cell, ci) => (
                <td
                  key={ci}
                  style={{ height: rowHeights[ri] || 32 }}
                  // v3.86: right-clicking a cell makes it the active cell so the
                  // context menu's row/column ops act on the cell you clicked.
                  onContextMenu={() => onCellFocus?.(ri, ci)}
                >
                  <Cell
                    value={cell}
                    onCommit={(v) => setCell(ri, ci, v)}
                    onCellFocus={() => onCellFocus?.(ri, ci)}
                    align={data.align}
                  />
                  {ri === 0 && <div className="fs-nb-colgrip" onMouseDown={startColResize(ci)} />}
                  {ci === 0 && <div className="fs-nb-rowgrip" onMouseDown={startRowResize(ri)} />}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ── canvas boxes (his, typed; text boxes stay contentEditable — they're
      scraps pinned to a board, not the document ProseMirror owns) ── */
/** v2.65: `onFocus` runs on every drag-start. startDrag stops propagation,
 *  so the wrapper's focusing mousedown never fires for clicks on the box's
 *  draggable body (the img, the head bar, the grip) — the Picture/Table
 *  menus went dead on reselect without this. */
function useBoxDrag(box: NbBox, onChange: (b: NbBox) => void, onFocus?: () => void, zoom = 1) {
  const dragState = useRef<{ type: 'move' | 'resize'; startX: number; startY: number; origX: number; origY: number; origW: number; origH: number } | null>(null);
  const onMove = useCallback((e: MouseEvent) => {
    const ds = dragState.current;
    if (!ds) return;
    // v3.88: the board is scaled by `zoom` (Page Zoom), so a screen-pixel of
    // mouse travel is 1/zoom board-pixels — divide or the box outruns the cursor.
    const z = zoom || 1;
    const dx = (e.clientX - ds.startX) / z, dy = (e.clientY - ds.startY) / z;
    if (ds.type === 'move') onChange({ ...box, x: Math.max(0, ds.origX + dx), y: Math.max(0, ds.origY + dy) });
    else if (box.type === 'image') {
      const aspect = ds.origH > 0 ? ds.origW / ds.origH : 1;
      const w = Math.max(40, ds.origW + dx);
      onChange({ ...box, w, h: Math.max(24, Math.round(w / aspect)) });
    } else {
      onChange({ ...box, w: Math.max(80, ds.origW + dx), h: Math.max(40, ds.origH + dy) });
    }
  }, [box, onChange, zoom]);
  const onUp = useCallback(() => {
    dragState.current = null;
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);
  }, [onMove]);
  const startDrag = (e: React.MouseEvent, type: 'move' | 'resize') => {
    e.preventDefault(); e.stopPropagation();
    onFocus?.();
    dragState.current = { type, startX: e.clientX, startY: e.clientY, origX: box.x, origY: box.y, origW: box.w, origH: box.h };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };
  return startDrag;
}

/** v2.13: id of a box created by click-to-type — it must take the keyboard
 *  the moment it mounts, caret at the end, so typing never skips a beat. */
let pendingTextFocus: string | null = null;

/* ── v3.86, Derek: Scrapbook text-box formatting ───────────────────────────
   The ribbon's B/I/U, font, size and colour controls act on the focused text
   box's contentEditable via execCommand while the Scrapbook is open — before,
   only B/I/U/strike/align were wired and they didn't persist, and font / size /
   colour weren't wired at all (they hit the empty script editor). We track the
   last-focused box body and its selection continuously (a toolbar click would
   otherwise blur it), refocus + restore the range before running the command,
   then write the result back to the store so it survives a re-render. */
let sbBody: HTMLDivElement | null = null;
let sbBoxId: string | null = null;
let sbRange: Range | null = null;

/** Remember the live selection whenever it sits inside a Scrapbook text box. */
export function trackScrapbookSelection() {
  const sel = document.getSelection();
  if (!sel || sel.rangeCount === 0) return;
  const node = sel.anchorNode;
  const el = (node && node.nodeType === 3 ? node.parentElement : node) as HTMLElement | null;
  const body = el?.closest?.('.fs-nb-box-body') as HTMLDivElement | null;
  if (body) {
    sbBody = body;
    sbBoxId = body.dataset.nbBox || null;
    sbRange = sel.getRangeAt(0).cloneRange();
  }
}

/** Apply a formatting command to the focused Scrapbook text box and persist it.
 *  `command` is an execCommand name, plus a synthetic 'fontSizePx' that sets an
 *  arbitrary size (execCommand('fontSize') only takes the legacy 1–7 scale). */
export function applyScrapbookTextFormat(command: string, value?: string): boolean {
  const el = sbBody;
  if (!el || !sbBoxId || typeof document.execCommand !== 'function') return false;
  el.focus();
  if (sbRange) {
    const sel = document.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(sbRange);
  }
  document.execCommand('styleWithCSS', false, 'true');
  if (command === 'fontSizePx') {
    // Tag the run at legacy size 7, then swap each tag for a px-sized span.
    document.execCommand('styleWithCSS', false, 'false');
    document.execCommand('fontSize', false, '7');
    el.querySelectorAll('font[size="7"]').forEach((f) => {
      const span = document.createElement('span');
      span.style.fontSize = value || '';
      while (f.firstChild) span.appendChild(f.firstChild);
      f.replaceWith(span);
    });
  } else {
    document.execCommand(command, false, value);
  }
  // Persist the new HTML so a re-render / page switch keeps the formatting.
  const store = useNotebookStore.getState();
  const pid = store.selectedPageId;
  if (pid) {
    const page = store.pages[pid];
    store.updatePage(pid, { boxes: page.boxes.map((b) => (b.id === sbBoxId ? { ...b, html: el.innerHTML } : b)) });
  }
  const sel = document.getSelection();
  if (sel && sel.rangeCount) sbRange = sel.getRangeAt(0).cloneRange();
  return true;
}

function TextBox({ box, focused, onChange, onFocusBox, onDelete, zoom = 1 }: {
  box: NbBox; focused: boolean; onChange: (b: NbBox) => void; onFocusBox: (id: string) => void; onDelete: (id: string) => void; zoom?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const loaded = useRef(false);
  const startDrag = useBoxDrag(box, onChange, () => onFocusBox(box.id), zoom);
  useEffect(() => {
    if (ref.current && !loaded.current) {
      ref.current.innerHTML = box.html || '';
      loaded.current = true;
    }
  }, [box.html]);
  useEffect(() => {
    if (pendingTextFocus !== box.id || !ref.current) return;
    pendingTextFocus = null;
    ref.current.focus();
    const sel = window.getSelection();
    if (sel) {
      const range = document.createRange();
      range.selectNodeContents(ref.current);
      range.collapse(false);   // caret to the end of what was typed
      sel.removeAllRanges();
      sel.addRange(range);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const isEmpty = !box.html || box.html.replace(/<[^>]*>/g, '').trim() === '';
  const [hover, setHover] = useState(false);
  // v2.05, Derek's rules: EMPTY items always show head bar + border;
  // non-empty ones show them on hover or when clicked into.
  const showHead = focused || isEmpty || hover;
  return (
    <div
      className={`fs-nb-box${focused ? ' focused' : ''}${isEmpty && !focused ? ' empty' : ''}`}
      data-nb-box-id={box.id}
      style={{ left: box.x, top: box.y, width: box.w, height: box.h }}
      onMouseDown={(e) => e.stopPropagation()}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      {/* v2.12: the head FLOATS above the box — appearing on hover must
          never push the text down. */}
      {showHead && (
        // v3.93: grabbing the bar SELECTS the box (drops the text caret) so
        // Delete removes the whole box instead of editing its text.
        <div className="fs-nb-box-head fs-nb-box-head-float" onMouseDown={(e) => { (document.activeElement as HTMLElement | null)?.blur?.(); onFocusBox(box.id); startDrag(e, 'move'); }}>
          <span>⋮⋮</span>
          <button onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); onDelete(box.id); }}><FaRegTrashAlt /></button>
        </div>
      )}
      <div
        ref={ref}
        className="fs-nb-box-body"
        // v3.86: the id lets the toolbar's formatting commands find this box.
        data-nb-box={box.id}
        style={{ height: box.h }}
        contentEditable
        suppressContentEditableWarning
        onMouseDown={() => onFocusBox(box.id)}
        onFocus={() => { sbBody = ref.current; sbBoxId = box.id; }}
        onInput={() => onChange({ ...box, html: ref.current?.innerHTML || '' })}
        spellCheck
      />
      {focused && <div className="fs-nb-box-grip" onMouseDown={(e) => startDrag(e, 'resize')} />}
    </div>
  );
}

/** v2.64: a 90°/270° rotation transposes the image's bounds, so the frame
 *  (box.w/h) must swap with it — otherwise the picture sticks out of its own
 *  window. Every quarter turn routes through this patch. Exported for the
 *  test. */
export function rotatedImagePatch(b: { rotate?: number; w: number; h: number }, delta: number): Partial<NbBox> {
  const rot = ((((b.rotate || 0) + delta) % 360) + 360) % 360;
  return { rotate: rot, w: b.h, h: b.w };
}

function ImageBox({ box, focused, onChange, onFocusBox, onDelete, zoom = 1 }: {
  box: NbBox; focused: boolean; onChange: (b: NbBox) => void; onFocusBox: (id: string) => void; onDelete: (id: string) => void; zoom?: number;
}) {
  const startDrag = useBoxDrag(box, onChange, () => onFocusBox(box.id), zoom);
  const [hover, setHover] = useState(false);
  const show = focused || hover;
  // v2.64: on a quarter turn the FRAME already holds the swapped size; the
  // img lays out at the unrotated size (frame transposed) and rotates into
  // the frame around its center, so nothing pokes out.
  const rot = (((box.rotate || 0) % 360) + 360) % 360;
  const quarter = rot % 180 !== 0;
  return (
    <div
      className="fs-nb-imgbox"
      data-nb-box-id={box.id}
      style={{ left: box.x, top: box.y, width: box.w, height: box.h }}
      onMouseDown={(e) => { e.stopPropagation(); onFocusBox(box.id); }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      {/* v2.05: same slim head bar as text boxes. v3.83, Derek: it FLOATS above
          the image's top edge (was overlaid on top of the picture). */}
      {show && (
        <div className="fs-nb-box-head fs-nb-box-head-float" onMouseDown={(e) => { e.stopPropagation(); startDrag(e, 'move'); }}>
          <span>⋮⋮</span>
          <button onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); onDelete(box.id); }}><FaRegTrashAlt /></button>
        </div>
      )}
      <img
        src={box.src}
        alt=""
        draggable={false}
        onMouseDown={(e) => startDrag(e, 'move')}
        style={{
          ...(quarter ? {
            width: box.h, height: box.w,
            position: 'absolute', left: '50%', top: '50%',
            transform: `translate(-50%, -50%) rotate(${rot}deg)`,
          } : {
            transform: rot ? `rotate(${rot}deg)` : undefined,
          }),
          border: box.borderW ? `${box.borderW}px solid ${box.borderColor || 'currentColor'}` : undefined,
        }}
      />
      {show && <div className="fs-nb-box-grip" onMouseDown={(e) => startDrag(e, 'resize')} />}
    </div>
  );
}

/** A table box's grid, as the NbTable shape the helpers understand. */
export const boxAsTable = (b: NbBox): NbTable => ({
  id: b.id, rows: b.rows || [['', ''], ['', '']],
  colWidths: b.colWidths || [90, 90], rowHeights: b.rowHeights || [32, 32],
  align: b.align || 'left', borderless: b.borderless, shading: b.shading,
  borderColor: b.borderColor, borderW: b.borderW,
});

function TableBox({ box, focused, onChange, onFocusBox, onDelete, onContext, zoom = 1 }: {
  box: NbBox; focused: boolean; onChange: (b: NbBox) => void; onFocusBox: (id: string) => void; onDelete: (id: string) => void;
  onContext?: (x: number, y: number) => void; zoom?: number;
}) {
  const startDrag = useBoxDrag(box, onChange, () => onFocusBox(box.id), zoom);
  const [hover, setHover] = useState(false);
  // v3.81, Derek: the head bar hides when you click away from the table; it
  // comes back on hover or when the table is focused/active. (No longer pinned
  // open just because the cells are empty.)
  const showHead = focused || hover;
  return (
    <div className={`fs-nb-tablebox${focused ? ' focused' : ''}`} data-nb-box-id={box.id} style={{ left: box.x, top: box.y }}
      onMouseDown={(e) => { e.stopPropagation(); onFocusBox(box.id); }}
      // v3.86: right-click anywhere on the table → the Table context menu. The
      // cell under the cursor sets itself active first (its own onContextMenu).
      onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); onFocusBox(box.id); onContext?.(e.clientX, e.clientY); }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      {showHead && (
        <div className="fs-nb-box-head fs-nb-box-head-float" onMouseDown={(e) => { e.stopPropagation(); startDrag(e, 'move'); }}>
          <span>⋮⋮</span>
          <button onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); onDelete(box.id); }}><FaRegTrashAlt /></button>
        </div>
      )}
      <EditableTable
        data={boxAsTable(box)}
        zoom={zoom}
        onChange={(t) => onChange({ ...box, rows: t.rows, colWidths: t.colWidths, rowHeights: t.rowHeights, align: t.align, borderless: t.borderless, shading: t.shading, borderColor: t.borderColor, borderW: t.borderW })}
        onCellFocus={(ri, ci) => {
          // v3.86, Derek: clicking into a cell also activates the box, so the
          // bright (accent) table border shows — not only when you click the
          // box body or its bar. Cell mousedown stops propagation, so the box's
          // own onFocusBox never fired on a cell click before.
          const st = useNotebookStore.getState();
          st.setFocusedCell({ boxId: box.id, ri, ci });
          st.setFocusedBox(box.id);
        }}
      />
    </div>
  );
}

function CanvasSurface({ boxes, onChangeBoxes }: {
  boxes: NbBox[]; onChangeBoxes: (b: NbBox[]) => void;
}) {
  // v2.05: focus lives in the store so the surface toolbar can show the
  // focused item's controls (text formatting / table section).
  const focusedId = useNotebookStore((s) => s.focusedBoxId);
  const setFocusedId = useNotebookStore((s) => s.setFocusedBox);
  const canvasRef = useRef<HTMLDivElement>(null);
  // v3.88, Derek: Page Zoom scales the board too. The content layer is scaled
  // with CSS zoom; every mouse→board coordinate below divides by it.
  const zoom = (useEditorStore((s) => s.zoomLevel) || 100) / 100;

  // v2.13: click-to-type. Clicking BLANK canvas parks a caret there; the
  // first keystroke turns it into a real text box seeded with what was
  // typed. No "+ Text box" button anywhere.
  const [caret, setCaret] = useState<{ x: number; y: number } | null>(null);
  const protoRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (caret) protoRef.current?.focus(); }, [caret]);

  const protoTyped = () => {
    if (!caret || !protoRef.current) return;
    const html = protoRef.current.innerHTML;
    if (!html || html.replace(/<[^>]*>/g, '') === '') return;
    const nb: NbBox = {
      id: nbUid(), type: 'text',
      x: Math.max(0, caret.x - 8), y: Math.max(0, caret.y - 8),
      w: 220, h: 120, html,
    };
    onChangeBoxes([...boxes, nb]);
    setCaret(null);
    setFocusedId(nb.id);
    pendingTextFocus = nb.id;   // the new box grabs the keyboard (caret at end)
  };

  const addImageFromFile = useCallback(async (file: File, atX: number | null, atY: number | null) => {
    if (!file.type.startsWith('image/')) return;
    try {
      const rawUrl = await fileToDataUrl(file);
      // compress progressively until it fits localStorage comfortably (his ladder)
      const attempts: Array<[number, number]> = [[900, 0.75], [720, 0.7], [600, 0.6], [480, 0.55], [360, 0.5]];
      let result: { src: string; w: number; h: number } | null = null;
      for (const [dim, q] of attempts) {
        result = await compressImage(rawUrl, dim, q);
        if (result.src.length <= IMAGE_BUDGET) break;
      }
      if (!result || result.src.length > IMAGE_BUDGET) {
        showToast('That image is too detailed to store in the notebook — try a smaller one.', 'error');
        return;
      }
      const maxBox = 320;
      const scale = Math.min(1, maxBox / Math.max(result.w, result.h));
      const nb: NbBox = {
        id: nbUid(), type: 'image',
        x: Math.max(0, (atX ?? 24) - 10), y: Math.max(0, (atY ?? 24) - 10),
        w: Math.max(40, Math.round(result.w * scale)), h: Math.max(40, Math.round(result.h * scale)),
        src: result.src,
      };
      onChangeBoxes([...boxes, nb]);
      setFocusedId(nb.id);
    } catch { showToast('Failed to process image.', 'error'); }
  }, [boxes, onChangeBoxes]);

  // menu actions reach the canvas via events, like his version
  useEffect(() => {
    // v2.62: the Table menu's grid picker sends the size in event detail;
    // a bare event (older callers) still gets the 2×2 default.
    const tblH = (e: Event) => {
      const d = (e as CustomEvent).detail as { rows?: number; cols?: number } | undefined;
      const t = newTable(d?.rows, d?.cols);
      const nb: NbBox = { id: nbUid(), type: 'table', x: 24, y: 24, w: 0, h: 0, rows: t.rows, colWidths: t.colWidths, rowHeights: t.rowHeights, align: 'left' };
      onChangeBoxes([...boxes, nb]); setFocusedId(nb.id);
    };
    window.addEventListener('nb-add-table-canvas', tblH);
    return () => window.removeEventListener('nb-add-table-canvas', tblH);
  }, [boxes, onChangeBoxes]);

  // v3.89/v3.93, Derek: Delete / Backspace removes the selected box — but NOT
  // while the caret is editing THAT box's own content (its text body or one of
  // its table cells), where those keys edit text. Earlier this checked whether
  // ANY element was editable, so a stale text-box focus (kept alive by the
  // drag's preventDefault) blocked deleting a just-clicked image or table.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      const id = useNotebookStore.getState().focusedBoxId;
      if (!id) return;
      const el = document.activeElement as HTMLElement | null;
      const boxEl = document.querySelector<HTMLElement>(`[data-nb-box-id="${id}"]`);
      const ce = el?.getAttribute?.('contenteditable');
      const editingThisBox = !!el && !!boxEl && boxEl.contains(el)
        && (el.isContentEditable || ce === '' || ce === 'true' || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA');
      if (editingThisBox) return;
      e.preventDefault();
      onChangeBoxes(boxes.filter((b) => b.id !== id));
      useNotebookStore.getState().setFocusedBox(null);
      useNotebookStore.getState().setFocusedCell(null);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [boxes, onChangeBoxes]);

  const updateBox = (b: NbBox) => onChangeBoxes(boxes.map((x) => (x.id === b.id ? b : x)));
  const deleteBox = (id: string) => { onChangeBoxes(boxes.filter((x) => x.id !== id)); if (focusedId === id) setFocusedId(null); };
  // v3.86: the table context menu (right-click) — position + kind of the box.
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; kind: 'table' | 'picture' } | null>(null);

  return (
    <div
      ref={canvasRef}
      className="fs-nb-canvas"
      onMouseDown={(e) => {
        if (e.target !== canvasRef.current || !canvasRef.current) return;
        // v2.59: WITHOUT preventDefault, WebKit finishes its own mousedown
        // focus handling AFTER we focus the parked caret — the caret blurs,
        // onBlur clears it, and "click anywhere and start typing" goes dead.
        // (Chrome resolves the default focus first, which is why this only
        // died in the app.) Nothing on blank canvas needs the default.
        e.preventDefault();
        setFocusedId(null);
        const rect = canvasRef.current.getBoundingClientRect();
        // Board coords = screen offset (incl. scroll) divided by the zoom scale.
        setCaret({
          x: (e.clientX - rect.left + canvasRef.current.scrollLeft) / zoom,
          y: (e.clientY - rect.top + canvasRef.current.scrollTop) / zoom,
        });
      }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        if (!canvasRef.current) return;
        const rect = canvasRef.current.getBoundingClientRect();
        const file = e.dataTransfer.files?.[0];
        if (file) void addImageFromFile(file, (e.clientX - rect.left + canvasRef.current.scrollLeft) / zoom, (e.clientY - rect.top + canvasRef.current.scrollTop) / zoom);
      }}
    >
      <input
        type="file"
        accept="image/*"
        className="fs-nb-filepick"
        id="fs-nb-filepick"
        onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void addImageFromFile(f, null, null); }}
      />
      {boxes.length === 0 && !caret && (
        <div className="fs-nb-canvas-hint">Click anywhere and start typing · drag an image in · or use the Scrapbook menus.</div>
      )}
      {/* v3.88, Derek: the zoomed board. A zero-size positioned layer so its
          boxes anchor to the canvas origin and blank clicks still fall through
          to the canvas (which parks the click-to-type caret). */}
      <div className="fs-nb-canvas-content" style={zoom !== 1 ? { zoom } : undefined}>
        {caret && (
          <div
            ref={protoRef}
            className="fs-nb-protocaret"
            contentEditable
            suppressContentEditableWarning
            style={{ left: caret.x, top: caret.y }}
            onMouseDown={(e) => e.stopPropagation()}
            onInput={protoTyped}
            onBlur={() => setCaret(null)}
          />
        )}
        {boxes.map((b) =>
          b.type === 'image' ? <ImageBox key={b.id} box={b} focused={focusedId === b.id} onChange={updateBox} onDelete={deleteBox} onFocusBox={setFocusedId} zoom={zoom} />
          : b.type === 'table' ? <TableBox key={b.id} box={b} focused={focusedId === b.id} onChange={updateBox} onDelete={deleteBox} onFocusBox={setFocusedId} onContext={(x, y) => setCtxMenu({ x, y, kind: 'table' })} zoom={zoom} />
          : <TextBox key={b.id} box={b} focused={focusedId === b.id} onChange={updateBox} onDelete={deleteBox} onFocusBox={setFocusedId} zoom={zoom} />)}
      </div>
      {ctxMenu && <ScrapbookContextMenu x={ctxMenu.x} y={ctxMenu.y} kind={ctxMenu.kind} onClose={() => setCtxMenu(null)} />}
    </div>
  );
}

/* ── sidebar tree (his TreeView, typed) ── */
function dragStartData(e: React.DragEvent, id: string) {
  e.dataTransfer.setData('text/plain', id);   // WebKit: no data, no drag
  e.dataTransfer.effectAllowed = 'move';
}

/** v2.63, Derek: top-level folders each get their own icon color — cycled
 *  from this palette by top-level order, or the one picked via right-click.
 *  Subfolders stay monotone. Exported for the test. */
export const FOLDER_COLORS = [
  'var(--fd-danger)', '#e89b4f', '#d9c04a', '#6abf69',
  '#4cbfbf', '#6fa8dc', '#b58ee0', '#d377b0',
];
export function folderColor(node: { color?: string }, topIndex: number, depth: number): string | undefined {
  if (depth !== 0) return undefined;
  return node.color ?? FOLDER_COLORS[topIndex % FOLDER_COLORS.length];
}

function TreeNodes({ nodes, depth }: { nodes: NbNode[]; depth: number }) {
  // Pages interleaved between sections must not consume palette slots.
  let secIdx = 0;
  return (
    <>
      {nodes.map((node) => node.type === 'section'
        ? <SectionRow key={node.id} node={node} depth={depth} orderIndex={secIdx++} />
        : <PageRow key={node.id} id={node.id} depth={depth} />)}
    </>
  );
}

function PageRow({ id, depth }: { id: string; depth: number }) {
  const page = useNotebookStore((s) => s.pages[id]);
  const selected = useNotebookStore((s) => s.selectedPageId === id);
  const { selectPage, deletePage, moveNode, renamePage } = useNotebookStore.getState();
  const [over, setOver] = useState<'before' | 'after' | null>(null);
  // v2.89, Derek: double-click renames — same interaction sections have.
  const [editing, setEditing] = useState(false);
  if (!page) return null;
  return (
    <div
      className={`fs-nb-pagerow${selected ? ' active' : ''}${over ? ` over-${over}` : ''}`}
      style={{ marginLeft: depth * 12 }}
      draggable={!editing}
      onDragStart={(e) => dragStartData(e, id)}
      onDragOver={(e) => {
        e.preventDefault();
        const r = e.currentTarget.getBoundingClientRect();
        setOver(e.clientY > r.top + r.height / 2 ? 'after' : 'before');
      }}
      onDragLeave={() => setOver(null)}
      onDrop={(e) => {
        e.preventDefault();
        const dragged = e.dataTransfer.getData('text/plain');
        if (dragged && dragged !== id) moveNode(dragged, { kind: over ?? 'after', id });
        setOver(null);
      }}
    >
      <span className="fs-nb-grabber">⋮⋮</span>
      <span className="fs-nb-pageicon"><FaRegFileAlt /></span>
      {editing ? (
        <input
          autoFocus
          defaultValue={page.title}
          className="fs-nb-sectionname-input"
          onBlur={(e) => { renamePage(id, e.target.value || 'Untitled'); setEditing(false); }}
          onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
        />
      ) : (
        <button
          className="fs-nb-pagename"
          onClick={() => selectPage(id)}
          onDoubleClick={() => setEditing(true)}
          title="Double-click to rename"
        >{page.title || 'Untitled'}</button>
      )}
      <button className="fs-nb-rowdel" title="Delete page" onClick={async () => {
        if (await confirmDialog(`Delete “${page.title || 'Untitled'}”? This cannot be undone.`, { title: 'Delete Page', confirmLabel: 'Delete', danger: true })) deletePage(id);
      }}><FaRegTrashAlt /></button>
    </div>
  );
}

function SectionRow({ node, depth, orderIndex }: { node: Extract<NbNode, { type: 'section' }>; depth: number; orderIndex: number }) {
  const { toggleSection, renameSection, deleteSection, moveNode, setSectionColor } = useNotebookStore.getState();
  const [editing, setEditing] = useState(false);
  const [into, setInto] = useState(false);
  // v2.63: right-click (top level only) → portalled color swatches,
  // positioned by top/left, never bottom.
  const [colorPop, setColorPop] = useState<{ x: number; y: number } | null>(null);
  useEffect(() => {
    if (!colorPop) return;
    const close = (e: PointerEvent) => {
      if (!(e.target as HTMLElement).closest('.fs-nb-colorpop')) setColorPop(null);
    };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setColorPop(null); };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', key);
    };
  }, [colorPop]);
  return (
    <div style={{ marginLeft: depth * 12 }}>
      <div
        className={`fs-nb-sectionrow${into ? ' over-into' : ''}`}
        draggable={!editing}
        onDragStart={(e) => { e.stopPropagation(); dragStartData(e, node.id); }}
        onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setInto(true); }}
        onDragLeave={() => setInto(false)}
        onDrop={(e) => {
          e.preventDefault(); e.stopPropagation();
          const dragged = e.dataTransfer.getData('text/plain');
          if (dragged && dragged !== node.id) moveNode(dragged, { kind: 'into', id: node.id });
          setInto(false);
        }}
        onContextMenu={(e) => {
          if (depth !== 0) return;
          e.preventDefault(); e.stopPropagation();
          setColorPop({ x: Math.min(e.clientX, window.innerWidth - 190), y: e.clientY + 4 });
        }}
      >
        {/* v2.08: the same caret the side-panel dock items wear. */}
        <button className="fs-nb-collapse" onClick={() => toggleSection(node.id)}>
          {node.collapsed ? <FaChevronRight /> : <FaChevronDown />}
        </button>
        <span className="fs-nb-grabber">⋮⋮</span>
        <span className="fs-nb-pageicon" style={{ color: folderColor(node, orderIndex, depth) }}>
          {node.collapsed ? <FaRegFolder /> : <FaRegFolderOpen />}
        </span>
        {editing ? (
          <input
            autoFocus
            defaultValue={node.name}
            className="fs-nb-sectionname-input"
            onBlur={(e) => { renameSection(node.id, e.target.value); setEditing(false); }}
            onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
          />
        ) : (
          <button className="fs-nb-sectionname" onClick={() => toggleSection(node.id)} onDoubleClick={() => setEditing(true)} title="Double-click to rename">
            {node.name}
          </button>
        )}
        <button className="fs-nb-rowdel" title="Delete section" onClick={async () => {
          if (await confirmDialog('Delete this section? Pages inside it move back to the top level.', { title: 'Delete Section', confirmLabel: 'Delete', danger: true })) deleteSection(node.id);
        }}><FaRegTrashAlt /></button>
      </div>
      {!node.collapsed && (
        <div className="fs-nb-children">
          <TreeNodes nodes={node.children} depth={depth + 1} />
          {/* v3.34, Derek: the "empty — drop pages here" hint is gone. The
              empty children div stays — it's still the drop target. */}
        </div>
      )}
      {colorPop && createPortal(
        <div className="fs-nb-colorpop" style={{ top: colorPop.y, left: colorPop.x }}>
          <div className="fs-nb-colorpop-title">Folder color</div>
          <div className="fs-nb-colorpop-swatches">
            {FOLDER_COLORS.map((hex) => (
              <button
                key={hex}
                className={`fs-nb-colorpop-swatch${folderColor(node, orderIndex, depth) === hex ? ' on' : ''}`}
                style={{ background: hex }}
                title={hex}
                onClick={() => { setSectionColor(node.id, hex); setColorPop(null); }}
              />
            ))}
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}

/* ── the tool: the PANEL is the tree; the SURFACE takes over the editor ── */

/** Closes the notebook everywhere: the editor surface and whichever slot the
 *  tool window occupies (left dock, right dock, or a temporary window). */
export function closeNotebook() {
  useNotebookStore.getState().setNotebookOpen(false);
  const s = useEditorStore.getState();
  if (s.activeTool === 'notebook') s.setActiveTool(null);
  if (s.activeToolRight === 'notebook') s.setActiveToolRight(null);
  if (s.tempTool === 'notebook') s.setTempTool(null);
}

/** v2.05: "Pages" + the create buttons live in the window's HEADER (the
 *  chrome's TOOL_CHROME Controls slot), not in the panel body. */
export function NotebookHeaderExtra() {
  const { addPage, addSection } = useNotebookStore.getState();
  // v2.35, Derek: the declutter toggle lives HERE now, not in Settings.
  // On: every other sidebar tool hides and the outline bar drops away —
  // render-time only, so switching back restores everything exactly.
  const declutter = useSettingsStore((s) => s.scrapbookExclusive);
  const setDeclutter = useSettingsStore((s) => s.setScrapbookExclusive);
  return (
    <span className="fs-nb-side-head">
      {/* v3.77, Derek: the declutter (eye) toggle sits at the LEFT; the create
          buttons keep to the RIGHT. */}
      <button
        className={`fs-nb-declutter${declutter ? ' active' : ''}`}
        title={declutter ? 'Show all tools' : 'Hide all other tools'}
        onClick={() => setDeclutter(!declutter)}
      >{declutter ? <FaRegEyeSlash /> : <FaRegEye />}</button>
      <span className="fs-nb-side-btns">
        <button title="New section" onClick={addSection}><FaFolderPlus /></button>
        <button title="New page" onClick={() => addPage()}><FaRegEdit /></button>
      </span>
    </span>
  );
}

/** The tool-window content: ONLY the sections/pages tree. Mounting it (the
 *  window opening) is what raises the notebook surface over the editor. */
export default function NotebookTool() {
  const tree = useNotebookStore((s) => s.tree);
  const { moveNode } = useNotebookStore.getState();
  // The "Drop here for top level" zone only appears mid-drag — it's the
  // target for pulling a page/section out of every section, and it read as
  // mystery chrome when it sat there permanently (Derek asked what it did).
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    // v4.30 batch-v7 #6, Derek: takeovers are EXCLUSIVE. The Scrapbook surface
    // and the Characters fullscreen both claim the editor area, and each puts
    // a "Return to Editor" in the ribbon — with both flags up the ribbon
    // showed two of them. Raising this surface lowers the other takeover
    // (enterToolFullscreen does the reverse).
    useEditorStore.getState().setFullscreenTool(null);
    useNotebookStore.getState().setNotebookOpen(true);
    return () => { useNotebookStore.getState().setNotebookOpen(false); };
  }, []);

  return (
    <div
      className="fs-notebook fs-nb-panel"
      onDragStartCapture={() => setDragging(true)}
      onDragEndCapture={() => setDragging(false)}
      onDropCapture={() => setDragging(false)}
    >
      {/* v4.22, Derek: the tree rows scale with the side panel's item-size
          control now (see .fs-nb-tree --nb-tree-scale), so the dedicated bottom
          zoom bar was removed as redundant. */}
      <div className="fs-nb-tree">
        <TreeNodes nodes={tree} depth={0} />
        {tree.length === 0 && (
          <div className="fs-nb-empty">
            {/* v4.85, Derek's copy — two lines. */}
            No items.
            <br />
            Create a page or section to begin.
          </div>
        )}
      </div>
      {dragging && (
        <div
          className="fs-nb-toplevel-drop"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const dragged = e.dataTransfer.getData('text/plain');
            if (dragged) moveNode(dragged, { kind: 'top' });
            setDragging(false);
          }}
        >
          Drop here to move out of all sections
        </div>
      )}
    </div>
  );
}

/** The writing surface — rendered by ScreenplayEditor over the whole editor
 *  area while the notebook is open. Free canvas only (v1.96). */
export function NotebookSurface() {
  const page = useNotebookStore((s) => (s.selectedPageId ? s.pages[s.selectedPageId] : null));
  const { renamePage, updatePage } = useNotebookStore.getState();

  // v3.86: follow the caret/selection so the toolbar's formatting commands know
  // which text box (and which range) to act on, even after a toolbar click
  // blurs the box.
  useEffect(() => {
    document.addEventListener('selectionchange', trackScrapbookSelection);
    return () => document.removeEventListener('selectionchange', trackScrapbookSelection);
  }, []);

  // v5.50, Derek: the Scrapbook opened from a door OTHER than the panel,
  // with its tool absent from the side panels → auto-show the Scrapbook
  // nav in the LEFT panel for the session; exiting removes it again (the
  // original config comes back exactly). This surface's mount/unmount IS
  // open/close, so the lifecycle can't drift from the takeover.
  const autoDocked = useRef(false);
  const prevNotebookCfg = useRef<{ side: 'left' | 'right'; enabled: boolean } | null>(null);
  useEffect(() => {
    const st = useEditorStore.getState();
    const cfg = st.toolConfig.notebook;
    if (!cfg?.enabled) {
      prevNotebookCfg.current = cfg ?? null;
      st.setToolConfig({ ...st.toolConfig, notebook: { side: 'left', enabled: true } });
      st.setToolMode('notebook', 'docked');
      st.setActiveTool('notebook');
      autoDocked.current = true;
    }
    return () => {
      if (!autoDocked.current) return;
      autoDocked.current = false;
      const s2 = useEditorStore.getState();
      if (s2.activeTool === 'notebook') s2.setActiveTool(null);
      if (s2.activeToolRight === 'notebook') s2.setActiveToolRight(null);
      s2.setToolConfig({
        ...s2.toolConfig,
        notebook: prevNotebookCfg.current ?? { side: 'left', enabled: false },
      });
    };
  }, []);

  return (
    <div className="fs-nb-takeover">
      {/* v2.07: no button row here — the Scrapbook's controls live in the
          MAIN toolbar (ScrapbookToolbarSection), tagged as tool-specific,
          and the toolbar's own formatting buttons drive text boxes.
          v4.85, Derek: except the CLOSE ×, which every other window has —
          the Scrapbook is panel-bound and always fills the editor area, so
          it has no window header to carry one. Same closeNotebook() the
          ribbon's Return to Editor runs. */}
      <button
        className="tool-window-close fs-nb-close"
        title="Close Scrapbook"
        onClick={() => closeNotebook()}
      ><CloseIcon /></button>
      <div className="fs-nb-takeover-head">
        {page ? (
          <span className="fs-nb-title-block">
            {/* Editing this renames the page everywhere — the tree row reads
                the same store title (one source). */}
            <input
              key={page.id}
              className="fs-nb-title"
              defaultValue={page.title}
              placeholder="Untitled"
              onBlur={(e) => renamePage(page.id, e.target.value || 'Untitled')}
            />
            {/* v2.89, Derek: the created date rides under the name.
                v3.33: OneNote's format — a rule under the title, then the
                long date and the creation time on one line. Pages from
                before the field simply have none to show. */}
            {page.createdAt && (
              <span className="fs-nb-created">
                <span>
                  {new Date(page.createdAt).toLocaleDateString(undefined, {
                    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
                  })}
                </span>
                <span className="fs-nb-created-time">
                  {new Date(page.createdAt).toLocaleTimeString(undefined, {
                    hour: 'numeric', minute: '2-digit',
                    hour12: useSettingsStore.getState().timeFormat !== '24h',
                  })}
                </span>
              </span>
            )}
          </span>
        ) : (
          <span className="fs-nb-title fs-nb-title-empty">Scrapbook</span>
        )}
        {/* v3.77, Derek: the surface's Return to Editor button is gone — the
            ribbon's Scrapbook section carries the one Return to Editor now. */}
      </div>
      {page ? (
        <CanvasSurface key={page.id} boxes={page.boxes} onChangeBoxes={(boxes) => updatePage(page.id, { boxes })} />
      ) : (
        <div className="fs-nb-empty">Select or create a page in the Scrapbook panel to start writing.</div>
      )}
    </div>
  );
}

/**
 * useScrapbookMenus (v2.13) — the Scrapbook's contextual MENU BAR menus,
 * shown to the right of a divider + "Scrapbook" tag only while the tool is
 * open (Word's Table tab was the model). Returns [] when closed. Rendered
 * by MenuBar; the shapes match its MenuSection/MenuItem.
 *
 * Table: insert/delete rows and columns relative to the LAST-FOCUSED CELL
 * (focusedCell — kept across blur, since opening the menu is a blur),
 * borders, shading, sort, alignment. Merge/Split Cells are absent on
 * purpose: the grid has no cell-span model yet.
 * Picture: border toggle/size/color, rotation. Cropping needs an
 * interactive crop UI — deferred, not faked.
 */
const SHADING_COLORS: Array<[string, string]> = [
  ['Yellow', '#fff9c4'], ['Green', '#c8e6c9'], ['Blue', '#bbdefb'],
  ['Purple', '#e1bee7'], ['Gray', '#e0e0e0'],
];
const BORDER_COLORS: Array<[string, string]> = [
  ['Black', '#000000'], ['White', '#ffffff'], ['Gray', '#9e9e9e'],
  ['Blue', '#3e9bff'], ['Red', '#ff5257'],
];

/** v2.62, Derek: OneNote's insert-table grid — sweep to preview a size,
 *  click to insert exactly that many columns × rows. Lives in the Table
 *  menu's "Insert Table" submenu. Exported for the test. */
export const TABLE_GRID_COLS = 10;
export const TABLE_GRID_ROWS = 8;
export function TableGridPicker({ onPick }: { onPick: (rows: number, cols: number) => void }) {
  const [hover, setHover] = useState({ r: 0, c: 0 });
  return (
    <div className="fs-nb-tablegrid">
      <div className="fs-nb-tablegrid-label">
        {hover.r > 0 ? `${hover.c}×${hover.r} Table` : 'Pick a size'}
      </div>
      <div className="fs-nb-tablegrid-cells" onPointerLeave={() => setHover({ r: 0, c: 0 })}>
        {Array.from({ length: TABLE_GRID_ROWS }, (_, ri) =>
          Array.from({ length: TABLE_GRID_COLS }, (_, ci) => (
            <button
              key={`${ri}-${ci}`}
              className={`fs-nb-tablegrid-cell${ri < hover.r && ci < hover.c ? ' on' : ''}`}
              onPointerEnter={() => setHover({ r: ri + 1, c: ci + 1 })}
              onClick={() => onPick(ri + 1, ci + 1)}
            />
          )))}
      </div>
    </div>
  );
}

export function useScrapbookMenus(): Array<{
  label: string;
  items: Array<{
    icon?: React.ReactNode; label: string; action?: () => void;
    disabled?: boolean; separator?: boolean;
    render?: (close: () => void) => React.ReactNode;
    children?: Array<{ icon?: React.ReactNode; label: string; action?: () => void; disabled?: boolean; separator?: boolean }>;
  }>;
}> {
  const open = useNotebookStore((s) => s.notebookOpen);
  const page = useNotebookStore((s) => (s.selectedPageId ? s.pages[s.selectedPageId] : null));
  const focusedBoxId = useNotebookStore((s) => s.focusedBoxId);
  const focusedCell = useNotebookStore((s) => s.focusedCell);
  if (!open) return [];

  const { updatePage, setFocusedBox, setFocusedCell } = useNotebookStore.getState();
  const boxes = page?.boxes ?? [];
  // The Table menu's target: the focused table box, or the box owning the
  // last-focused cell.
  const tableBox = boxes.find((b) => b.type === 'table' && (b.id === focusedBoxId || b.id === focusedCell?.boxId)) ?? null;
  const cell = tableBox && focusedCell?.boxId === tableBox.id ? focusedCell : null;
  const imageBox = boxes.find((b) => b.type === 'image' && b.id === focusedBoxId) ?? null;

  const writeTable = (t: NbTable) => {
    if (!page || !tableBox) return;
    updatePage(page.id, {
      boxes: page.boxes.map((b) => (b.id === tableBox.id
        ? { ...b, rows: t.rows, colWidths: t.colWidths, rowHeights: t.rowHeights, align: t.align, borderless: t.borderless, shading: t.shading, borderColor: t.borderColor, borderW: t.borderW }
        : b)),
    });
  };
  const mutate = (fn: (t: NbTable) => NbTable) => () => { if (tableBox) writeTable(fn(boxAsTable(tableBox))); };
  const writeImage = (patch: Partial<NbBox>) => {
    if (!page || !imageBox) return;
    updatePage(page.id, { boxes: page.boxes.map((b) => (b.id === imageBox.id ? { ...b, ...patch } : b)) });
  };
  const deleteBox = (id: string) => {
    if (!page) return;
    updatePage(page.id, { boxes: page.boxes.filter((b) => b.id !== id) });
    setFocusedBox(null);
    setFocusedCell(null);
  };

  const noTable = !tableBox;
  const noCell = !cell;
  const t = tableBox ? boxAsTable(tableBox) : null;

  const tableMenu = {
    label: 'Table',
    items: [
      {
        label: 'Insert Table',
        disabled: !page,
        // v2.93: the native menu bar can't host the grid — its item falls
        // back to this plain action (default 2×2; resize from the Table menu).
        action: () => window.dispatchEvent(new CustomEvent('nb-add-table-canvas', { detail: { rows: 2, cols: 2 } })),
        // v2.62: the submenu IS the grid picker — sweep out a size, click.
        render: (close: () => void) => (
          <TableGridPicker
            onPick={(rows, cols) => {
              window.dispatchEvent(new CustomEvent('nb-add-table-canvas', { detail: { rows, cols } }));
              close();
            }}
          />
        ),
      },
      { separator: true, label: '' },
      { label: 'Insert Row Above', disabled: noCell, action: mutate((x) => tableInsertRow(x, cell!.ri)) },
      { label: 'Insert Row Below', disabled: noCell, action: mutate((x) => tableInsertRow(x, cell!.ri + 1)) },
      { label: 'Insert Column Left', disabled: noCell, action: mutate((x) => tableInsertCol(x, cell!.ci)) },
      { label: 'Insert Column Right', disabled: noCell, action: mutate((x) => tableInsertCol(x, cell!.ci + 1)) },
      { separator: true, label: '' },
      { label: 'Delete Row', disabled: noCell, action: mutate((x) => tableDeleteRow(x, cell!.ri)) },
      { label: 'Delete Column', disabled: noCell, action: mutate((x) => tableDeleteCol(x, cell!.ci)) },
      { label: 'Delete Table', disabled: noTable, action: () => { if (tableBox) deleteBox(tableBox.id); } },
      { separator: true, label: '' },
      { label: t?.borderless ? '\u2713 Hide Borders' : 'Hide Borders', disabled: noTable, action: mutate((x) => ({ ...x, borderless: !x.borderless })) },
      {
        // v3.86, Derek: renamed from "Shading" to match its effect.
        label: 'Background Color', disabled: noTable,
        children: [
          ...SHADING_COLORS.map(([name, hex]) => ({
            icon: <span className="fs-hl-chip" style={{ background: hex }} />,
            label: t?.shading === hex ? `\u2713 ${name}` : name,
            action: mutate((x) => ({ ...x, shading: hex })),
          })),
          { label: 'None', action: mutate((x) => ({ ...x, shading: undefined })) },
        ],
      },
      {
        // v3.86, Derek: grid (border) line colour.
        label: 'Grid Color', disabled: noTable,
        children: [
          ...BORDER_COLORS.map(([name, hex]) => ({
            icon: <span className="fs-hl-chip" style={{ background: hex }} />,
            label: (t?.borderColor || '') === hex ? `\u2713 ${name}` : name,
            action: mutate((x) => ({ ...x, borderColor: hex })),
          })),
          { label: 'Default', action: mutate((x) => ({ ...x, borderColor: undefined })) },
        ],
      },
      {
        // v3.86, Derek: grid (border) line thickness.
        label: 'Grid Thickness', disabled: noTable,
        children: [
          ...[1, 2, 3, 4].map((w) => ({
            label: (t?.borderW || 1) === w ? `\u2713 ${w}px` : `${w}px`,
            action: mutate((x) => ({ ...x, borderW: w })),
          })),
        ],
      },
      {
        label: 'Sort', disabled: noCell,
        children: [
          { label: 'A \u2192 Z (this column)', action: mutate((x) => tableSort(x, cell!.ci, 'asc')) },
          { label: 'Z \u2192 A (this column)', action: mutate((x) => tableSort(x, cell!.ci, 'desc')) },
        ],
      },
      {
        label: 'Align Text', disabled: noTable,
        children: (['left', 'center', 'right'] as const).map((a) => ({
          label: (t?.align || 'left') === a ? `\u2713 ${a[0].toUpperCase()}${a.slice(1)}` : a[0].toUpperCase() + a.slice(1),
          action: mutate((x) => ({ ...x, align: a })),
        })),
      },
    ],
  };

  const noImg = !imageBox;
  const pictureMenu = {
    label: 'Picture',
    items: [
      { label: 'Insert Picture\u2026', disabled: !page, action: () => (document.getElementById('fs-nb-filepick') as HTMLInputElement | null)?.click() },
      { separator: true, label: '' },
      { label: imageBox?.borderW ? '\u2713 Picture Border' : 'Picture Border', disabled: noImg, action: () => writeImage({ borderW: imageBox?.borderW ? 0 : 2 }) },
      {
        label: 'Border Size', disabled: noImg,
        children: [1, 2, 3, 4, 6].map((w) => ({
          label: imageBox?.borderW === w ? `\u2713 ${w}px` : `${w}px`,
          action: () => writeImage({ borderW: w }),
        })),
      },
      {
        label: 'Border Color', disabled: noImg,
        children: BORDER_COLORS.map(([name, hex]) => ({
          icon: <span className="fs-hl-chip" style={{ background: hex }} />,
          label: (imageBox?.borderColor || '#000000') === hex ? `\u2713 ${name}` : name,
          action: () => writeImage({ borderColor: hex, borderW: imageBox?.borderW || 2 }),
        })),
      },
      { separator: true, label: '' },
      /* v2.64: quarter turns swap the frame so it hugs the rotated image. */
      { label: 'Rotate Right 90\u00B0', disabled: noImg, action: () => { if (imageBox) writeImage(rotatedImagePatch(imageBox, 90)); } },
      { label: 'Rotate Left 90\u00B0', disabled: noImg, action: () => { if (imageBox) writeImage(rotatedImagePatch(imageBox, -90)); } },
      {
        label: 'Reset Rotation', disabled: noImg || !imageBox?.rotate,
        action: () => {
          if (!imageBox) return;
          const wasQuarter = ((imageBox.rotate || 0) % 180) !== 0;
          writeImage({ rotate: 0, ...(wasQuarter ? { w: imageBox.h, h: imageBox.w } : {}) });
        },
      },
      { separator: true, label: '' },
      { label: 'Delete Picture', disabled: noImg, action: () => { if (imageBox) deleteBox(imageBox.id); } },
    ],
  };

  return [tableMenu, pictureMenu];
}

/* ── v3.86, Derek: right-click a table (or image) → the SAME Table / Picture
   menu as the menu bar, shown as a context menu at the cursor. Driven by
   useScrapbookMenus, so there's one source for the menu's contents. ── */
type SbMenuItem = ReturnType<typeof useScrapbookMenus>[number]['items'][number];
const sbCleanLabel = (l: string) => l.replace(/^✓\s*/, '');

function SbCtxSubItem({ item, onClose }: { item: SbMenuItem; onClose: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div
      className={`menu-dropdown-item has-children${item.disabled ? ' disabled' : ''}`}
      style={{ position: 'relative' }}
      onMouseEnter={() => !item.disabled && setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      {item.icon && <span className="menu-dropdown-icon">{item.icon}</span>}
      <span>{sbCleanLabel(item.label)}</span>
      <span className="menu-submenu-arrow"><FaChevronRight /></span>
      {open && item.children && (
        <div className="menu-submenu submenu-visible">
          {item.children.map((c, j) => c.separator ? <div key={j} className="menu-separator" /> : (
            <div
              key={`${j}:${c.label}`}
              className={`menu-dropdown-item${c.disabled ? ' disabled' : ''}`}
              onClick={(e) => { e.stopPropagation(); if (!c.disabled) { c.action?.(); onClose(); } }}
            >
              {c.icon && <span className="menu-dropdown-icon">{c.icon}</span>}
              <span>{sbCleanLabel(c.label)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function ScrapbookContextMenu({ x, y, kind, onClose }: {
  x: number; y: number; kind: 'table' | 'picture'; onClose: () => void;
}) {
  const menus = useScrapbookMenus();
  useEffect(() => {
    const close = () => onClose();
    window.addEventListener('mousedown', close);
    window.addEventListener('resize', close);
    window.addEventListener('blur', close);
    return () => { window.removeEventListener('mousedown', close); window.removeEventListener('resize', close); window.removeEventListener('blur', close); };
  }, [onClose]);
  const menu = menus.find((m) => m.label === (kind === 'table' ? 'Table' : 'Picture'));
  if (!menu) return null;
  // Drop the leading "Insert Table/Picture…" (redundant on an existing item)
  // and any separator left dangling at the top.
  const items = menu.items.filter((it) => it.label !== 'Insert Table' && !it.label.startsWith('Insert Picture'));
  while (items.length && items[0].separator) items.shift();
  return createPortal(
    <div
      className="menu-dropdown fs-nb-ctxmenu"
      style={{ top: y, left: x }}
      onMouseDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((it, i) => it.separator ? <div key={i} className="menu-separator" /> : it.children ? (
        <SbCtxSubItem key={`${i}:${it.label}`} item={it} onClose={onClose} />
      ) : (
        <div
          key={`${i}:${it.label}`}
          className={`menu-dropdown-item${it.disabled ? ' disabled' : ''}`}
          onClick={() => { if (!it.disabled) { it.action?.(); onClose(); } }}
        >
          {it.icon && <span className="menu-dropdown-icon">{it.icon}</span>}
          <span>{sbCleanLabel(it.label)}</span>
        </div>
      ))}
    </div>,
    document.body,
  );
}
