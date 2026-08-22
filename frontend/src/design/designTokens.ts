/**
 * Design tokens — the single source of truth for the live Design panel (v4.8).
 *
 * Each token is one numeric design knob (a size, padding, gap, radius or font
 * size) bound to a CSS custom property that the real stylesheet CONSUMES via
 * `var(--x, DEFAULT)`. The panel writes the property onto :root; unset, the
 * rule falls back to DEFAULT — which is the same literal that lives in the base
 * rule, so there's exactly one default and nothing to drift.
 *
 * Every `cssVar` here is a `--dz-*` knob we introduced: the base CSS rule was
 * edited to read `var(--dz-x, <original literal>)`, so a token's DEFAULT MUST
 * equal that fallback literal (a test enforces it). A token with more than one
 * usage — a base rule plus a mode-specific one, e.g. the ribbon small-button
 * width — just needs its default to match ONE of the fallbacks (the mode it
 * represents).
 *
 * What is deliberately NOT here, and why (all verified against the live app):
 *  - Values set INLINE from a store beat a :root override, so a slider here
 *    would be a dead no-op: --rib-gap / --rib-rowh (ribbon gap/height, own drag
 *    grips), --dock-scale / --chrome-scale, --ddw-* (dropdown widths), and the
 *    whole page geometry (width, margins, script font/line-height — applied
 *    inline from pageLayout; owned by Page Setup, and they reflow pagination).
 *
 * Adding a knob later = one entry here + making its CSS rule read the var, and
 * confirm it actually wins the cascade in the mode you use (a more specific rule
 * can shadow the base one). That's the whole point of this file: it replaces a
 * note-per-formatting-change.
 */

import { useEditorStore } from '../stores/editorStore';

type EditorStoreState = ReturnType<typeof useEditorStore.getState>;

export interface DesignToken {
  /** stable id, also the persisted key in the store's designVars map */
  id: string;
  label: string;
  /** the CSS custom property the stylesheet reads (css-var tokens) */
  cssVar?: string;
  /** OR a binding to an existing store field (store-bound tokens). Used for
   *  chrome dimensions the app already owns (spacing, sizes) so the slider
   *  drives that ONE system instead of a second, losing CSS variable. */
  store?: { get: (s: EditorStoreState) => number; set: (v: number) => void };
  /** '' for unitless (line-height) */
  unit: 'px' | 'in' | 'pt' | '';
  min: number;
  max: number;
  step: number;
  /** built-in value — equals the fallback literal in the base CSS rule */
  def: number;
  /** optional one-line hint shown under the control */
  hint?: string;
  /** v4.71: enumerated tokens (e.g. alignment). The panel renders these as a
   *  segmented row instead of a slider; the numeric `value` is what persists
   *  in designVars, and `css` is what the mirror writes to the custom
   *  property. min/max/step still bound the stored number. */
  choices?: { value: number; label: string; css: string }[];
}

export interface DesignGroup {
  id: string;
  label: string;
  tokens: DesignToken[];
}

export const DESIGN_GROUPS: DesignGroup[] = [
  {
    id: 'editor',
    label: 'Editor Surface',
    tokens: [
      // NB: page geometry — width, margins, script font size & line spacing —
      // is deliberately NOT here. It's owned by Page Setup (applied inline on
      // the page from the pageLayout store) and changing it reflows pagination,
      // so it belongs to that dialog, not a free design slider. Only chrome-ish
      // surface knobs live here.
      { id: 'editorMainPadTop', label: 'Space above first page', cssVar: '--dz-editor-main-pad-top', unit: 'px', min: 0, max: 120, step: 2, def: 42 },
      /* v7.25: the "Saved" flash on the page. Its SIZE is a knob; its drop
         below the ruler is not — that one is measured in the page's own inch
         (SavedFlash.tsx, so it holds at any zoom) and a css-var knob nothing
         in the stylesheet reads is a slider that does nothing, which the
         no-dead-knobs test below rightly refuses. */
      { id: 'savedFont', label: 'Saved flash — text size', cssVar: '--dz-saved-font', unit: 'px', min: 10, max: 32, step: 1, def: 17 },
    ],
  },
  {
    id: 'menu',
    label: 'Menu Bar',
    tokens: [
      // The menu BAR height/padding/label size all have compact/comfortable/
      // custom variants (and the custom height is set inline from the drag) —
      // that mode+drag system is their single source, so they live on the bar's
      // own resize handle and the View ▸ menu size, not here. Item spacing is
      // the one dimension applied uniformly (inline gap) in every mode, so it's
      // driven here through that same store field.
      { id: 'menuSpacing', label: 'Item spacing', unit: 'px', min: 0, max: 32, step: 1, def: 0,
        store: { get: (s) => s.chromeGapPx.menu, set: (v) => useEditorStore.getState().setChromeGap('menu', v) } },
      { id: 'menuDropdownMinW', label: 'Dropdown min width', cssVar: '--dz-menu-dd-minw', unit: 'px', min: 160, max: 400, step: 5, def: 325 },
    ],
  },
  {
    id: 'toolbar',
    label: 'Ribbon',
    tokens: [
      // Bar-level knobs only — everything per-SECTION-KIND lives in the three
      // groups below (v5.15, Derek's reorganisation). Button width/height
      // scale with the compact/comfortable/custom mode, so they're owned by
      // the toolbar mode + its height drag-bar, not here.
      { id: 'toolbarSpacing', label: 'Section spacing', unit: 'px', min: 0, max: 32, step: 1, def: 2,
        store: { get: (s) => s.chromeGapPx.toolbar, set: (v) => useEditorStore.getState().setChromeGap('toolbar', v) },
        hint: 'Gap between sections (and between big buttons).' },
      { id: 'ribPadTop', label: 'Bar top padding', cssVar: '--dz-rib-pad-top', unit: 'px', min: 0, max: 30, step: 1, def: 6 },
      { id: 'ribPadBottom', label: 'Bar bottom padding', cssVar: '--dz-rib-pad-bottom', unit: 'px', min: 0, max: 30, step: 1, def: 10 },
      /* v5.16, Derek: far-left / far-right bar padding. Setting the LEFT one
         takes over from the automatic menu-bar icon alignment (which writes
         an inline padding-left) — otherwise the knob would be a silent no-op
         whenever the auto-alignment is active. Reset to restore auto. */
      { id: 'ribPadLeft', label: 'Bar left padding', cssVar: '--dz-rib-pad-left', unit: 'px', min: 0, max: 40, step: 1, def: 10,
        hint: 'Overrides the automatic menu-bar alignment; Reset restores it.' },
      { id: 'ribPadRight', label: 'Bar right padding', cssVar: '--dz-rib-pad-right', unit: 'px', min: 0, max: 40, step: 1, def: 12 },
      { id: 'toolbarBtnRadius', label: 'Button corner radius', cssVar: '--dz-toolbar-btn-radius', unit: 'px', min: 0, max: 12, step: 1, def: 5 },
    ],
  },
  /* ── v5.15, Derek's spec: one group per section KIND, every spacing knob
     per kind, redundant globals REMOVED. Casualties of the de-dup:
     ribBtnGap + ribRowGap (globals → per-kind), ribTitlePad (the title's
     own bottom padding did the same job as the title↔buttons gap — merged
     into ribTitleGap, whose default grew 2→5 so nothing moved), and the two
     ribPadY* (split into top/bottom per Derek's list). */
  {
    id: 'ribbonTitled',
    label: 'Ribbon: Titled Sections',
    tokens: [
      { id: 'ribPadXTitled', label: 'Side padding', cssVar: '--dz-rib-pad-x-titled', unit: 'px', min: 0, max: 24, step: 1, def: 13 },
      { id: 'ribPadTopTitled', label: 'Top padding (above the title)', cssVar: '--dz-rib-pad-top-titled', unit: 'px', min: 0, max: 16, step: 1, def: 0 },
      { id: 'ribPadBottomTitled', label: 'Bottom padding', cssVar: '--dz-rib-pad-bottom-titled', unit: 'px', min: 0, max: 16, step: 1, def: 1 },
      { id: 'ribRowGapTitled', label: 'Row spacing', cssVar: '--dz-rib-row-gap-titled', unit: 'px', min: -14, max: 24, step: 1, def: -2,
        hint: 'Negative pulls the two rows together.' },
      /* v5.18, Derek: per ROW, and negative-capable — at 0 the button BOXES
         already touch; the air he still saw is each box's slack around its
         glyph, so closing it means overlapping boxes (margin, not flex gap).
         A saved ribBtnGapTitled override seeds both rows (designSlice). */
      { id: 'ribBtnGapTopTitled', label: 'Top row button spacing', cssVar: '--dz-rib-btn-gap-top-titled', unit: 'px', min: -10, max: 20, step: 1, def: 1,
        hint: 'Boxes touch at 0 — remaining air is inside each button; negative overlaps them.' },
      { id: 'ribBtnGapBottomTitled', label: 'Bottom row button spacing', cssVar: '--dz-rib-btn-gap-bottom-titled', unit: 'px', min: -10, max: 20, step: 1, def: 1,
        hint: 'Boxes touch at 0 — remaining air is inside each button; negative overlaps them.' },
      { id: 'ribTitleGap', label: 'Space between title and buttons', cssVar: '--dz-rib-title-gap', unit: 'px', min: -10, max: 20, step: 1, def: 1,
        hint: '0 removes the margin; what remains is the text\u2019s own descender and button centering \u2014 go negative to tuck the buttons under the title.' },
      { id: 'ribTitleFont', label: 'Title font size', cssVar: '--dz-rib-title-font', unit: 'px', min: 7, max: 16, step: 0.5, def: 10,
        hint: 'The title band grows with the font so rows stay aligned.' },
      { id: 'ribTitleAlign', label: 'Title alignment', cssVar: '--dz-rib-title-align', unit: '', min: 0, max: 2, step: 1, def: 1,
        choices: [
          { value: 0, label: 'Left', css: 'left' },
          { value: 1, label: 'Center', css: 'center' },
          { value: 2, label: 'Right', css: 'right' },
        ] },
      { id: 'ribScaleTitled', label: 'Section scale (%)', unit: '', min: 50, max: 200, step: 5, def: 100,
        hint: 'Size of buttons & rows in titled sections',
        store: { get: (s) => s.ribScaleTitledPct, set: (v) => useEditorStore.getState().setRibScaleTitledPct(v) } },
    ],
  },
  {
    id: 'ribbonUntitled',
    label: 'Ribbon: Untitled Sections',
    tokens: [
      { id: 'ribPadXUntitled', label: 'Side padding', cssVar: '--dz-rib-pad-x-untitled', unit: 'px', min: 0, max: 24, step: 1, def: 7 },
      { id: 'ribPadTopUntitled', label: 'Top padding', cssVar: '--dz-rib-pad-top-untitled', unit: 'px', min: 0, max: 16, step: 1, def: 2 },
      { id: 'ribPadBottomUntitled', label: 'Bottom padding', cssVar: '--dz-rib-pad-bottom-untitled', unit: 'px', min: 0, max: 16, step: 1, def: 5 },
      { id: 'ribRowGapUntitled', label: 'Row spacing', cssVar: '--dz-rib-row-gap-untitled', unit: 'px', min: -14, max: 24, step: 1, def: -3,
        hint: 'Negative pulls the two rows together.' },
      { id: 'ribBtnGapTopUntitled', label: 'Top row button spacing', cssVar: '--dz-rib-btn-gap-top-untitled', unit: 'px', min: -10, max: 20, step: 1, def: 0,
        hint: 'Boxes touch at 0 — remaining air is inside each button; negative overlaps them.' },
      { id: 'ribBtnGapBottomUntitled', label: 'Bottom row button spacing', cssVar: '--dz-rib-btn-gap-bottom-untitled', unit: 'px', min: -10, max: 20, step: 1, def: -1,
        hint: 'Boxes touch at 0 — remaining air is inside each button; negative overlaps them.' },
      { id: 'ribScaleUntitled', label: 'Section scale (%)', unit: '', min: 50, max: 200, step: 5, def: 100,
        hint: 'On top of auto-matching the titled sections\u2019 height',
        store: { get: (s) => s.ribScaleUntitledPct, set: (v) => useEditorStore.getState().setRibScaleUntitledPct(v) } },
    ],
  },
  {
    id: 'ribbonSingle',
    label: 'Ribbon: Single-Row Sections',
    tokens: [
      { id: 'ribPadXSingle', label: 'Side padding', cssVar: '--dz-rib-pad-x-single', unit: 'px', min: 0, max: 24, step: 1, def: 6 },
      { id: 'ribPadTopSingle', label: 'Top padding', cssVar: '--dz-rib-pad-top-single', unit: 'px', min: 0, max: 16, step: 1, def: 0 },
      { id: 'ribPadBottomSingle', label: 'Bottom padding', cssVar: '--dz-rib-pad-bottom-single', unit: 'px', min: 0, max: 16, step: 1, def: 0 },
      { id: 'toolbarBigIcon', label: 'Icon size', cssVar: '--dz-toolbar-big-icon', unit: 'px', min: 16, max: 40, step: 1, def: 28 },
      { id: 'toolbarBigLabel', label: 'Label font size', cssVar: '--dz-toolbar-big-label', unit: 'px', min: 7, max: 16, step: 0.5, def: 10 },
    ],
  },
  {
    id: 'panels',
    label: 'Panels & Windows',
    tokens: [
      // Panel WIDTHS are dragged (local state / resize handle) — that handle is
      // their single source. These are the fixed design details:
      { id: 'dockEdgeW', label: 'Dock edge grip width', cssVar: '--dz-dock-edge-w', unit: 'px', min: 2, max: 16, step: 1, def: 6 },
      { id: 'toolWinRadius', label: 'Tool window radius', cssVar: '--dz-toolwin-radius', unit: 'px', min: 0, max: 20, step: 1, def: 12 },
      // v4.46, Derek: header padding is FOUR per-side knobs now (was one
      // vertical-only toolWinHeaderPad — a saved override migrates into
      // top+bottom in designSlice). The docked strip rides the same vars
      // with its own tighter fallbacks (4/8 vs the frame's 6/10).
      { id: 'toolWinPadTop', label: 'Header padding — top', cssVar: '--dz-toolwin-pad-top', unit: 'px', min: 0, max: 20, step: 1, def: 4 },
      { id: 'toolWinPadBottom', label: 'Header padding — bottom', cssVar: '--dz-toolwin-pad-bottom', unit: 'px', min: 0, max: 20, step: 1, def: 6 },
      { id: 'toolWinPadLeft', label: 'Header padding — left', cssVar: '--dz-toolwin-pad-left', unit: 'px', min: 0, max: 28, step: 1, def: 18 },
      { id: 'toolWinPadRight', label: 'Header padding — right', cssVar: '--dz-toolwin-pad-right', unit: 'px', min: 0, max: 28, step: 1, def: 10 },
      // v4.47, Derek: the air between the window's name and its tabs (the
      // header's 8px column-gap sits on top of this margin).
      { id: 'toolWinTitleGap', label: 'Space after window name', cssVar: '--dz-toolwin-title-gap', unit: 'px', min: 0, max: 40, step: 1, def: 27 },
      /* v7.02 (remaining #4): 13px is the PANEL-title step of the scale
         (16 window / 13 panel / 11.5 section). */
      { id: 'toolWinTitleFont', label: 'Tool window title font', cssVar: '--dz-toolwin-title-font', unit: 'px', min: 9, max: 20, step: 0.5, def: 13 },
      // v4.45, Derek: header-bar tuning — the bar's control/tab type size and
      // the air between the header and the window's content, every shape.
      { id: 'toolWinBarFont', label: 'Header bar font size', cssVar: '--dz-toolwin-bar-font', unit: 'px', min: 9, max: 18, step: 0.5, def: 12,
        hint: 'Sizes the header bar\u2019s controls (Filter/Sort/View\u2026) and tabs; the title has its own knob.' },
      { id: 'toolWinBodyGap', label: 'Space above window content', cssVar: '--dz-toolwin-body-gap', unit: 'px', min: 0, max: 32, step: 1, def: 8,
        hint: 'Extra space between the header bar and the window\u2019s content \u2014 docked, popped out, and fullscreen alike.' },
    ],
  },
  {
    // v4.26, Derek: "as many formatting options from the character window as
    // possible" — the character tool's dimensions get their own group. The two
    // v4.22/v4.23 knobs moved here from Panels & Windows; their ids and cssVars
    // are persisted keys (designVars / users' saved overrides) and stayed
    // IDENTICAL — only the grouping and label wording changed.
    id: 'characters',
    label: 'Characters',
    tokens: [
      { id: 'charCardRadius', label: 'Card corner radius', cssVar: '--dz-char-card-radius', unit: 'px', min: 0, max: 20, step: 1, def: 14 },
      { id: 'charCardBorder', label: 'Card outline width', cssVar: '--dz-char-card-border', unit: 'px', min: 0, max: 6, step: 1, def: 1 },
      // v4.22, Derek: spacing of the character card header's right-side items
      // (line/scene count, the % ring, the expand button).
      { id: 'charHeaderGap', label: 'Header item spacing', cssVar: '--dz-char-header-gap', unit: 'px', min: 0, max: 32, step: 1, def: 15 },
      // v4.23, Derek: vertical gap between a character card's field rows — dial
      // it down to pack the card into a small window.
      { id: 'charFieldGap', label: 'Field row spacing', cssVar: '--dz-char-field-gap', unit: 'px', min: 0, max: 24, step: 1, def: 9 },
      { id: 'charDetailPad', label: 'Card detail padding', cssVar: '--dz-char-detail-pad', unit: 'px', min: 0, max: 24, step: 1, def: 14,
        hint: 'Around the expanded card body — sides/bottom keep their +2/+4px rhythm.' },
      { id: 'charInputH', label: 'Input field height', cssVar: '--dz-char-input-h', unit: 'px', min: 20, max: 40, step: 1, def: 28,
        hint: 'Each field keeps its own built-in height until this moves; then all match.' },
      // Drives the no-photo slot exactly AND caps the photo max-heights (the
      // stacked-layout photo falls back to its own 360px until the knob moves).
      { id: 'charImageH', label: 'Image slot height', cssVar: '--dz-char-image-h', unit: 'px', min: 60, max: 480, step: 5, def: 225 },
      { id: 'charCardMinW', label: 'Cards view — min card width', cssVar: '--dz-char-card-minw', unit: 'px', min: 240, max: 520, step: 10, def: 310 },
      // v4.50: charCardMinH is BACK (Derek asked for it) — a min-height on the
      // cards-view card in every shape; 0 keeps cards purely content-sized.
      { id: 'charCardMinH', label: 'Cards view — min card height', cssVar: '--dz-char-card-minh', unit: 'px', min: 0, max: 800, step: 10, def: 480 },
      { id: 'charDescLines', label: 'Cards view — description lines', cssVar: '--dz-char-desc-lines', unit: '', min: 1, max: 6, step: 1, def: 1,
        hint: 'Lines the description shows before clamping; clicking in still lifts it.' },
      // Store-bound (menuSpacing precedent): the size the Characters window
      // opens at, riding the SAME toolSizes entry the window's own resize drag
      // persists — one system, no second source. 420×360 mirrors ALL_TOOLS'
      // defaultSize for 'characters' (a test greps ToolDock.tsx to keep them
      // equal). Setting one dimension carries the other over unchanged.
      { id: 'charWinW', label: 'Window default width', unit: 'px', min: 280, max: 900, step: 10, def: 420,
        hint: 'Dragging the window edge updates this too.',
        store: { get: (s) => s.toolSizes.characters?.w ?? 420,
                 set: (v) => { const st = useEditorStore.getState(); st.setToolSize('characters', v, st.toolSizes.characters?.h ?? 360); } } },
      { id: 'charWinH', label: 'Window default height', unit: 'px', min: 240, max: 800, step: 10, def: 360,
        store: { get: (s) => s.toolSizes.characters?.h ?? 360,
                 set: (v) => { const st = useEditorStore.getState(); st.setToolSize('characters', st.toolSizes.characters?.w ?? 420, v); } } },
    ],
  },
  /* v5.24, Derek: the Notes WINDOW's own spacing knobs. Side gutters live
     on the scroller (the sticky-scoped card margin is zeroed); the row and
     column gaps feed the v5.36 equal-height grid. */
  {
    id: 'stickyWindow',
    label: 'Notes',
    tokens: [
      { id: 'stickyPadX', label: 'Side padding', cssVar: '--dz-sticky-pad-x', unit: 'px', min: 0, max: 32, step: 1, def: 12 },
      { id: 'stickyPadTop', label: 'Top padding (below the buttons)', cssVar: '--dz-sticky-pad-top', unit: 'px', min: 0, max: 32, step: 1, def: 6 },
      { id: 'stickyPadBottom', label: 'Bottom padding', cssVar: '--dz-sticky-pad-bottom', unit: 'px', min: 0, max: 32, step: 1, def: 4 },
      { id: 'stickyColGap', label: 'Column gap', cssVar: '--dz-sticky-col-gap', unit: 'px', min: 0, max: 32, step: 1, def: 10 },
      { id: 'stickyRowGap', label: 'Row gap', cssVar: '--dz-sticky-row-gap', unit: 'px', min: 0, max: 32, step: 1, def: 10 },
      { id: 'stickyBtnRowPadTop', label: 'Space above the + buttons', cssVar: '--dz-sticky-btnrow-pad-top', unit: 'px', min: 0, max: 24, step: 1, def: 6 },
      { id: 'stickyBtnRowPadX', label: 'Button row side padding', cssVar: '--dz-sticky-btnrow-pad-x', unit: 'px', min: 0, max: 32, step: 1, def: 8 },
    ],
  },
  {
    id: 'cards',
    label: 'Sticky Note Cards',
    tokens: [
      /* v5.24, Derek: the card's padding is three knobs (cardPad KEEPS its
         id — it always drove the TOP edge; persisted overrides survive). */
      { id: 'cardPad', label: 'Top padding', cssVar: '--dz-swn-card-pad', unit: 'px', min: 2, max: 20, step: 1, def: 8 },
      { id: 'cardPadX', label: 'Side padding', cssVar: '--dz-swn-card-pad-x', unit: 'px', min: 0, max: 24, step: 1, def: 10 },
      { id: 'cardPadBottom', label: 'Bottom padding', cssVar: '--dz-swn-card-pad-bottom', unit: 'px', min: 0, max: 24, step: 1, def: 10 },
      { id: 'cardHeadGap', label: 'Title to body spacing', cssVar: '--dz-swn-head-gap', unit: 'px', min: 0, max: 20, step: 1, def: 6 },
      { id: 'cardFootGap', label: 'Body to footer spacing', cssVar: '--dz-swn-foot-gap', unit: 'px', min: 0, max: 20, step: 1, def: 6 },
      { id: 'cardActionsGap', label: 'Button spacing', cssVar: '--dz-swn-actions-gap', unit: 'px', min: 0, max: 16, step: 1, def: 6,
        hint: 'The color, clear-completed and delete buttons in the card head.' },
      { id: 'cardRadius', label: 'Card corner radius', cssVar: '--dz-swn-card-radius', unit: 'px', min: 0, max: 16, step: 1, def: 4 },
      { id: 'cardFont', label: 'Card body font', cssVar: '--dz-swn-card-font', unit: 'px', min: 9, max: 18, step: 0.5, def: 12 },
      { id: 'cardHeadFont', label: 'Card title font', cssVar: '--dz-swn-card-head-font', unit: 'px', min: 9, max: 16, step: 0.5, def: 11 },
      { id: 'cardDot', label: 'Color dot size', cssVar: '--dz-swn-dot', unit: 'px', min: 6, max: 20, step: 1, def: 12 },
      { id: 'snippetFont', label: 'Snippet (code) font', cssVar: '--dz-swn-snippet-font', unit: 'px', min: 8, max: 18, step: 0.5, def: 11 },
      { id: 'genNoteTitleFont', label: 'Script-note title font', cssVar: '--dz-gen-note-title-font', unit: 'px', min: 9, max: 20, step: 0.5, def: 13 },
    ],
  },
  {
    id: 'scrapbook',
    label: 'Scrapbook',
    tokens: [
      { id: 'nbFont', label: 'Scrapbook base font', cssVar: '--dz-nb-font', unit: 'px', min: 10, max: 18, step: 0.5, def: 13 },
      { id: 'nbCellPadX', label: 'Table cell padding — horizontal', cssVar: '--dz-nb-cell-padx', unit: 'px', min: 2, max: 16, step: 1, def: 7 },
      { id: 'nbCellPadY', label: 'Table cell padding — vertical', cssVar: '--dz-nb-cell-pady', unit: 'px', min: 1, max: 14, step: 1, def: 5 },
      { id: 'nbCellFont', label: 'Table cell font', cssVar: '--dz-nb-cell-font', unit: 'px', min: 9, max: 18, step: 0.5, def: 12.5 },
      { id: 'nbTitleFont', label: 'Page title font', cssVar: '--dz-nb-title-font', unit: 'px', min: 12, max: 40, step: 1, def: 20 },
      { id: 'nbSideHeadFont', label: 'Sidebar heading font', cssVar: '--dz-nb-sidehead-font', unit: 'px', min: 8, max: 18, step: 0.5, def: 11 },
    ],
  },
  {
    id: 'dialogs',
    label: 'Dialogs',
    tokens: [
      { id: 'dialogRadius', label: 'Dialog corner radius', cssVar: '--dz-dialog-radius', unit: 'px', min: 0, max: 20, step: 1, def: 6 },
      { id: 'dialogHeaderPadY', label: 'Header padding', cssVar: '--dz-dialog-header-pady', unit: 'px', min: 4, max: 28, step: 1, def: 13 },
      { id: 'dialogHeaderFont', label: 'Header font size', cssVar: '--dz-dialog-header-font', unit: 'px', min: 12, max: 24, step: 0.5, def: 16 },
      { id: 'dialogBodyPad', label: 'Body padding', cssVar: '--dz-dialog-body-pad', unit: 'px', min: 4, max: 40, step: 1, def: 20 },
      { id: 'dialogBtnHeight', label: 'Button height', cssVar: '--dz-dialog-btn-h', unit: 'px', min: 24, max: 48, step: 1, def: 34 },
      /* v7.01 (style audit F137): the compact button (.dialog-btn-sm) is now a
         real size rather than the full-height button with smaller text. */
      { id: 'dialogBtnHeightSm', label: 'Small button height', cssVar: '--dz-dialog-btn-h-sm', unit: 'px', min: 18, max: 40, step: 1, def: 26 },
      /* v7.02 (style audit remaining #7): 5px is the house corner radius —
         it was 4 here and 6/7/8 on six other button kinds. */
      { id: 'dialogBtnRadius', label: 'Button corner radius', cssVar: '--dz-dialog-btn-radius', unit: 'px', min: 0, max: 16, step: 1, def: 5 },
      { id: 'dialogLabelFont', label: 'Field label font', cssVar: '--dz-dialog-label-font', unit: 'px', min: 10, max: 20, step: 0.5, def: 14 },
      { id: 'dialogInputH', label: 'Input height', cssVar: '--dz-dialog-input-h', unit: 'px', min: 24, max: 48, step: 1, def: 36 },
      /* v7.02 (remaining #2): ONE dropdown size. Ten different heights were in
         use (22-36px); the toolbar keeps a compact variant because its row
         genuinely can't fit the standard one. */
      { id: 'selectH', label: 'Dropdown height', cssVar: '--dz-select-h', unit: 'px', min: 20, max: 44, step: 1, def: 28 },
      { id: 'selectHCompact', label: 'Dropdown height (toolbar)', cssVar: '--dz-select-h-compact', unit: 'px', min: 16, max: 36, step: 1, def: 22 },
      { id: 'selectFont', label: 'Dropdown font size', cssVar: '--dz-select-font', unit: 'px', min: 9, max: 18, step: 0.5, def: 12.5 },
    ],
  },
  {
    id: 'beatboard',
    label: 'Beatboard & Index Cards',
    tokens: [
      { id: 'beatColGap', label: 'Column gap', cssVar: '--dz-beat-col-gap', unit: 'px', min: 0, max: 40, step: 1, def: 16 },
      { id: 'beatColMinW', label: 'Column min width', cssVar: '--dz-beat-col-minw', unit: 'px', min: 180, max: 400, step: 5, def: 280 },
      { id: 'beatCardRadius', label: 'Beat card radius', cssVar: '--dz-beat-card-radius', unit: 'px', min: 0, max: 16, step: 1, def: 6 },
      { id: 'beatCardPad', label: 'Beat card padding', cssVar: '--dz-beat-card-pad', unit: 'px', min: 2, max: 24, step: 1, def: 10 },
      { id: 'icRadius', label: 'Index card radius', cssVar: '--dz-ic-radius', unit: 'px', min: 0, max: 16, step: 1, def: 6 },
      { id: 'icHeadingFont', label: 'Index card heading font', cssVar: '--dz-ic-heading-font', unit: 'px', min: 9, max: 18, step: 0.5, def: 12 },
      { id: 'icBadge', label: 'Index card badge size', cssVar: '--dz-ic-badge', unit: 'px', min: 14, max: 36, step: 1, def: 24 },
      { id: 'beatColHeadPad', label: 'Column header padding', cssVar: '--dz-beat-col-head-pad', unit: 'px', min: 2, max: 20, step: 1, def: 8 },
    ],
  },
  {
    id: 'navigator',
    label: 'Navigator & Outline',
    tokens: [
      /* v7.41: 'Panel title font' (navTitleFont / --dz-nav-title-font) is GONE.
         Its only reader was `.navigator-title`, in a panel header that no
         component renders any more — the tool dock draws its own. The slider
         had been styling nothing since that rewrite; deleting the dead rule is
         what surfaced it, and the no-dead-knobs test is what refused to let it
         through. A stale persisted override is harmless: applyDesignVars
         ignores ids it does not know. */
      { id: 'navScenePadY', label: 'Scene row padding', cssVar: '--dz-nav-scene-pady', unit: 'px', min: 2, max: 24, step: 1, def: 2 },
      { id: 'navSceneFont', label: 'Scene heading font', cssVar: '--dz-nav-scene-font', unit: 'px', min: 10, max: 20, step: 0.5, def: 14 },
      { id: 'navSynopsisFont', label: 'Scene synopsis font', cssVar: '--dz-nav-synopsis-font', unit: 'px', min: 8, max: 18, step: 0.5, def: 11 },
      { id: 'navBadge', label: 'Scene number badge size', cssVar: '--dz-nav-badge', unit: 'px', min: 14, max: 32, step: 1, def: 22 },
      { id: 'pagesRowGap', label: 'Pages: space below each page', cssVar: '--dz-pages-row-gap', unit: 'px', min: 0, max: 48, step: 1, def: 14 },
      { id: 'pagesCtlGap', label: 'Pages: header button spacing', cssVar: '--dz-pages-ctl-gap', unit: 'px', min: 0, max: 40, step: 1, def: 10 },
      { id: 'scenesTableMin', label: 'Scenes: min width for full table', unit: 'px', min: 300, max: 2000, step: 10, def: 700,
        hint: 'Narrower than this, the scene list compresses to caret rows',
        store: { get: (s) => s.scenesTableMinW, set: (v) => useEditorStore.getState().setScenesTableMinW(v) } },
      { id: 'obPad', label: 'Outline bar padding', cssVar: '--dz-ob-pad', unit: 'px', min: 0, max: 16, step: 1, def: 0 },
      /* v7.04: 'Outline title font' is GONE. Its only consumer was `.fs-ob-title`,
         a rule no component has rendered for some time — so the Design window was
         offering a slider that moved nothing. The dead-CSS sweep removed the rule
         and the no-dead-knobs test immediately caught the orphaned token, which is
         exactly what that test is for. */
      { id: 'obIconBtn', label: 'Outline icon button size', cssVar: '--dz-ob-iconbtn', unit: 'px', min: 18, max: 36, step: 1, def: 23 },
    ],
  },
  {
    // v5.66, Derek: the Focus tool's layout knobs — side padding, section
    // spacing, the works. Defs mirror the base CSS fallbacks exactly (the
    // no-dead-knobs test holds this group to the same contract as the rest).
    id: 'focus',
    label: 'Focus Tool',
    tokens: [
      { id: 'focusPad', label: 'Side padding', cssVar: '--dz-focus-pad', unit: 'px', min: 0, max: 32, step: 1, def: 29 },
      { id: 'focusRowGap', label: 'Row spacing', cssVar: '--dz-focus-row-gap', unit: 'px', min: 0, max: 24, step: 1, def: 8 },
      { id: 'focusSectionGap', label: 'Section spacing (above)', cssVar: '--dz-focus-section-gap', unit: 'px', min: 0, max: 32, step: 1, def: 10 },
      { id: 'focusSectionBelow', label: 'Section spacing (below)', cssVar: '--dz-focus-section-below', unit: 'px', min: 0, max: 32, step: 1, def: 31 },
      { id: 'focusIndent', label: 'Sub-option indent', cssVar: '--dz-focus-indent', unit: 'px', min: 0, max: 40, step: 1, def: 26 },
    ],
  },
  {
    // v5.27, Derek: the on-script annotation icons get a size knob. Store-
    // bound — the icon layer needs the NUMBER for its centering math, so a
    // CSS var alone couldn't drive it.
    id: 'annotations',
    label: 'Annotations',
    tokens: [
      { id: 'markupIconScale', label: 'Script icon size (%)', unit: '', min: 50, max: 200, step: 5, def: 100,
        hint: 'Scale of the annotation icons in the page margin.',
        store: { get: (s) => s.markupIconScalePct, set: (v) => useEditorStore.getState().setMarkupIconScalePct(v) } },
      // v5.29, Derek: the annotation window's head row (Icon:/Highlight: groups)
      { id: 'annoHeadGap', label: 'Window: label-to-swatch spacing', cssVar: '--dz-anno-head-gap', unit: 'px', min: 0, max: 20, step: 1, def: 3 },
      { id: 'annoGroupGap', label: 'Window: icon-to-highlight spacing', cssVar: '--dz-anno-group-gap', unit: 'px', min: 0, max: 40, step: 1, def: 13 },
      { id: 'annoHeadPad', label: 'Window: top row padding', cssVar: '--dz-anno-head-pad', unit: 'px', min: 0, max: 24, step: 1, def: 0 },
      // v5.42, Derek: the In Navigator / In Script section — all four sides
      { id: 'annoPrevPadTop', label: 'Previews: top padding', cssVar: '--dz-anno-prev-pad-top', unit: 'px', min: 0, max: 32, step: 1, def: 15 },
      { id: 'annoPrevPadRight', label: 'Previews: right padding', cssVar: '--dz-anno-prev-pad-right', unit: 'px', min: 0, max: 32, step: 1, def: 13 },
      { id: 'annoPrevPadBottom', label: 'Previews: bottom padding', cssVar: '--dz-anno-prev-pad-bottom', unit: 'px', min: 0, max: 32, step: 1, def: 5 },
      { id: 'annoPrevPadLeft', label: 'Previews: left padding', cssVar: '--dz-anno-prev-pad-left', unit: 'px', min: 0, max: 32, step: 1, def: 9 },
    ],
  },
  {
    id: 'feedback',
    label: 'Feedback',
    tokens: [
      // v6.93/v6.94, Derek: every gap he called out in the Feedback window,
      // plus the window paddings. All plain css-var knobs on fb-* rules.
      // (v6.94 removed fbHelpGap with the ? itself; a stale persisted value
      // is ignored by applyDesignVars — the designed-for orphan case.)
      { id: 'fbNameGap', label: 'Space after "Name:"', cssVar: '--dz-fb-name-gap', unit: 'px', min: 0, max: 24, step: 1, def: 13 },
      { id: 'fbEditGap', label: 'Name to Edit button', cssVar: '--dz-fb-edit-gap', unit: 'px', min: 0, max: 32, step: 1, def: 15 },
      { id: 'fbTypeGap', label: '"Type:" to its dropdown', cssVar: '--dz-fb-type-gap', unit: 'px', min: 0, max: 32, step: 1, def: 12 },
      { id: 'fbDescGap', label: '"Description:" to the text box', cssVar: '--dz-fb-desc-gap', unit: 'px', min: 0, max: 24, step: 1, def: 7 },
      { id: 'fbHeadGap', label: 'Label to attach buttons', cssVar: '--dz-fb-head-gap', unit: 'px', min: 0, max: 40, step: 1, def: 6 },
      { id: 'fbBtnGap', label: 'Between attach buttons', cssVar: '--dz-fb-btn-gap', unit: 'px', min: 0, max: 24, step: 1, def: 0 },
      { id: 'fbHeadRowGap', label: 'Header to wrapped button row', cssVar: '--dz-fb-headrow-gap', unit: 'px', min: 0, max: 24, step: 1, def: 17,
        hint: 'Only visible when a narrow window wraps the buttons onto their own row.' },
      { id: 'fbAttachGap', label: 'Extra space above the attach box', cssVar: '--dz-fb-attach-gap', unit: 'px', min: 0, max: 32, step: 1, def: 0,
        hint: 'Adds to the row spacing between the text box and the attach box.' },
      { id: 'fbRowGap', label: 'Between rows', cssVar: '--dz-fb-row-gap', unit: 'px', min: 0, max: 32, step: 1, def: 9 },
      { id: 'fbSubmitGap', label: 'Extra space above Submit', cssVar: '--dz-fb-submit-gap', unit: 'px', min: 0, max: 40, step: 1, def: 0,
        hint: 'Adds to the row spacing between the attach box and the Submit row.' },
      { id: 'fbPadSide', label: 'Window side padding', cssVar: '--dz-fb-pad-side', unit: 'px', min: 0, max: 40, step: 1, def: 17 },
      { id: 'fbPadTop', label: 'Window top padding', cssVar: '--dz-fb-pad-top', unit: 'px', min: 0, max: 40, step: 1, def: 8 },
      { id: 'fbPadBottom', label: 'Window bottom padding', cssVar: '--dz-fb-pad-bottom', unit: 'px', min: 0, max: 40, step: 1, def: 0 },
    ],
  },
  {
    id: 'settingsWin',
    label: 'Settings Window',
    tokens: [
      // v6.97/v6.98, Derek (via the feedback form): the section boxes'
      // spacing, for EVERY tab at once (they all share .prefs-general
      // section). v6.98 moved the title INSIDE the box, so "title to first
      // item" is the h3's own margin and top padding is the box's again.
      { id: 'prefsPadTop', label: 'Section top padding', cssVar: '--dz-prefs-pad-top', unit: 'px', min: 0, max: 40, step: 1, def: 12 },
      { id: 'prefsTitleGap', label: 'Title to first item', cssVar: '--dz-prefs-title-gap', unit: 'px', min: 0, max: 32, step: 1, def: 15 },
      { id: 'prefsPadBottom', label: 'Section bottom padding', cssVar: '--dz-prefs-pad-bottom', unit: 'px', min: 0, max: 40, step: 1, def: 14 },
      { id: 'prefsPadSide', label: 'Section side padding', cssVar: '--dz-prefs-pad-side', unit: 'px', min: 0, max: 40, step: 1, def: 17 },
      { id: 'prefsSectionGap', label: 'Space between sections', cssVar: '--dz-prefs-section-gap', unit: 'px', min: 0, max: 48, step: 1, def: 25 },
    ],
  },
  {
    id: 'behavior',
    label: 'Behavior',
    tokens: [
      { id: 'mapScrollSpeed', label: 'Relationship map scroll speed', unit: '', min: 0.1, max: 3, step: 0.1, def: 1,
        hint: 'Lower = slower scroll-to-zoom in the character relationship map.',
        store: { get: (s) => s.mapScrollSpeed, set: (v) => useEditorStore.getState().setMapScrollSpeed(v) } },
    ],
  },
];

/** Flat list, handy for lookups and apply. */
export const DESIGN_TOKENS: DesignToken[] = DESIGN_GROUPS.flatMap((g) => g.tokens);

const BY_ID: Record<string, DesignToken> = Object.fromEntries(DESIGN_TOKENS.map((t) => [t.id, t]));

export function designToken(id: string): DesignToken | undefined {
  return BY_ID[id];
}

/**
 * What a knob is set to RIGHT NOW: the override if one exists, otherwise the
 * token's own default.
 *
 * v7.76. Almost nothing needs this — the CSS resolves it for free, because
 * applyDesignVars writes overrides onto :root and every rule falls back to
 * `var(--dz-x, <the same default>)`. But anything that computes a LENGTH IN
 * JAVASCRIPT has no such fallback, and reading `designVars[id]` alone silently
 * treats "unchanged" as "zero" or as whatever literal that caller happens to
 * carry.
 *
 * That is precisely how the ribbon's auto-fill broke: Toolbar.tsx handed the
 * raw override map to ribbonKindVars, whose own `??` numbers had drifted from
 * the stylesheet's. It could not surface while Derek's values arrived as
 * overrides — the map was full, so the fallbacks never ran — and it appeared
 * the moment those values became the defaults and the map emptied.
 *
 * So: JS that needs a design length calls this. Never designVars[id].
 */
export function designValue(vars: Record<string, number>, id: string): number {
  const t = BY_ID[id];
  if (!t) throw new Error(`designValue: no design token with id '${id}'`);
  const v = vars[id];
  // Same clamp the panel applies on commit — a hand-edited preset can carry a
  // value no control could reach, and this is a second read path for it.
  return typeof v === 'number' && !Number.isNaN(v) ? clampTokenValue(t, v) : t.def;
}

/** Format a numeric value with its unit for a CSS declaration. Choice tokens
 *  emit the selected option's css keyword (falling back to the default's). */
export function formatTokenValue(t: DesignToken, val: number): string {
  if (t.choices) {
    return (t.choices.find((c) => c.value === val) ??
      t.choices.find((c) => c.value === t.def) ?? t.choices[0]).css;
  }
  return `${val}${t.unit}`;
}

/**
 * A stored value held to the range its own control can express.
 *
 * v7.32: the panel clamped on COMMIT and nowhere else, so a number that never
 * came from the panel was painted verbatim. designVars is a persisted map — it
 * rides in Design presets (presets.ts collects it whole), in settings backups
 * (any `opendraft:*` key is written back verbatim), and in hand-edited JSON.
 * An imported `editorMainPadTop: 400` therefore painted a 400px void above the
 * first page, while the slider that owns it stops at 120: a value with no
 * control that can reach it, which is the silent no-op in reverse — the writer
 * can see the damage and has nothing to drag to undo it.
 *
 * Clamping to min/max (not snapping to `def`) is deliberate: it preserves
 * whatever intent the number had, and it is exactly what the slider would have
 * done with the same input. A token whose max is LOWERED in a later version
 * lands on the new max rather than losing the customization entirely.
 * Choice tokens are bounded the same way — min/max still bound the stored
 * number, and formatTokenValue already falls back to the default's keyword.
 */
export function clampTokenValue(t: DesignToken, val: number): number {
  return Math.min(t.max, Math.max(t.min, val));
}

/** Every KNOWN token's value held to its range. Unknown ids pass through
 *  untouched — they may belong to a migration key (migrateDesignVars) or a
 *  token this build doesn't have, and applyDesignVars ignores them anyway. */
export function clampDesignVars(vars: Record<string, number>): Record<string, number> {
  let out = vars;
  for (const [id, v] of Object.entries(vars)) {
    const t = BY_ID[id];
    if (!t || typeof v !== 'number' || Number.isNaN(v)) continue;
    const c = clampTokenValue(t, v);
    if (c === v) continue;
    if (out === vars) out = { ...vars };  // copy only once, and only if needed
    out[id] = c;
  }
  return out;
}

/**
 * Mirror the current overrides onto :root. For every KNOWN token: an override
 * sets its property, and absence removes it (so the CSS fallback — the built-in
 * default — takes over). Unknown keys are ignored so a stale persisted value
 * from a renamed token can't leak onto the DOM.
 */
export function applyDesignVars(vars: Record<string, number>): void {
  const root = document.documentElement;
  for (const t of DESIGN_TOKENS) {
    if (!t.cssVar) continue; // store-bound tokens drive the store, not :root
    const v = vars[t.id];
    if (v === undefined || v === null || Number.isNaN(v)) {
      root.style.removeProperty(t.cssVar);
    } else {
      root.style.setProperty(t.cssVar, formatTokenValue(t, clampTokenValue(t, v)));
    }
  }
}

/**
 * Build a copy-pasteable CSS block of just the OVERRIDDEN tokens, so a chosen
 * look can be baked into the stylesheet permanently instead of living in
 * localStorage. Returns '' when nothing is overridden.
 */
export function buildOverrideCss(vars: Record<string, number>): string {
  const lines = DESIGN_TOKENS
    .filter((t) => t.cssVar && vars[t.id] !== undefined && vars[t.id] !== t.def)
    // v7.32: the same clamp the DOM gets — Copy CSS must dump what the app is
    // actually painting, not the raw number a preset happened to carry in.
    .map((t) => `  ${t.cssVar}: ${formatTokenValue(t, clampTokenValue(t, vars[t.id]))};`);
  if (!lines.length) return '';
  return `:root {\n${lines.join('\n')}\n}`;
}
