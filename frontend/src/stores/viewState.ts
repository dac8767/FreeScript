// v4.23: view-state persistence, extracted from editorStore so store SLICES can
// read their initial defaults (`_vs`) and persist changes (`saveViewState`)
// without importing editorStore.ts — which would be a circular dependency.
//
// The type imports below are type-only (erased at runtime), so this module has
// NO runtime dependency on editorStore and always evaluates first. `_vs` is
// therefore ready before editorStore's module-level migrations and create() run.
import type { ToolConfig, WorkspaceSnapshot, WritingGoal, OutlineBarRow, SpellingSettings } from './editorStore';
// v7.70: a VALUE import, and deliberately the first one. seedDefaultSettings()
// has to have written the shipped defaults into localStorage before `_vs` is
// read at the bottom of this file — every slice's initial value comes from
// that object, so a seed that lands afterwards is a seed nobody sees.
// seedDefaults imports two leaves (workspaceFields, settingsBackup) and this
// module imports no values at all, so there is no cycle to lose the race to.
import { seedDefaultSettings } from './seedDefaults';

const VIEW_STATE_KEY = 'opendraft:viewState';

export interface ViewState {
  navigatorOpen?: boolean;
  showUnreleasedTools?: boolean;
  typewriterMasterEnabled?: boolean;
  typewriterEnabled?: boolean;
  typewriterFollowCursor?: boolean;
  typewriterOffset?: number;
  typewriterHighlightLine?: boolean;
  typewriterHighlightColor?: string;
  typewriterDimOthers?: boolean;
  typewriterDimMode?: 'elements' | 'sentences';
  typewriterDimOpacity?: number;
  typewriterRestoreCursor?: boolean;
  outlineBarOpen?: boolean;
  rulersVisible?: boolean;
  /** v4.59, Derek: Enter-key element suggestions — 'smart' filters by the
   *  follows-what grammar table, 'all' shows every element. */
  suggestionMode?: 'smart' | 'all';
  /** v4.59: the user's edited follows-what table (Customize ▸ Editor ▸
   *  Element Suggestions); null/absent = the built-in default. */
  suggestionRules?: Record<string, string[]> | null;
  /** v7.73: workspaces kept out of the menu and the Workspaces panel's list —
   *  still listed (with the eye) in Edit Workspaces…. */
  workspacesHidden?: string[];
  qatItems?: string[];
  /** v3.34: per-dropdown widths for the ribbon's select fields (px), keyed
   *  by builtin key — set by dragging a dropdown's edge in the visual
   *  editor, read by the live bar AND the editor (one source). */
  toolbarDdWidths?: Record<string, number>;
  outlineBarZoom?: number;
  outlineBarRowScale?: number;
  outlineUnsortedWidth?: number;
  scrapbookTreeScale?: number;
  bigBtnInsetPx?: number;
  panelItemScale?: { left: number; right: number };
  mapScrollSpeed?: number;
  /** v4.8: Design panel overrides — numeric design tokens keyed by token id
   *  (src/design/designTokens.ts). Each maps to a --dz-* custom property on
   *  :root; absent keys fall back to the built-in CSS value. */
  designVars?: Record<string, number>;
  /** v5.25: Customize ▸ Markups — the popover's predefined icon+color combos. */
  markupPresets?: { icon: string; color: string }[];
  markupHiddenIcons?: string[];
  markupIconScalePct?: number;
  markupScriptDone?: 'open' | 'done' | 'all';
  /** v5.29: 'Used' replaced the recents (derived live from markups);
   *  the old markupRecentColors/markupRecentIcons keys are ignored. */
  markupCustomIcons?: { id: string; data: string }[];
  /** v5.25: markup visibility on the script (margin icons + highlights). */
  markupsVisible?: boolean;
  outlineBarRows?: OutlineBarRow[];
  outlineBarLabels?: boolean;
  beatColorAllTabs?: boolean;
  uiResizeLocked?: boolean;
  highlightColor?: string;
  /** legacy (pre-v4.24): read once to seed scenesViewMode, never written. */
  indexCardsOpen?: boolean;
  /** v4.24 batch 7: the merged Scenes tool's view — scene list or index cards. */
  scenesViewMode?: 'list' | 'cards';
  /** v5.67: the Pages window's header tab. v5.71: + 'all' (All Pages). */
  pagesTab?: 'script' | 'title' | 'custom' | 'all';
  /** v5.75: the Locations window's header tab (List / Map). */
  locationsTab?: 'list' | 'map';
  /** v5.03: the scene list's resizable column widths, in px. The synopsis
   *  column takes the remainder, so these two describe the whole table. */
  sceneColWidths?: { head: number; metrics: number; locName?: number; charName?: number };
  charFilterInScript?: boolean;
  charFilterHasImage?: boolean;
  charFilterHasDesc?: boolean;
  relSort?: string;
  goalShowIn?: string;
  /** v6.20, Derek's Helper Text editor: overrides keyed by the DEFAULT
   *  string — one edit applies everywhere that exact text appears. */
  helperTextOverrides?: Record<string, string>;
  /** v6.24: rows Derek has reviewed and cleared from the Helper Text list
   *  (keyed by default string; recallable via the Hidden view). */
  helperTextHidden?: string[];
  /** v5.85: the Locations List view's Group toggle. */
  locationsGrouped?: boolean;
  /** v5.12: below this tool width the scene list compresses to caret rows.
   *  Driven by the Design slider ("Scenes: min width for full table"). */
  scenesTableMinW?: number;
  /** v5.14: per-kind ribbon scale (%), Design-driven. */
  ribScaleTitledPct?: number;
  ribScaleUntitledPct?: number;
  /** v4.27 window template: Characters' persisted view choices. */
  charViewMode?: 'cards' | 'list';
  relViewMode?: 'list' | 'map';
  /** v4.32 batch-v8: Navigator scene numbers + Design collapsed groups. */
  navShowSceneNumbers?: boolean;
  designCollapsedGroups?: string[];
  beatBoardOpen?: boolean;
  shelfOpen?: boolean;
  activeTool?: string | null;
  activeToolRight?: string | null;
  toolConfig?: Record<string, ToolConfig>;
  toolOrder?: string[];
  viewStyle?: string;
  menuBarOrder?: string[];
  menuBarHidden?: string[];
  toolbarLeft?: string[];
  toolbarRight?: string[];
  toolbarZonesSet?: boolean;
  contextMenuHidden?: string[];
  contextMenuOrder?: string[];
  /** legacy (pre-v5.22): the separate Notes/To-Do manual orders — the merged
   *  list's manual order is the shelfCards array itself now. Never read. */
  noteOrder?: string[];
  todoOrder?: string[];
  /** v5.22: the Sticky Notes header tabs, user-reordered; [0] is also the
   *  view the tool opens on. */
  /** retired v5.36 (Notes v2 has no kind tabs) — old saved values ignored */
  stickyTabOrder?: ('all' | 'note' | 'todo')[];
  panelSizeMode?: { left: 'compact' | 'comfortable' | 'custom' | 'icons'; right: 'compact' | 'comfortable' | 'custom' | 'icons' };
  /** v4.24, Derek: side-panel display names — Title Case (as authored) or ALL CAPS. */
  panelNameCase?: 'title' | 'upper';
  chromeCustomPx?: { menu: number; toolbar: number; panelLeft: number; panelRight: number };
  /** v2.29: item spacing (flex gap, px) for the menu bar, toolbar and Big
   *  Button section — adjusted by the faint drag handles on the bars. */
  chromeGapPx?: { menu?: number; toolbar?: number; bigbtn?: number; scrapbook?: number };
  panelDividers?: { id: string; label: string; side: 'left' | 'right'; spacer?: boolean; size?: number }[];
  workspaces?: Record<string, WorkspaceSnapshot>;
  workspaceOrder?: string[];
  activeWorkspace?: string | null;
  toolbarHiddenItems?: string[];
  toolbarPinnedTools?: string[];
  toolSizes?: Record<string, { w: number; h: number }>;
  /** v4.52: EXPLICIT docked/floating per tool — replaces the width<=dock rule. */
  /** v4.81: 'fullscreen' joined — a tool reopens in its last-used shape. */
  toolMode?: Record<string, 'docked' | 'floating' | 'fullscreen'>;
  /** v7.29: the shape a FloatingWindow (Settings, Helper Text) was left in.
   *  toolMode already remembers a TOOL's shape and honours it on reopen; these
   *  windows are not tools and had no memory at all — shrink Settings out of
   *  fullscreen, close it, and it reopened fullscreen every time. */
  windowShape?: Record<string, { full: boolean; x: number; y: number; w: number; h: number }>;
  /** v5.47: one-time strip of a pre-v5.46 toolMode.design='docked' (see
   *  migrateDesignToolMode) — set after it has run once. */
  designModeReset?: boolean;
  writingGoal?: WritingGoal | null;
  goalsCompleted?: number;
  characterProfilesOpen?: boolean;
  tagsPanelOpen?: boolean;
  locationDatabaseOpen?: boolean;
  notesVisible?: boolean;
  markersVisible?: boolean;
  tagsVisible?: boolean;
  zoomLevel?: number;
  toolbarMode?: 'compact' | 'comfortable' | 'custom' | 'hidden';
  menuMode?: 'compact' | 'comfortable' | 'custom' | 'hidden';
  characterSortBy?: 'name' | 'importance' | 'scenes' | 'dialogues' | 'appearance';
  grammarRulesEnabled?: Record<string, boolean>;
  spellingSettings?: SpellingSettings;
}

export function loadViewState(): ViewState {
  try {
    const raw = localStorage.getItem(VIEW_STATE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

export function saveViewState(patch: Partial<ViewState>) {
  try {
    const current = loadViewState();
    localStorage.setItem(VIEW_STATE_KEY, JSON.stringify({ ...current, ...patch }));
  } catch { /* localStorage unavailable */ }
}

/** v7.70: the shipped defaults go in FIRST, for keys nobody has set. Runs
 *  before the line below, which is the whole point — see seedDefaults.ts. */
export const _seeded = seedDefaultSettings();

/** Loaded once at module init; slices read it for their initial defaults. */
export const _vs = loadViewState();

/** Clamp a number to the inclusive range [lo, hi]. Shared by store slices. */
// v7.88 (security review D14): NaN-safe. Math.max(lo, NaN) is NaN, so an
// unguarded clamp let a NaN (e.g. a bad zoom or a non-numeric imported value)
// pass straight through into layout math and blank the page. NaN falls back to
// the low bound — a safe in-range default; ±Infinity still clamps normally to
// the bounds (Math.min/max handle those correctly).
export const clamp = (v: number, lo: number, hi: number): number =>
  Number.isNaN(v) ? lo : Math.min(hi, Math.max(lo, v));
