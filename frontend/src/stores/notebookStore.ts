/**
 * notebookStore (v1.87) — the Notebook tool's pages and sidebar tree.
 *
 * Adapted from Derek's Airtable Notebook extension: the tree model
 * (sections with unlimited nesting + page leaves), its reconcile /
 * remove / insert / ancestor-guard helpers, and the two page modes
 * (flow document, free canvas) survive intact. Airtable records are
 * replaced by a localStorage-persisted store; the flow document's HTML
 * comes from a tiptap (ProseMirror) editor instead of contentEditable.
 */
import { create } from 'zustand';

export interface NbTable {
  id: string;
  rows: string[][];
  colWidths: number[];
  rowHeights: number[];
  align: 'left' | 'center' | 'right';
  /** v2.13 (Table menu): hide the cell borders / fill the table. */
  borderless?: boolean;
  shading?: string;
  /** v3.86 (Table menu): grid line colour + thickness. Stored on the box in the
   *  same borderColor/borderW fields images use (a box is a table OR an image,
   *  never both, so they can't collide). */
  borderColor?: string;
  borderW?: number;
}
export interface NbBox {
  id: string;
  type: 'text' | 'image' | 'table';
  x: number; y: number; w: number; h: number;
  html?: string;              // text boxes
  src?: string;               // image boxes (data URL)
  rows?: string[][];          // table boxes
  colWidths?: number[];
  rowHeights?: number[];
  align?: 'left' | 'center' | 'right';
  borderless?: boolean;       // v2.13: table boxes (Table menu)
  shading?: string;
  /** v2.13 (Picture menu): image presentation. */
  rotate?: number;            // degrees, clockwise
  borderW?: number;           // px; unset/0 = no border
  borderColor?: string;
}
export interface NotebookPage {
  id: string;
  title: string;
  /** v1.96: every page is a canvas — 'flow' survives only as stored data
   *  and is migrated to boxes on load (see migrateFlowPage). */
  mode: 'flow' | 'canvas';
  html: string;               // legacy flow pages only
  tables: NbTable[];          // legacy flow pages only
  boxes: NbBox[];             // the page content: free-floating boxes
  /** v2.89: creation time (ms epoch) — shown under the title on the surface.
   *  Optional: pages made before this simply have no date to show. */
  createdAt?: number;
}

export type NbNode =
  /** v2.63: `color` tints a TOP-LEVEL section's folder icon (subfolders stay
   *  monotone). Unset = auto-assigned from the palette by top-level order. */
  | { type: 'section'; id: string; name: string; collapsed: boolean; children: NbNode[]; color?: string }
  | { type: 'page'; id: string };

export type NbDropTarget =
  | { kind: 'top' }
  | { kind: 'into' | 'before' | 'after'; id: string };

const STORAGE_KEY = 'opendraft:notebook';

export function nbUid(): string {
  return 'n' + Math.random().toString(36).slice(2, 9);
}

/** v2.62: the grid picker chooses the size; bare calls keep the old 2×2. */
export function newTable(rows = 2, cols = 2): NbTable {
  return {
    id: nbUid(),
    rows: Array.from({ length: Math.max(1, rows) }, () => Array.from({ length: Math.max(1, cols) }, () => '')),
    colWidths: Array.from({ length: Math.max(1, cols) }, () => 90),
    rowHeights: Array.from({ length: Math.max(1, rows) }, () => 32),
    align: 'left',
  };
}

/* ── tree helpers (Derek's, typed) ── */

export function pageIdsInTree(nodes: NbNode[], acc = new Set<string>()): Set<string> {
  for (const n of nodes) {
    if (n.type === 'page') acc.add(n.id);
    else pageIdsInTree(n.children, acc);
  }
  return acc;
}

/** Stored tree + any unplaced page appended top-level; dead page nodes dropped. */
export function reconcileTree(stored: NbNode[], pageIds: string[]): NbNode[] {
  const recSet = new Set(pageIds);
  const prune = (nodes: NbNode[]): NbNode[] =>
    nodes
      .map((n): NbNode | null => {
        if (n.type === 'page') return recSet.has(n.id) ? n : null;
        return { ...n, children: prune(n.children) };
      })
      .filter((n): n is NbNode => n !== null);
  const pruned = prune(stored);
  const present = pageIdsInTree(pruned);
  const missing = pageIds.filter((id) => !present.has(id));
  return [...pruned, ...missing.map((id): NbNode => ({ type: 'page', id }))];
}

export function removeNode(nodes: NbNode[], id: string): [NbNode[], NbNode | null] {
  let removed: NbNode | null = null;
  const walk = (list: NbNode[]): NbNode[] => {
    const out: NbNode[] = [];
    for (const n of list) {
      if (n.id === id) { removed = n; continue; }
      if (n.type === 'section') out.push({ ...n, children: walk(n.children) });
      else out.push(n);
    }
    return out;
  };
  const newTree = walk(nodes);
  return [newTree, removed];
}

export function insertNode(nodes: NbNode[], node: NbNode, target: NbDropTarget): NbNode[] {
  if (target.kind === 'top') return [...nodes, node];
  const walk = (list: NbNode[]): NbNode[] => {
    const out: NbNode[] = [];
    for (const n of list) {
      if (target.kind === 'before' && n.id === target.id) out.push(node);
      if (n.type === 'section') {
        if (target.kind === 'into' && n.id === target.id) {
          out.push({ ...n, children: [...n.children, node] });
        } else {
          out.push({ ...n, children: walk(n.children) });
        }
      } else {
        out.push(n);
      }
      if (target.kind === 'after' && n.id === target.id) out.push(node);
    }
    return out;
  };
  return walk(nodes);
}

export function findSection(nodes: NbNode[], id: string): Extract<NbNode, { type: 'section' }> | null {
  for (const n of nodes) {
    if (n.type === 'section') {
      if (n.id === id) return n;
      const f = findSection(n.children, id);
      if (f) return f;
    }
  }
  return null;
}

/** Is maybeAncestorId an ancestor of (or equal to) id? Blocks dropping a
 *  section into itself or its own descendants. */
export function isAncestor(nodes: NbNode[], maybeAncestorId: string, id: string): boolean {
  if (maybeAncestorId === id) return true;
  const sec = findSection(nodes, maybeAncestorId);
  if (!sec) return false;
  const stack = [...sec.children];
  while (stack.length) {
    const n = stack.pop()!;
    if (n.id === id) return true;
    if (n.type === 'section') stack.push(...n.children);
  }
  return false;
}

/* ── store ── */

/** v1.96: the flowing-document page type is gone. A stored flow page keeps
 *  its content: the document HTML becomes a text box and each stacked table
 *  becomes a table box, laid out down the canvas. */
export function migrateFlowPage(p: NotebookPage): NotebookPage {
  if (p.mode !== 'flow') return p;
  const boxes: NbBox[] = [...(p.boxes ?? [])];
  let y = 24;
  if (p.html && p.html.replace(/<[^>]*>/g, '').trim() !== '') {
    boxes.push({ id: nbUid(), type: 'text', x: 24, y, w: 460, h: 280, html: p.html });
    y += 300;
  }
  for (const t of p.tables ?? []) {
    boxes.push({
      id: t.id, type: 'table', x: 24, y, w: 0, h: 0,
      rows: t.rows, colWidths: t.colWidths, rowHeights: t.rowHeights, align: t.align,
    });
    y += (t.rowHeights?.reduce((a, b) => a + b, 0) ?? 64) + 40;
  }
  return { ...p, mode: 'canvas', html: '', tables: [], boxes };
}

interface NotebookState {
  pages: Record<string, NotebookPage>;
  tree: NbNode[];
  selectedPageId: string | null;
  /** v1.96: the notebook surface is showing in the editor area. Session
   *  state — never persisted; the app always starts on the script. */
  notebookOpen: boolean;
  setNotebookOpen: (open: boolean) => void;
  /** v2.05: the canvas box with focus — the surface toolbar reads it to
   *  show the right section (text formatting / table controls). Session. */
  focusedBoxId: string | null;
  setFocusedBox: (id: string | null) => void;
  /** v2.13: the table cell last focused — the Table menu's row/column
   *  operations act relative to it (Word's model). Session; NOT cleared on
   *  blur, since clicking the menu is itself a blur. */
  focusedCell: { boxId: string; ri: number; ci: number } | null;
  setFocusedCell: (cell: { boxId: string; ri: number; ci: number } | null) => void;
  addPage: () => string;
  deletePage: (id: string) => void;
  renamePage: (id: string, title: string) => void;
  updatePage: (id: string, patch: Partial<Omit<NotebookPage, 'id'>>) => void;
  selectPage: (id: string | null) => void;
  addSection: () => void;
  renameSection: (id: string, name: string) => void;
  /** v2.63: tint a top-level section's folder icon. */
  setSectionColor: (id: string, color: string) => void;
  toggleSection: (id: string) => void;
  /** Deletes the section; descendant pages move back to the top level. */
  deleteSection: (id: string) => void;
  moveNode: (draggedId: string, target: NbDropTarget) => void;
}

/** v4.86, Derek: a brand-new Scrapbook opens with one section holding one
 *  page, so the first thing you see is somewhere to write rather than an
 *  empty tree and two buttons to work out.
 *
 *  Seeded ONLY on a genuine first run — when no `opendraft:notebook` key
 *  exists at all. A notebook that has been used and then emptied stays empty:
 *  re-seeding there would resurrect content the user deliberately deleted,
 *  which is the silent-no-op sin pointed the other way. That case is what the
 *  "No items. / Create a page or section to begin." empty state is for. */
export function seedFirstRun(): Pick<NotebookState, 'pages' | 'tree' | 'selectedPageId'> {
  const pageId = nbUid();
  const page: NotebookPage = {
    id: pageId, title: 'Untitled', mode: 'canvas', html: '', tables: [], boxes: [], createdAt: Date.now(),
  };
  return {
    pages: { [pageId]: page },
    tree: [{ type: 'section', id: nbUid(), name: 'New Section', collapsed: false, children: [{ type: 'page', id: pageId }] }],
    selectedPageId: pageId,
  };
}

export function loadNotebook(): Pick<NotebookState, 'pages' | 'tree' | 'selectedPageId'> {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === null) return seedFirstRun();
    const raw = JSON.parse(stored || 'null');
    if (raw && typeof raw === 'object') {
      const rawPages: Record<string, NotebookPage> = raw.pages && typeof raw.pages === 'object' ? raw.pages : {};
      const pages = Object.fromEntries(
        Object.entries(rawPages).map(([id, p]) => [id, migrateFlowPage(p)]),
      );
      const tree = reconcileTree(Array.isArray(raw.tree) ? raw.tree : [], Object.keys(pages));
      const selectedPageId = typeof raw.selectedPageId === 'string' && pages[raw.selectedPageId]
        ? raw.selectedPageId : (Object.keys(pages)[0] ?? null);
      return { pages, tree, selectedPageId };
    }
  } catch { /* corrupt — start fresh */ }
  return { pages: {}, tree: [], selectedPageId: null };
}

let saveTimer: ReturnType<typeof setTimeout> | undefined;
// v7.89 (security review D10): warn ONCE per full-stretch, re-armed by the next
// good save — so a persistent overflow doesn't toast on every keystroke.
let notebookSaveWarned = false;
function persist(get: () => NotebookState) {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const { pages, tree, selectedPageId } = get();
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ pages, tree, selectedPageId }));
      notebookSaveWarned = false;
    } catch (e) {
      // A cumulative quota overflow (many pages / pasted images) used to be
      // swallowed here — the live UI kept the edits but nothing was written, so
      // the next launch lost everything since. The old "the UI warns on add"
      // note only covered a single oversized image, not the running total. Tell
      // the writer instead of failing silently.
      console.error('[notebook] persist failed:', e);
      if (!notebookSaveWarned) {
        notebookSaveWarned = true;
        void import('../components/Toast')
          .then(({ showToast }) =>
            showToast('The Notebook is full — remove some images or pages to keep saving it.', 'error'),
          )
          .catch(() => {});
      }
    }
  }, 800);
}

export const useNotebookStore = create<NotebookState>((set, get) => ({
  ...loadNotebook(),

  notebookOpen: false,
  setNotebookOpen: (open) => set({ notebookOpen: open }),
  focusedBoxId: null,
  setFocusedBox: (id) => set({ focusedBoxId: id }),
  focusedCell: null,
  setFocusedCell: (cell) => set({ focusedCell: cell }),

  addPage: () => {
    const id = nbUid();
    const page: NotebookPage = { id, title: 'Untitled', mode: 'canvas', html: '', tables: [], boxes: [], createdAt: Date.now() };
    set((s) => ({
      pages: { ...s.pages, [id]: page },
      tree: [...s.tree, { type: 'page', id }],
      selectedPageId: id,
    }));
    persist(get);
    return id;
  },
  deletePage: (id) => {
    set((s) => {
      const { [id]: _gone, ...pages } = s.pages;
      const [tree] = removeNode(s.tree, id);
      return {
        pages,
        tree,
        selectedPageId: s.selectedPageId === id ? (Object.keys(pages)[0] ?? null) : s.selectedPageId,
      };
    });
    persist(get);
  },
  renamePage: (id, title) => {
    set((s) => (s.pages[id] ? { pages: { ...s.pages, [id]: { ...s.pages[id], title } } } : s));
    persist(get);
  },
  updatePage: (id, patch) => {
    set((s) => (s.pages[id] ? { pages: { ...s.pages, [id]: { ...s.pages[id], ...patch } } } : s));
    persist(get);
  },
  selectPage: (id) => { set({ selectedPageId: id }); persist(get); },

  addSection: () => {
    set((s) => ({ tree: [...s.tree, { type: 'section', id: nbUid(), name: 'New Section', collapsed: false, children: [] }] }));
    persist(get);
  },
  renameSection: (id, name) => {
    const walk = (nodes: NbNode[]): NbNode[] => nodes.map((n) =>
      n.type === 'section'
        ? (n.id === id ? { ...n, name: name || 'Section' } : { ...n, children: walk(n.children) })
        : n);
    set((s) => ({ tree: walk(s.tree) }));
    persist(get);
  },
  setSectionColor: (id, color) => {
    // Colors only show on top-level folders, but the walk covers the whole
    // tree so a section dragged to the top level keeps its chosen color.
    const walk = (nodes: NbNode[]): NbNode[] => nodes.map((n) =>
      n.type === 'section'
        ? (n.id === id ? { ...n, color } : { ...n, children: walk(n.children) })
        : n);
    set((s) => ({ tree: walk(s.tree) }));
    persist(get);
  },
  toggleSection: (id) => {
    const walk = (nodes: NbNode[]): NbNode[] => nodes.map((n) =>
      n.type === 'section'
        ? (n.id === id ? { ...n, collapsed: !n.collapsed } : { ...n, children: walk(n.children) })
        : n);
    set((s) => ({ tree: walk(s.tree) }));
    persist(get);
  },
  deleteSection: (id) => {
    set((s) => {
      const sec = findSection(s.tree, id);
      const [without] = removeNode(s.tree, id);
      const freed: NbNode[] = [];
      const collect = (nodes: NbNode[]) => {
        for (const n of nodes) {
          if (n.type === 'page') freed.push(n);
          else collect(n.children);
        }
      };
      if (sec) collect(sec.children);
      return { tree: [...without, ...freed] };
    });
    persist(get);
  },
  moveNode: (draggedId, target) => {
    set((s) => {
      if (target.kind !== 'top' && isAncestor(s.tree, draggedId, target.id)) return s;
      const [without, node] = removeNode(s.tree, draggedId);
      if (!node) return s;
      return { tree: insertNode(without, node, target) };
    });
    persist(get);
  },
}));
