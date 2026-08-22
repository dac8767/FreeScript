/**
 * HelperTextSection (v6.20; own window since v6.22; v6.24 batch) — the guts
 * of the Helper Text editor. Derek: "edit every single piece of helper text
 * in the app," then (v6.24): rows GROUPED by where they're found (ribbon,
 * menus, side panel, quick access toolbar, tool windows…), the found-in
 * info ON SCREEN (not a hover), a hide button per row so reviewed items can
 * be cleared (recallable via the Hidden view, persisted), and a go-there
 * button that opens the surface the text lives in WITHOUT closing this
 * window (utils/helperTextDestinations).
 *
 * Overrides key on the DEFAULT string (helperTextOverrides): editing
 * "Delete" retitles every Delete tooltip at once. Delivery is
 * utils/helperText.ts: the DOM applier for title/placeholder, ht()/useHt()
 * for rendered hints. The catalog (+ areas, icons, labels) is generated —
 * devtools/build-helper-catalog.mjs.
 */
import { useMemo, useState } from 'react';
import { LuRotateCcw } from 'react-icons/lu';
import { FaRegEye, FaRegEyeSlash, FaExternalLinkAlt, FaChevronDown, FaChevronRight } from 'react-icons/fa';
import { useEditorStore } from '../stores/editorStore';
import ExportPartButton from './ExportPartButton';
import { helperDestination } from '../utils/helperTextDestinations';
import { runMajorChange } from '../utils/majorChange';
import { pushWindowAction } from '../stores/windowUndoStore';
import { HELPER_ICONS } from '../data/helperTextIcons';
import catalog from '../data/helperTextCatalog.json';

export interface HelperEntry {
  text: string; kind: string; sites: number; area: string; where: string[];
  icon?: string; label?: string;
}

const KIND_LABEL: Record<string, string> = {
  tooltip: 'Hover', placeholder: 'Field', hint: 'Hint',
};
const KIND_FILTERS = ['all', 'tooltip', 'placeholder', 'hint'] as const;

/** Derek's naming order first; every other area alphabetical; the unmapped
 *  bucket last. */
const AREA_ORDER = [
  'Ribbon Toolbar', 'Quick Access Toolbar', 'Menus', 'Context Menu',
  'Side Panel & Window Chrome', 'Status Bar', 'Editor & Preview',
];
const AREA_LAST = 'Everything Else';

export const HELPER_CATALOG = catalog as HelperEntry[];

/** The catalog rows matching the window's search box. */
export function filterHelperCatalog(q: string): HelperEntry[] {
  if (!q) return HELPER_CATALOG;
  return HELPER_CATALOG.filter((e) =>
    e.text.toLowerCase().includes(q)
    || e.label?.toLowerCase().includes(q)
    || e.area.toLowerCase().includes(q)
    || e.where.some((w) => w.toLowerCase().includes(q)));
}

/** Grow the row's textarea to its content — never an inner scrollbar. */
function autoGrow(el: HTMLTextAreaElement) {
  el.style.height = 'auto';
  el.style.height = `${el.scrollHeight}px`;
}

const prettyFile = (w: string) => w.replace(/^(components|editor|utils)\//, '').replace(/\.tsx?$/, '');

function HelperRow({ entry }: { entry: HelperEntry }) {
  const override = useEditorStore((s) => s.helperTextOverrides[entry.text]);
  const setOverride = useEditorStore((s) => s.setHelperTextOverride);
  const toggleHidden = useEditorStore((s) => s.toggleHelperTextHidden);
  const hidden = useEditorStore((s) => s.helperTextHidden.includes(entry.text));
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? override ?? entry.text;
  const edited = override !== undefined;
  const Icon = entry.icon ? HELPER_ICONS[entry.icon] : null;
  const dest = helperDestination(entry.where);
  /* v6.24, Derek: the found-in info renders ON SCREEN, not as hover text. */
  const foundIn = entry.where.map(prettyFile).join(', ');

  /* v6.78, Derek: "i changed helper text in the window, and then tried to
     use Undo, but it did not revert back." Every commit — an edit, a blank,
     or a per-row reset — lands on the window-undo lane, so ⌘Z takes it
     back. `prev` keeps the v6.38 three-state exactly: a string override,
     '' (deliberately blank), or undefined (the app's own text). */
  const short = (entry.label ?? entry.text).slice(0, 28);
  const pushEdit = (label: string, prev: string | undefined, next: string | null) => {
    pushWindowAction(
      label,
      () => useEditorStore.getState().setHelperTextOverride(entry.text, prev === undefined ? null : prev),
      () => useEditorStore.getState().setHelperTextOverride(entry.text, next),
    );
  };

  const commit = (raw: string) => {
    const v = raw.trim();
    /* v6.38, Derek: a BLANK field is a real choice — "there is no helper
       text for that item". Empty commits as an '' override (title/placeholder
       go empty wherever the string appears); the reset button is the way
       back to the app's own text. Only typing the default verbatim clears. */
    const next = v === entry.text ? null : v;
    const changed = (override ?? null) !== next;
    setOverride(entry.text, next);
    if (changed) pushEdit(`Helper text edit — “${short}”`, override, next);
    setDraft(null);
  };

  return (
    <div className={`dz-row ht-row${edited ? ' dz-row-on' : ''}`}>
      <div className="ht-row-head">
        <span className="ht-ctx">
          {Icon && <span className="ht-ctx-icon"><Icon /></span>}
          <span className="ht-ctx-label">{entry.label ?? prettyFile(entry.where[0] ?? '')}</span>
        </span>
        <span className="ht-kind">{KIND_LABEL[entry.kind] ?? entry.kind}</span>
        {dest && (
          <button
            className="ht-iconbtn ht-goto"
            title={dest.label}
            onClick={dest.go}
          ><FaExternalLinkAlt /></button>
        )}
        <button
          className="ht-iconbtn ht-hide"
          title={hidden ? '' : ''}
          onClick={() => toggleHidden(entry.text)}
        >{hidden ? <FaRegEye /> : <FaRegEyeSlash />}</button>
        <button
          className="dz-reset"
          title={edited ? '' : 'Default'}
          disabled={!edited}
          onClick={() => {
            setDraft(null);
            setOverride(entry.text, null);
            pushEdit(`Reset helper text — “${short}”`, override, null);
          }}
        ><LuRotateCcw /></button>
      </div>
      <div className="ht-where">Found in: {foundIn}</div>
      {edited && <div className="ht-default">{entry.text}</div>}
      {/* v6.24, Derek: line breaks allowed — a TEXTAREA that grows with
          its content. Enter = a new line; blur commits; Escape reverts.
          Multi-line shows wherever the text renders as content or in the
          hover bubble (white-space: pre-line); a single-line field's
          placeholder just runs the lines together. */}
      <textarea
        className="ht-input"
        data-ht-for={entry.text}
        rows={1}
        value={shown}
        onFocus={(e) => { setDraft(shown); autoGrow(e.currentTarget); }}
        onChange={(e) => { setDraft(e.target.value); autoGrow(e.currentTarget); }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') { setDraft(null); e.currentTarget.blur(); }
        }}
        onBlur={() => { if (draft !== null) commit(draft); }}
      />
    </div>
  );
}

export function HelperTextSection({ entries }: { entries: HelperEntry[] }) {
  const overrides = useEditorStore((s) => s.helperTextOverrides);
  const hiddenList = useEditorStore((s) => s.helperTextHidden);
  const [kind, setKind] = useState<(typeof KIND_FILTERS)[number]>('all');
  const [showHidden, setShowHidden] = useState(false);
  const [folded, setFolded] = useState<Set<string>>(() => new Set());

  /* v6.77, Derek: "i accidentally hit the 'reset helper text' button and all
     my hard work disappeared." A warning window first, and the reset lands
     on the window-undo lane — ⌘Z brings the work back (majorChange). */
  const handleResetAll = () => {
    const st = useEditorStore.getState();
    const n = Object.keys(st.helperTextOverrides).length;
    const changes = `${n} helper text change${n === 1 ? '' : 's'}`;
    void runMajorChange({
      title: 'Reset Helper Text',
      message: `Reset all ${changes} back to the app’s own words?\n\nEvery string you have rewritten — and every one you blanked — goes back to its default.`,
      confirmLabel: 'Reset',
      label: `Reset helper text (${changes})`,
      capture: () => {
        const prev = { ...st.helperTextOverrides };
        return () => useEditorStore.getState().setHelperTextOverrides(prev);
      },
      run: () => useEditorStore.getState().resetAllHelperText(),
    });
  };

  /* v6.77, Derek: "when 'Hidden' is clicked, show toggle button for
     Hide/Show all." One button in the Hidden view: anything hidden →
     Show all puts it ALL back; nothing hidden → Hide all checks every
     item off. Warned and undoable like every bulk change. */
  const handleBulkHidden = () => {
    const st = useEditorStore.getState();
    const hiding = st.helperTextHidden.length === 0;
    const n = hiding ? HELPER_CATALOG.length : st.helperTextHidden.length;
    const items = `${n} item${n === 1 ? '' : 's'}`;
    void runMajorChange({
      title: hiding ? 'Hide All Items' : 'Show All Items',
      message: hiding
        ? `Move all ${items} to the Hidden view?\n\nThe main list will be empty until you put items back.`
        : `Put all ${items} back in the main list?\n\nThe Hidden view will be empty again.`,
      confirmLabel: hiding ? 'Hide All' : 'Show All',
      label: hiding ? `Hide all helper text items (${n})` : `Show all helper text items (${n})`,
      capture: () => {
        const prev = [...st.helperTextHidden];
        return () => useEditorStore.getState().setHelperTextHidden(prev);
      },
      run: () => useEditorStore.getState().setHelperTextHidden(
        hiding ? HELPER_CATALOG.map((e) => e.text) : [],
      ),
    });
  };

  const hiddenSet = useMemo(() => new Set(hiddenList), [hiddenList]);
  const byKind = kind === 'all' ? entries : entries.filter((e) => e.kind === kind);
  /* v6.24: the main list omits rows Derek has checked off; the Hidden view
     shows exactly those, each with a put-it-back eye. */
  const visible = byKind.filter((e) => (showHidden ? hiddenSet.has(e.text) : !hiddenSet.has(e.text)));

  /* v6.24: grouped by AREA — Derek's named surfaces first, windows A→Z,
     the unmapped bucket last. Groups fold; all start open (every row shows
     at once, v6.22's rule, just organized). */
  const groups = useMemo(() => {
    const m = new Map<string, HelperEntry[]>();
    for (const e of visible) {
      const g = m.get(e.area) ?? [];
      g.push(e); m.set(e.area, g);
    }
    const rank = (a: string) => {
      const i = AREA_ORDER.indexOf(a);
      if (i >= 0) return `0${i.toString().padStart(2, '0')}`;
      return a === AREA_LAST ? '9' : `5${a}`;
    };
    return [...m.entries()].sort(([a], [b]) => rank(a).localeCompare(rank(b)));
  }, [visible]);

  const editedCount = Object.keys(overrides).length;
  const toggleFold = (area: string) => setFolded((f) => {
    const n = new Set(f);
    if (n.has(area)) n.delete(area); else n.add(area);
    return n;
  });

  return (
    <>
      <div className="ht-tools">
        <div className="ht-kinds">
          {KIND_FILTERS.map((k) => (
            <button
              key={k}
              className={`dz-choice${kind === k ? ' on' : ''}`}
              onClick={() => setKind(k)}
            >{k === 'all' ? `All (${entries.length})` : `${KIND_LABEL[k]}s`}</button>
          ))}
          <button
            className={`dz-choice ht-hiddenchip${showHidden ? ' on' : ''}`}
            onClick={() => setShowHidden((v) => !v)}
          >Hidden ({hiddenList.length})</button>
          {showHidden && (
            <button
              className="dz-foot-btn ht-bulk-hidden"
              title={hiddenList.length > 0
                ? ''
                : ''}
              onClick={handleBulkHidden}
            >{hiddenList.length > 0 ? `Show all (${hiddenList.length})` : 'Hide all'}</button>
          )}
        </div>
        {/* The window's housekeeping, grouped. v7.74: .ht-tools is
            space-between with two children — a third would push the reset
            button into the middle of the bar. */}
        <div className="ht-tools-right">
          {/* v7.74, Derek: "make it so I can export design and helper text
              info… I will export a file from each for you to integrate into
              the code directly." The SAME button the Design window renders. */}
          <ExportPartButton part="helpertext" className="ht-tools-btn" />
          {editedCount > 0 && (
            <button className="dz-foot-btn ht-reset-all" onClick={handleResetAll}>
              <LuRotateCcw /> Reset helper text ({editedCount})
            </button>
          )}
        </div>
      </div>
      {groups.map(([area, rows]) => {
        const open = !folded.has(area);
        return (
          <div className="dz-group" key={area}>
            <button className="dz-group-head" onClick={() => toggleFold(area)}>
              {open ? <FaChevronDown /> : <FaChevronRight />}
              <span>{area}</span>
              <span className="ht-group-count">{rows.length}</span>
            </button>
            {open && rows.map((e) => <HelperRow key={e.text} entry={e} />)}
          </div>
        );
      })}
      {visible.length === 0 && (
        <div className="dz-hint ht-more">
          {showHidden ? 'Nothing hidden.' : 'Nothing matches.'}
        </div>
      )}
    </>
  );
}
