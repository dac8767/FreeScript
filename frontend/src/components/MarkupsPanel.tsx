/**
 * v5.25/v5.26: the Annotations tool window — every annotation on the script
 * in one list. A card shows the icon, a text preview, its page number and
 * scene heading; DOUBLE-CLICK jumps the script there AND opens the editor
 * popover (v5.26 — the edit button is gone); the checkbox completes it; the
 * ⋮ menu carries status / hide-type / delete.
 *
 * Header (v5.26): Filter — two sections, "Select one" (Open / Complete /
 * All) and "Select all that you want visible" (a GRID of the annotation
 * types actually in the script, with Show/Hide all); "Show in Script" — the
 * same type grid, but driving which types render in the EDITOR
 * (viewPrefs.markupHiddenIcons — the same list each ⋮ menu toggles); and
 * Search. The eye toggle and the count ride the window chrome as before.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { FaPlus } from 'react-icons/fa';
import type { Editor } from '@tiptap/react';
import { useEditorStore } from '../stores/editorStore';
import { computePageBlocks } from '../editor/pagination';
import { ControlSearch } from './ToolControls';
import { MarkupIcon } from './markupIcons';
import {
  MarkupDotsMenu, TypeGridSection, useTypesInUse, useSeat, useDismiss,
} from './MarkupPickers';
import {
  createMarkupAtSelection, findMarkupPos, markupPreviewText,
  pageForPos, sceneHeadingBefore,
} from '../utils/markupActions';
import type { ScriptMarkup } from '../stores/slices/markupsSlice';

/* (v5.28: DONE_LABELS, useTypesInUse and TypeGridPop moved to MarkupPickers —
   the ribbon's Annotation Filter button and the View submenu share them.) */

export function MarkupsTitleExtra() {
  const markups = useEditorStore((s) => s.markups);
  const filters = useEditorStore((s) => s.markupFilters);
  const search = useEditorStore((s) => s.markupSearch);
  const shown = markups.filter((m) =>
    (filters.done === 'all' || (filters.done === 'done') === m.done)
    && !filters.hiddenIcons.includes(m.icon)
    && (!search || markupPreviewText(m).toLowerCase().includes(search.toLowerCase()))).length;
  return <span className="tool-title-extra">· {shown}</span>;
}

/* v5.27, Derek: the header eye is GONE — whole-tool visibility lives in the
   View menu, the ribbon toggle, and per-type in "Show in Script". */

export function MarkupsControls() {
  const filters = useEditorStore((s) => s.markupFilters);
  const setFilters = useEditorStore((s) => s.setMarkupFilters);
  const scriptHidden = useEditorStore((s) => s.markupHiddenIcons);
  const setScriptHidden = useEditorStore((s) => s.setMarkupHiddenIcons);
  const setScriptDone = useEditorStore((s) => s.setMarkupScriptDone);
  const search = useEditorStore((s) => s.markupSearch);
  const setSearch = useEditorStore((s) => s.setMarkupSearch);

  // v5.43, Derek: ONE filter — every control here drives the SCRIPT and the
  // WINDOW together. Filter reads the union (a type hidden in either shows
  // as hidden; one click converges the two), so legacy per-scope state from
  // the other doors (⋮ menus, ribbon, Navigator) can't hide a mismatch.
  const hiddenUnion = useMemo(
    () => [...new Set([...scriptHidden, ...filters.hiddenIcons])],
    [scriptHidden, filters.hiddenIcons],
  );
  const types = useTypesInUse(hiddenUnion);

  const [filterOpen, setFilterOpen] = useState(false);
  const filterBtn = useRef<HTMLButtonElement>(null);
  const filterBox = useRef<HTMLDivElement>(null);
  const filterPos = useSeat(filterOpen, filterBtn, filterBox);
  useDismiss(filterOpen, filterBox, filterBtn, () => setFilterOpen(false));

  const setBothDone = (d: 'open' | 'done' | 'all') => {
    setScriptDone(d);
    setFilters({ ...filters, done: d });
  };
  const toggleBoth = (icon: string) => {
    const hidden = hiddenUnion.includes(icon);
    setScriptHidden(hidden ? scriptHidden.filter((x) => x !== icon) : [...scriptHidden, icon]);
    setFilters({
      ...filters,
      hiddenIcons: hidden ? filters.hiddenIcons.filter((x) => x !== icon) : [...filters.hiddenIcons, icon],
    });
  };
  const showAllBoth = () => {
    setScriptHidden([]);
    setFilters({ ...filters, hiddenIcons: [] });
  };
  const hideAllBoth = () => {
    setScriptHidden(types);
    setFilters({ ...filters, hiddenIcons: types });
  };

  const doneShown = filters.done;
  const chip = hiddenUnion.length + (doneShown !== 'all' ? 1 : 0);
  return (
    <>
      {/* v5.52, Derek: + Add Annotation left the body for the header — a
          bare +, leading the row (everything after it rides right). The
          header has no editor, so the click arms markupAddRequest and the
          panel body performs the add. */}
      <button
        className="tool-ctl tool-ctl-lead markups-add-btn"
        title="Add annotation"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => { e.stopPropagation(); useEditorStore.getState().setMarkupAddRequest(true); }}
      ><FaPlus /></button>
      {/* v6.42: the button said "Display". v6.71, Derek: it says FILTER —
          the same word the ribbon's Annotation Filter uses for the same
          choice, so one idea has one name. The class and data-ctl keep
          their old names: they are persisted/check ids. */}
      <button ref={filterBtn} data-ctl="filter" className={`tool-ctl markup-ctl-filter${filterOpen ? ' open' : ''}`} title="Choose which annotations show"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => { e.stopPropagation(); setFilterOpen((v) => !v); }}>
        <span className="tool-ctl-label">Filter</span>
        {chip > 0 && <span className="tool-ctl-chip">{chip}</span>}
      </button>
      {filterOpen && createPortal(
        <div ref={filterBox} className="markup-subpop markup-filter-pop" style={filterPos ?? { top: -9999, left: -9999 }}
          onPointerDown={(e) => e.stopPropagation()}>
          <TypeGridSection
            done={doneShown}
            onDone={setBothDone}
            types={types}
            hidden={hiddenUnion}
            onToggle={toggleBoth}
            onShowAll={showAllBoth}
            onHideAll={hideAllBoth}
          />
        </div>,
        document.body,
      )}
      <ControlSearch value={search} onChange={setSearch} placeholder="Search annotations" />
    </>
  );
}

interface Row { m: ScriptMarkup; pos: number | null; page: number | null; heading: string }

export default function MarkupsPanel({ editor }: { editor: Editor | null }) {
  const markups = useEditorStore((s) => s.markups);
  const filters = useEditorStore((s) => s.markupFilters);
  const search = useEditorStore((s) => s.markupSearch);
  const pageLayout = useEditorStore((s) => s.pageLayout);
  const [docTick, setDocTick] = useState(0);

  useEffect(() => {
    if (!editor) return;
    const bump = () => setDocTick((t) => t + 1);
    editor.on('update', bump);
    return () => { editor.off('update', bump); };
  }, [editor]);

  // v5.52, Derek: the header's + (MarkupsControls has no editor) arms
  // markupAddRequest; this body — mounted exactly when that header shows —
  // performs the add. Cleared even editorless so a click can't queue a
  // surprise annotation for later.
  const addRequest = useEditorStore((s) => s.markupAddRequest);
  useEffect(() => {
    if (!addRequest) return;
    useEditorStore.getState().setMarkupAddRequest(false);
    if (editor) createMarkupAtSelection(editor);
  }, [addRequest, editor]);

  const rows = useMemo<Row[]>(() => {
    const pageContent = editor ? computePageBlocks(editor.state.doc, pageLayout) : [];
    const out: Row[] = markups.map((m) => {
      const pos = editor ? findMarkupPos(editor, m.id) : null;
      return {
        m,
        pos,
        page: pos != null ? pageForPos(pageContent, pos) : null,
        heading: pos != null && editor ? sceneHeadingBefore(editor, pos) : '',
      };
    });
    // Script order; annotations whose anchor left the script sink to the end
    // (still listed — their content survives and stays editable/deletable).
    out.sort((a, b) => (a.pos ?? Infinity) - (b.pos ?? Infinity));
    return out;
    // docTick re-scans positions after each doc change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, markups, pageLayout, docTick]);

  const visible = rows.filter(({ m }) => {
    if (filters.done !== 'all' && (filters.done === 'done') !== m.done) return false;
    if (filters.hiddenIcons.includes(m.icon)) return false;
    if (search && !markupPreviewText(m).toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  // v5.26 (#13): double-click = go there AND open the editor window. The
  // jump scrolls first; the popover seats on the next frame's geometry.
  const jumpAndOpen = (id: string, pos: number | null) => {
    const s = useEditorStore.getState();
    if (pos != null) {
      if (s.fullscreenTool) s.setFullscreenTool(null);
      s.requestEditorScroll(pos);
      window.setTimeout(() => s.setMarkupEditorId(id), 160);
    } else {
      s.setMarkupEditorId(id);   // orphan: the popover seats screen-center
    }
  };

  return (
    <div className="markups-panel">
      {/* v5.52, Derek: the add button lives in the window header now (the
          leading + in MarkupsControls) — the body is all list. */}
      <div className="markups-list">
        {visible.length === 0 && (
          <div className="markups-empty">
            {/* v7.81, Derek's wording — was a how-to sentence about the + button. */}
            {markups.length === 0
              ? 'No annotations yet.'
              : 'No annotations match the current filter.'}
          </div>
        )}
        {visible.map(({ m, pos, page, heading }) => (
          <div
            key={m.id}
            className={`markup-card${m.done ? ' done' : ''}`}
            onDoubleClick={() => jumpAndOpen(m.id, pos)}
            title="Double-click to open this annotation in the script"
          >
            <span className="markup-card-icon"><MarkupIcon icon={m.icon} color={m.color} /></span>
            <div className="markup-card-main">
              <div className="markup-card-text">{markupPreviewText(m) || '(empty annotation)'}</div>
              <div className="markup-card-meta">
                {pos != null
                  ? `p. ${page}${heading ? ` · ${heading}` : ''}`
                  : 'location removed from script'}
              </div>
            </div>
            <span className="markup-card-actions">
              <MarkupDotsMenu markup={m} editor={editor} />
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
