/**
 * Built-in toolbar item registry (v0.42).
 *
 * Every built-in toolbar control is an individually placeable item — the old
 * fixed groups (`g:` tokens) and the per-item deactivation checkboxes
 * (`toolbarHiddenItems`, a ScriptCraft v5.5 holdover) are gone. Zones hold flat
 * token lists:
 *   b:<key>       built-in item (this registry)
 *   t:<toolId>    pinned tool/window button
 *   c:<commandId> pinned command button
 *   d:<n>         user divider
 *
 * `normalizeToolbarZones` migrates persisted zones from the legacy scheme:
 * each `g:` token expands to its items (minus any the old checkboxes had
 * deactivated), so existing layouts survive the upgrade unchanged.
 *
 * This module is intentionally dependency-free — it is imported by the
 * store, the Toolbar, and the Customize dialog.
 */

export interface ToolbarBuiltin {
  key: string;
  label: string;
  /** Hidden on mobile via .toolbar-desktop-only. */
  desktopOnly?: boolean;
  /** Hidden on mobile via .zoom-group (mobile shows the single Zoom button). */
  zoom?: boolean;
  /** Permanent (v0.74): can be REORDERED and moved between zones, but never
   *  hidden or removed. normalizeToolbarZones re-inserts it if a persisted
   *  layout is missing it, so it can't be lost. */
  permanent?: boolean;
  /** Which zone a re-inserted permanent item lands in (default 'left'). */
  permanentZone?: 'left' | 'right';
  /** v3.19, Derek's palette cull: not offered in Customize anymore. The
   *  registry entry STAYS so a saved layout that already carries the token
   *  keeps rendering — only the option to add it goes away. */
  unlisted?: boolean;
}

export const TOOLBAR_BUILTINS: ToolbarBuiltin[] = [
  { key: 'undo', label: 'Undo' },
  { key: 'redo', label: 'Redo' },
  { key: 'element', label: 'Element' },
  // v5.25: Annotations — palette-only (like scriptNotes/tags); Derek places
  // them. v5.26: labels renamed with the tool (keys are persisted tokens).
  // v5.28: annotationsMenu opens the per-type script-visibility menu.
  // v6.41, Derek: toggleMarkups ("Show/Hide Annotations") was REMOVED — the
  // registry row went, so normalizeToolbarZones dropped the token from any
  // saved layout (unknown b: keys are discarded).
  // v6.68, Derek: he wants the plain on/off back, as its own button, and the
  // menu renamed for what it actually is — "the current button 'annotation
  // visibility' should be called 'Annotation Filter'. Make a new button that
  // is called 'View Annotations'. This is a simple on or off toggle." A NEW
  // key (viewAnnotations), not the retired one: v6.41's discard rule means
  // any layout still carrying b:toggleMarkups shed it long ago.
  { key: 'markupScript', label: 'Add Annotation' },
  { key: 'viewAnnotations', label: 'View Annotations' },
  { key: 'annotationsMenu', label: 'Annotation Filter' },
  // v5.40: custom pages — palette-only, like the annotation buttons.
  { key: 'insertCustomPage', label: 'Insert Custom Page' },
  { key: 'titlePage', label: 'Title Page' },
  { key: 'fontFamily', label: 'Font Family', desktopOnly: true },
  { key: 'fontSize', label: 'Font Size', desktopOnly: true },
  { key: 'bold', label: 'Bold', desktopOnly: true },
  { key: 'italic', label: 'Italic', desktopOnly: true },
  { key: 'underline', label: 'Underline', desktopOnly: true },
  { key: 'strike', label: 'Strikethrough', desktopOnly: true },
  // v3.19: sub/superscript are word-processor leftovers — screenplay format
  // never uses them. Unlisted from the palette, kept for old layouts.
  { key: 'subscript', label: 'Subscript', desktopOnly: true, unlisted: true },
  { key: 'superscript', label: 'Superscript', desktopOnly: true, unlisted: true },
  { key: 'textColor', label: 'Text Color', desktopOnly: true },
  // v6.10: script highlighting retired (Annotations owns it) — the key
  // survives as the Scrapbook's box-background picker only.
  { key: 'highlightColor', label: 'Box Background (Scrapbook)', desktopOnly: true },
  { key: 'alignLeft', label: 'Align Left', desktopOnly: true },
  { key: 'alignCenter', label: 'Align Center', desktopOnly: true },
  { key: 'alignRight', label: 'Align Right', desktopOnly: true },
  { key: 'alignJustify', label: 'Justify', desktopOnly: true },
  { key: 'find', label: 'Find & Replace' },
  { key: 'goto', label: 'Go to Page' },
  { key: 'scriptNotes', label: 'Notes' },
  { key: 'tags', label: 'Production Tags' },
  { key: 'zoom', label: 'Page Zoom', zoom: true },
  { key: 'view', label: 'Editor View', desktopOnly: true },
  /* v2.34's one-click surface toggles. v3.25, Derek: the side-panel pair is
     REMOVED (task #137) — the panel collapse chevrons and View > Toolbars
     already cover it. Outline Bar keeps its button (no chevron equivalent). */
  { key: 'toggleOutlineBar', label: 'Outline Bar' },
  // v2.55, Derek: freeze every chrome resize (panels, bars, grips).
  { key: 'lockResize', label: 'Lock All' },
  // v2.67, Derek: reset every adjustable size/spacing (confirm first;
  // grayed while the sizing lock is on).
  // v3.19: a destructive one-shot with a home in the View menu (confirmed
  // there) — too risky as a stray toolbar click. Unlisted, kept for old layouts.
  { key: 'resetSizes', label: 'Reset Sizing', unlisted: true },
  // v2.94: the Insert Table grid — a menu item the native menu bar can't
  // host, so it lives on the toolbar's second row (Scrapbook only).
  // v3.32, Derek: tool-specific items don't belong in the palette —
  // unlisted, kept working for layouts that already have it.
  { key: 'insertTable', label: 'Insert Table (Scrapbook)', unlisted: true },
  // v3.02, Derek: Customize is an ordinary ribbon ITEM again — placeable,
  // removable, in the palette like everything else (View > Customize…
  // always remains as the way back in).
  { key: 'customize', label: 'Customize' },
];

export const BUILTIN_BY_KEY: Record<string, ToolbarBuiltin> = Object.fromEntries(
  TOOLBAR_BUILTINS.map((b) => [b.key, b]),
);

// scriptNotes and tags are NOT in the default — they add from the dropdown's
// Tools and Production groups (legacy g:notes migration still preserves them
// in layouts that already had them).
// v2.02: the zones are MAIN (left-aligned controls) and BIG BUTTON (large
// Customize-style launchers). Zoom and Editor View moved into Main — they're
// controls, not launchers; the default Big Button section is just Customize.
// v2.14: the group separators are REAL divider tokens now — they show up in
// Customize > Toolbar like any user divider, movable and removable. (The old
// sepAfter flags rendered ghosts Customize couldn't see.)
// v2.96: ONE ribbon sequence organized by SECTION — everything between two
// full-height dividers (2!d:) is a section. Items read left-to-right; an
// r: row-break inside a section puts what follows on a second row. A
// section WITHOUT a break renders its items spanning both rows.
// v3.01, Derek: the default is HIS layout (per screenshot) — clipboard +
// history, font + styling + alignment, element + inserts, find/goto.
// Everything else lives in the palette.
export const DEFAULT_TOOLBAR_LEFT: string[] = [
  'c:copy', 'c:paste', 'r:def-1', 'b:undo', 'b:redo',
  '2!d:def-a',
  'b:fontFamily', 'b:fontSize', 'r:def-2',
  'b:bold', 'b:italic', 'b:underline', 'b:textColor',
  'b:alignLeft', 'b:alignCenter', 'b:alignRight', 'b:alignJustify',
  '2!d:def-b',
  'b:element',
  '2!d:def-c',
  'b:find', 'b:goto',
  // v3.02: the align split — Customize hugs the right edge by default.
  'a:def-split',
  'b:customize',
];

/** v2.34 one-time: existing saved layouts get the three surface toggles
 *  appended to Main (new installs have them via the default above).
 *  (v3.25 strips the side-panel pair back out — see below.) */
export function migratePanelToggles(left: string[]): string[] {
  const toggles = ['b:togglePanelLeft', 'b:togglePanelRight', 'b:toggleOutlineBar'];
  if (toggles.some((t) => left.includes(t))) return left;
  return [...left, 'd:def-surfaces', ...toggles];
}

/** v3.25 one-time, Derek (task #137): the Left/Right Panel toggle buttons are
 *  retired — the collapse chevrons on the panels themselves and View >
 *  Toolbars cover it. Saved layouts shed the tokens (flag-blind: they may
 *  carry a 2! span flag). Outline Bar's toggle stays. */
export function migrateDropPanelToggles(left: string[]): string[] {
  const dropped = new Set(['b:togglePanelLeft', 'b:togglePanelRight']);
  return left.filter((t) => !dropped.has(t.replace(/^2!/, '')));
}

/** v5.51 one-time, Derek: the legacy working-note buttons are retired from
 *  the ribbon — Insert Section / Insert Note / Add To-Do List (builtins)
 *  and Insert Marker (command). Saved layouts shed the tokens (flag-blind:
 *  they may carry a 2! span flag); annotations replace the lot. */
export function migrateDropLegacyInserts(tokens: string[]): string[] {
  const dropped = new Set(['b:insertSection', 'b:insertNote', 'b:insertChecklist', 'c:insertMarker']);
  return tokens.filter((t) => !dropped.has(t.replace(/^2!/, '')));
}

/** v2.55 one-time: existing saved layouts get the sizing lock appended. */
/** v6.68 one-time: "View Annotations" joins the Annotation Filter wherever
 *  a saved layout already has it — the pair belongs together, and the writer
 *  shouldn't have to go find the new button in Customize. A layout without
 *  the filter is left alone: both are palette-only, placed by hand. */
export function migrateViewAnnotations(tokens: string[]): string[] {
  if (tokens.includes('b:viewAnnotations')) return tokens;
  const at = tokens.indexOf('b:annotationsMenu');
  if (at < 0) return tokens;
  return [...tokens.slice(0, at), 'b:viewAnnotations', ...tokens.slice(at)];
}

export function migrateLockResize(left: string[]): string[] {
  if (left.includes('b:lockResize')) return left;
  return [...left, 'b:lockResize'];
}

/** v2.67 one-time: existing saved layouts get the sizing reset appended,
 *  right beside the lock it undoes. */
export function migrateResetSizes(left: string[]): string[] {
  if (left.includes('b:resetSizes')) return left;
  const at = left.indexOf('b:lockResize');
  return at >= 0
    ? [...left.slice(0, at + 1), 'b:resetSizes', ...left.slice(at + 1)]
    : [...left, 'b:resetSizes'];
}

/* ── v2.95/v2.96: the RIBBON ────────────────────────────────────────────
   Derek: "update the toolbar so it emulates the Microsoft Word ribbon",
   then (v2.96): "arrange by section. all items between two large dividers
   is a section... a utility item indicates at which point the icons move
   to the second row... if it is not used, the items span both rows."

   The sequence is flat; structure comes from two token kinds:
     2!d:<id>  full-height SECTION divider
     r:<id>    ROW BREAK — items after it sit on the section's second row
   A section with no break renders its items spanning both rows.

   Customize is not a token — it's fixed chrome at the right edge,
   spanning both rows (the old v0.91 shape, reborn).

   The v2.94 `big!` prefix lived one day; stripBig survives only so
   layouts saved that day normalize clean. */
export const BIG_PREFIX = 'big!';
export const stripBig = (tok: string) => (tok.startsWith(BIG_PREFIX) ? tok.slice(BIG_PREFIX.length) : tok);

export const TALL_PREFIX = '2!';
export const isTall = (tok: string) => tok.startsWith(TALL_PREFIX);
export const stripTall = (tok: string) => (isTall(tok) ? tok.slice(TALL_PREFIX.length) : tok);
export const makeTall = (tok: string) => (isTall(tok) ? tok : TALL_PREFIX + tok);

/** Section divider: a full-height d: token. */
export const isSectionDivider = (tok: string) => isTall(tok) && stripTall(tok).startsWith('d:');
/** v4.75, Derek: a NAKED section boundary — sections stay separate but NO
 *  divider line paints between them (a two-row and a one-row section can sit
 *  flush). Serialized when a boundary's divider is removed in edit mode. */
export const isNakedDivider = (tok: string) => tok.startsWith('nd:');
/** Row break: the v2.96 utility that starts a section's second row.
 *  v2.97: `rl:` is a break whose line SHOWS in the toolbar; plain `r:`
 *  splits invisibly. */
export const isRowBreak = (tok: string) => tok.startsWith('r:') || tok.startsWith('rl:');
/** v3.02, Derek: the align split — a section boundary that also pushes
 *  everything after it to the toolbar's RIGHT edge. */
export const isAlignSplit = (tok: string) => tok.startsWith('a:');
/** A TITLE token — everything after `st:` is the literal label text. v3.42,
 *  Derek: a title belongs to a SECTION and renders on top of its rows (added
 *  from + Add). The `st:` token rides at the section's head. */
export const isSectionTitle = (tok: string) => tok.startsWith('st:');
/** v3.41 title-row marker — retired in v3.42; recognised only so a stray one
 *  (and the legacy title-row prefix before it) is discarded on parse. */
export const isTitleRowEnd = (tok: string) => tok.startsWith('tre:');

/** A parsed ribbon section. `hasBreak` false ⇒ single row, items span both
 *  rows; true ⇒ `top` row above `bottom` row. `breakLine` ⇒ the split
 *  draws a visible line between the rows. `title` ⇒ a label on top of the
 *  section's rows (v3.42). */
export interface RibbonSection {
  top: string[]; bottom: string[]; hasBreak: boolean; breakLine: boolean; title?: string;
  /** v4.75: this section's LEADING boundary paints no divider line. */
  noSepBefore?: boolean;
}

/** The whole ribbon: its sections, plus the index of the first section in
 *  the RIGHT-aligned group (null ⇒ everything left-aligned). */
export interface RibbonModel { sections: RibbonSection[]; splitAt: number | null }

/** The ribbon's structure, straight from the token sequence. Extra row
 *  breaks in one section merge into the first (a section has at most two
 *  rows); an extra align split acts as a plain divider. serializeRibbon
 *  writes the canonical form back. */
export function parseRibbon(tokens: string[]): RibbonModel {
  // v3.42: discard any retired v3.41 title-row prefix (up to the `tre:` marker).
  let body = tokens;
  const treIdx = tokens.findIndex(isTitleRowEnd);
  if (treIdx >= 0) body = tokens.slice(treIdx + 1);

  const sections: RibbonSection[] = [];
  let splitAt: number | null = null;
  let cur: RibbonSection = { top: [], bottom: [], hasBreak: false, breakLine: false };
  const push = () => {
    sections.push(cur);
    cur = { top: [], bottom: [], hasBreak: false, breakLine: false };
  };
  for (const raw of body) {
    if (isAlignSplit(raw)) {
      push();
      if (splitAt === null) splitAt = sections.length;
      continue;
    }
    if (isSectionDivider(raw)) { push(); continue; }
    if (isNakedDivider(raw)) { push(); cur.noSepBefore = true; continue; }
    if (isTitleRowEnd(raw)) continue;             // stray marker — ignore
    if (isSectionTitle(raw)) { cur.title = raw.slice(3); continue; }
    if (isRowBreak(raw)) {
      cur.hasBreak = true;
      cur.breakLine = cur.breakLine || raw.startsWith('rl:');
      continue;
    }
    (cur.hasBreak ? cur.bottom : cur.top).push(raw);
  }
  push();
  return { sections, splitAt };
}

/** Model → the flat token sequence. Divider/break ids are positional —
 *  they only need to be unique within the sequence. */
export function serializeRibbon(model: RibbonModel): string[] {
  const { sections, splitAt } = model;
  const out: string[] = [];
  sections.forEach((s, i) => {
    if (i > 0) out.push(i === splitAt ? `a:split-${i}` : s.noSepBefore ? `nd:sec-${i}` : `2!d:sec-${i}`);
    // v3.42: a section title rides at the section head, on top of its rows.
    // Emit even an empty one (defined ⇒ present) so the editable field stays.
    if (s.title !== undefined) out.push(`st:${s.title}`);
    out.push(...s.top);
    if (s.hasBreak) out.push(`${s.breakLine ? 'rl' : 'r'}:row-${i}`, ...s.bottom);
  });
  return out;
}

/** v2.95 one-time: fold the two-row zones into the single ribbon sequence.
 *  Row 1 keeps its order, a full-height divider separates it from the old
 *  Row 2 items, and structural dividers become full-height (they used to
 *  mark a whole-bar break). big! flags and customize tokens are shed. */
export function migrateRibbon(left: string[], right: string[]): string[] {
  const clean = (arr: string[]) => arr
    .map(stripBig)
    .filter((t) => t !== 'b:customize')
    .map((t) => (t.startsWith('d:') ? makeTall(t) : t));
  const l = clean(left);
  const r = clean(right);
  return r.length ? [...l, '2!d:ribbon-split', ...r] : l;
}

/** v2.96 one-time: column-major ribbon → section model. The old renderer
 *  paired consecutive small items vertically, so a section's visual TOP row
 *  was the even-indexed items and its BOTTOM row the odd ones — that split
 *  becomes an explicit r: break, keeping the bar looking the same. Sections
 *  that were a lone item (or all 2!-tall items) become single-row sections;
 *  item-level 2! flags are shed (height is the section's business now). */
export function migrateRibbonSections(tokens: string[]): string[] {
  const out: string[] = [];
  let chunk: string[] = [];
  let n = 0;
  const flush = () => {
    const smalls = chunk.filter((t) => !isTall(t));
    if (chunk.length <= 1 || smalls.length <= 1) {
      out.push(...chunk.map(stripTall));
    } else {
      const items = chunk.map(stripTall);
      out.push(
        ...items.filter((_, i) => i % 2 === 0),
        `r:mig-${n++}`,
        ...items.filter((_, i) => i % 2 === 1),
      );
    }
    chunk = [];
  };
  for (const raw of tokens) {
    if (isSectionDivider(raw)) { flush(); out.push(raw); continue; }
    chunk.push(raw);
  }
  flush();
  return out;
}

/** Row-1 keys that belong to Row 2 under the v2.94 split — tool/window
 *  toggles and app functions, not formatting. */
const ROW2_KEYS = new Set(['togglePanelLeft', 'togglePanelRight', 'toggleOutlineBar', 'lockResize', 'resetSizes']);

/** v2.94 one-time: split a saved single-row layout into the two rows.
 *  Surface toggles, lock/reset, pinned tools and commands move to Row 2
 *  (keeping their order); the old Big Button zone's items become Row 2
 *  items flagged big. Formatting, dividers and spacers stay in Row 1. */
export function migrateTwoRows(left: string[], right: string[]): { left: string[]; right: string[] } {
  const stays = (tok: string) => {
    if (tok.startsWith('d:') || tok.startsWith('s:')) return true;
    if (tok.startsWith('t:') || tok.startsWith('c:')) return false;
    if (tok.startsWith('b:')) return !ROW2_KEYS.has(tok.slice(2));
    return true;
  };
  const newLeft = left.filter(stays);
  const moved = left.filter((t) => !stays(t));
  return { left: newLeft, right: [...moved, ...right] };
}

// v2.95: the right zone is RETIRED — the ribbon is one sequence. The empty
// export keeps the (left, right) plumbing type-stable; normalizeToolbarZones
// folds anything still stored on the right into the sequence.
export const DEFAULT_TOOLBAR_RIGHT: string[] = [];

/** v2.14 one-time: sepAfter separators became real d: tokens. A saved
 *  layout gets a divider inserted after each item that used to carry one
 *  (Main zone only — the Big Button section never had separators), so the
 *  toolbar looks identical before and after, just editable now. */
const LEGACY_SEP_KEYS = ['redo', 'titlePage', 'fontSize', 'superscript', 'highlightColor', 'alignJustify', 'goto'];
export function migrateSepDividers(left: string[]): string[] {
  const out: string[] = [];
  for (const tok of left) {
    out.push(tok);
    const key = tok.startsWith('b:') ? tok.slice(2) : '';
    if (LEGACY_SEP_KEYS.includes(key)) out.push(`d:sep-${key}`);
  }
  return out;
}

/** v2.02 one-time shape change: the right zone stopped being "more small
 *  buttons at the far edge" and became the Big Button section. Whatever a
 *  saved layout had on the right moves to the end of Main so nothing
 *  silently changes shape; Customize is (re)seeded into the section. */
export function migrateToolbarBigZone(
  left: string[], right: string[],
): { left: string[]; right: string[] } {
  // (v2.95: bigZoneAllowed is gone — historically tools and commands could
  // stay in the Big Button zone, everything else moved to Main.)
  const couldStay = (t: string) => t.startsWith('t:') || t.startsWith('c:');
  const stay = right.filter(couldStay);
  const moved = right.filter((t) => !couldStay(t));
  return { left: [...left, ...moved], right: stay };
}

/** Legacy `g:` group → item keys, in group order. */
const LEGACY_GROUP_ITEMS: Record<string, string[]> = {
  history: ['undo', 'redo'],
  element: ['element'],
  insert: [],   // v5.51: the legacy inserts are retired
  font: ['fontFamily', 'fontSize'],
  style: ['bold', 'italic', 'underline', 'strike', 'subscript', 'superscript', 'textColor', 'highlightColor'],
  align: ['alignLeft', 'alignCenter', 'alignRight', 'alignJustify'],
  nav: ['find', 'goto'],
  notes: ['scriptNotes', 'tags'],
  zoom: ['zoom'],
  view: ['view'],
};

/**
 * Expand legacy tokens to the flat per-item scheme. `hidden` is the retired
 * `toolbarHiddenItems` list (display labels): items the old checkboxes had
 * deactivated are simply not re-added. Already-flat zones pass through
 * untouched (idempotent), with duplicate built-ins deduped first-wins.
 */
export function normalizeToolbarZones(
  left: string[] | undefined,
  right: string[] | undefined,
  hidden: string[] = [],
): { left: string[]; right: string[] } {
  const hiddenKeys = new Set(
    TOOLBAR_BUILTINS.filter((b) => hidden.includes(b.label)).map((b) => b.key),
  );
  const seen = new Set<string>();
  const expand = (tokens: string[] | undefined): string[] => {
    const out: string[] = [];
    for (const raw of tokens ?? []) {
      // v2.95: shed any big! flag from the short-lived v2.94 scheme.
      // v2.96: the 2! flag only means something on d: tokens (section
      // dividers) — items get their height from their section now, so the
      // flag is shed everywhere else. Stray customize tokens vanish.
      const tall = isTall(stripBig(raw));
      const tok = stripTall(stripBig(raw));
      const keep = (t: string) => out.push(tall && t.startsWith('d:') ? makeTall(t) : t);
      if (tok.startsWith('g:')) {
        for (const key of LEGACY_GROUP_ITEMS[tok.slice(2)] ?? []) {
          if (hiddenKeys.has(key) || seen.has(key)) continue;
          seen.add(key);
          out.push(`b:${key}`);
        }
      } else if (tok.startsWith('b:')) {
        // v0.75: the separate Zoom In / Zoom Out buttons became one Zoom
        // dropdown. Fold both legacy tokens into it (deduped by `seen`).
        const key = (tok === 'b:zoomIn' || tok === 'b:zoomOut') ? 'zoom' : tok.slice(2);
        if (!BUILTIN_BY_KEY[key] || seen.has(key)) continue;
        seen.add(key);
        keep(`b:${key}`);
      } else {
        keep(tok); // t: / c: / d: / s:
      }
    }
    return out;
  };
  // v2.95: one sequence — anything still stored in the retired right zone
  // folds onto the end, so a pre-ribbon layout can't silently lose items.
  const l = [...expand(left), ...expand(right)];
  return { left: l, right: [] };
}

/* ── v5.14, Derek: per-kind section geometry ─────────────────────────────
   "if there is one or more sections with a title and one or more without,
   the spacing becomes weird (a gap where the title is)… expand the items in
   sections without a title so the final vertical size is the same."

   The maths lives HERE, pure and testable, because three consumers need the
   same numbers: the toolbar's inline CSS variables, the bar's min-height,
   and the tests. `k` factors are plain numbers so the stylesheet can
   multiply them into any base length with calc().

   kUntitled carries the AUTO-FILL: with any title present, an untitled
   two-row section's rows stretch so its total equals a titled section's
   total (rows + title band) — bases level, tops level with the titled
   TITLE's top, which is option (a) of Derek's two. On top of that, the two
   Design scale knobs (%) multiply each kind independently. */
export interface RibbonKindVars { kTitled: number; kUntitled: number; contentH: number }

/* v7.76 — WHY EVERY KNOB BELOW IS REQUIRED, AND HAS NO DEFAULT HERE.
   Each one used to be optional with a `?? literal` fallback, and Toolbar.tsx
   passes `designVars.ribTitleGap` and friends — the OVERRIDE map, which is
   undefined for any knob the user has not moved. So those fallbacks were a
   SECOND statement of a default the CSS also states
   (`var(--dz-rib-title-gap, 1px)`), and the two had drifted: this file still
   said titleGap 5 / rowGaps 0 / padTopUntitled 0 while the stylesheet painted
   1 / -2 / -3 / 2.

   Nothing could show it while Derek's numbers arrived as OVERRIDES, because
   then both paths read the same map. v7.76 made his numbers the defaults and
   emptied the map — and the auto-fill immediately started sizing untitled rows
   against a titled section that does not exist: its rows overflowed their own
   padding box by 2.6px at each end, and ribPadTopUntitled / ribPadBottomUntitled
   stopped reserving space (they still shifted the rows, but not by what they
   said — the silent no-op in its quietest form).

   Required, rather than re-defaulted from designTokens, because this module is
   deliberately dependency-free — the store, the Toolbar and Customize all
   import it. A caller must resolve override-or-default first, which is what
   designValue() is for. There is then only one list of defaults in the app. */
export function ribbonKindVars(opts: {
  rowH: number;
  anyTitle: boolean;
  /** any UNTITLED section on the bar (default true) — contentH only counts
   *  the kinds that exist, or an all-titled bar would size to a phantom. */
  anyUntitled?: boolean;
  titleFont: number;   // --dz-rib-title-font
  /** --dz-rib-title-gap — the ONE title↔buttons spacing. May be NEGATIVE
   *  (v5.17): 0 is the true structural zero, and what remains at 0 is text
   *  descender + button centering — physics, not margin — so the knob dips
   *  below zero to tuck the buttons optically under the title. */
  titleGap: number;
  rowGapTitled: number;    // --dz-rib-row-gap-titled
  rowGapUntitled: number;  // --dz-rib-row-gap-untitled
  /** v5.17, Derek: "increasing the section bottom padding can push the title
   *  behind the top bar… the height of the bar should adjust instead."
   *  Per-kind paddings are part of each kind's TOTAL now, so contentH (and
   *  with it the bar's min-height) grows with them — padding can never
   *  overflow a section past the bar's edges again. */
  padTopTitled: number;
  padBottomTitled: number;
  padTopUntitled: number;
  padBottomUntitled: number;
  scaleTitledPct?: number;    // Design: ribScaleTitled, def 100
  scaleUntitledPct?: number;  // Design: ribScaleUntitled, def 100
}): RibbonKindVars {
  const titleFont = opts.titleFont;
  const titleGap = opts.titleGap;
  const gT = opts.rowGapTitled;
  const gU = opts.rowGapUntitled;
  const padT = opts.padTopTitled + opts.padBottomTitled;
  const padU = opts.padTopUntitled + opts.padBottomUntitled;
  // Every SCALED term mirrors a CSS rule that multiplies by --rib-k: the band
  // (font + 1.5), the title gap, the row heights and the row gap. Paddings
  // are deliberately unscaled insets, in CSS and here alike.
  const band = titleFont + 1.5;
  const titledInner = band + titleGap + 2 * opts.rowH + gT;
  const untitledInner = 2 * opts.rowH + gU;
  // Auto-fill targets the titled total at scale 100 — the user scales
  // multiply on top of a level baseline.
  const autoFill = opts.anyTitle
    ? Math.max(0.25, (padT + titledInner - padU) / untitledInner)
    : 1;
  const kTitled = (opts.scaleTitledPct ?? 100) / 100;
  const kUntitled = ((opts.scaleUntitledPct ?? 100) / 100) * autoFill;
  const anyUntitled = opts.anyUntitled ?? true;
  const contentH = Math.max(
    opts.anyTitle ? padT + kTitled * titledInner : 0,
    anyUntitled ? padU + kUntitled * untitledInner : 0,
  );
  return { kTitled, kUntitled, contentH };
}
