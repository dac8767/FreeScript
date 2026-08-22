/**
 * ToolDock — Photoshop-style tool columns flanking the editor. Each dock is a
 * vertical list of tools (icon + title); clicking one opens a floating window
 * beside the dock (one per dock at a time). Which tools live on which side —
 * and whether they're shown at all — comes from toolConfig, editable via
 * View → Customize Toolbar & Panels.
 *
 * Window sizes: dragging the bottom-right handle saves that size as the
 * tool's default (persisted in view state).
 *
 * Clicking back into the script minimizes any open tool window (the dock
 * stays). Tools disabled in both panels open as a temporary centered window
 * via the Tools menu (TempToolWindow, mounted once in ScreenplayEditor).
 */
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Editor } from '@tiptap/react';
import { CHROME_SCALES, chromePx, ICON_RAIL_W } from './chromeSizes';
import AssetManager from './AssetManager';
import VersionHistory from './VersionHistory';
import SpellCheckPanel from './SpellCheckPanel';
import {
  FaRegCompass, FaFilm, FaRegClone, FaMapMarkerAlt, FaUserFriends,
  FaChartBar, FaBullseye, FaRegStickyNote, FaRegClipboard,
  FaStream, FaTags, FaBoxes, FaSpellCheck, FaHistory,
  FaKeyboard, FaBook, FaBookOpen, FaSlidersH, FaColumns,
  FaCommentDots, FaChevronRight, FaChevronDown, FaMarker,
  FaRegEdit, FaRobot,
} from 'react-icons/fa';
import { useEditorStore, toolConfigFor, NO_FULLSCREEN_TOOLS, FULLSCREEN_ONLY_TOOLS, type ToolId, type ToolSide } from '../stores/editorStore';
import { useNotebookStore } from '../stores/notebookStore';
import { useSettingsStore } from '../stores/settingsStore';
import { FullscreenIcon, CloseIcon, RestoreIcon } from './uiIcons';
import { EdgeResizeZones, startEdgeResize, type EdgeZone } from './EdgeResize';
import { showToast } from './Toast';
import { useProjectStore } from '../stores/projectStore';
import SceneNavigator, { SceneTitleExtra, SceneControls, PagesTitleExtra, PagesControls, usePagesTabs, LocationsTitleExtra, LocationsControls, StructureTitleExtra, visibleLocations, groupByLocation, type NavTab } from './SceneNavigator';
import LocationMapRail from './LocationMapRail';
import NavigatorTool, { NavigatorControls } from './NavigatorTool';
import AnalyticsTool, { useAnalyticsTabs } from './AnalyticsTool';
import GoalsTool, { useGoalTabs } from './GoalsTool';
import CharacterProfiles, { CharTitleExtra, useCharTabs, CharControls } from './CharacterProfiles';
import { ChromeTabs, ControlDropdown, type ToolChromeTab } from './ToolControls';
import { StickyNotesTool, FragmentsTool, StickyTitleExtra, StickyControls, SnippetsTitleExtra } from './StickyNotes';
import { DesignPanelDocked } from './DesignPanel';
import WorkspacesTool from './WorkspacesTool';
import FeedbackTool from './FeedbackTool';
import TagsPanel, { TagsTitleExtra, TagsWindowActions, useTagsTabs } from './TagsPanel';
import MarkupsPanel, { MarkupsTitleExtra, MarkupsControls } from './MarkupsPanel';
import ThesaurusTool from './ThesaurusTool';
import { ScenesTool } from './ScenesTool';
import BeatBoard, { OutlineHeaderControls, useOutlineTabs, OutlineTabsExtra, OutlineBeatCount } from './BeatBoard';
import TypewriterTool, { FocusHeaderControls } from './TypewriterTool';
import AiWriterTool from './AiWriterTool';
import NotebookTool, { NotebookHeaderExtra } from './NotebookTool';
import HelperTextTool, { HelperTextTitleExtra } from './HelperTextWindow';


export interface ToolDef {
  id: ToolId;
  label: string;
  icon: React.ReactNode;
  defaultSize: { w: number; h: number };
  /** v0.74: never shrink this window to fit the panel. Most tools clamp their
   *  default width to the dock so they dock inline (v0.66); Customize keeps
   *  its full size and opens as a floating window instead. */
  noPanelFit?: boolean;
  /** v0.89: the window hugs its content and offers no resize handle. */
  fixedSize?: boolean;
  /** v1.33: this window can NEVER dock into a side panel — it always floats
   *  and shows no pop-in button. For tools whose layout simply doesn't fit a
   *  panel column (Title Page). Beats a stale small toolSize too. */
  neverDock?: boolean;
  /** v1.77: clicking into the script does NOT minimize this window. For
   *  tools you adjust WHILE looking at the editor (Typewriter). */
  keepOpenOnEditorClick?: boolean;
  /** dock group separators, Photoshop-style (per side, in order) */
  group: number;
  /** v7.05, Derek: developer surface. Never offered in the dock, the ribbon or
   *  any Customize picker; it opens from Help ▸ Developer only. Same treatment
   *  Helper Text already had, made explicit so it can't drift back. */
  devOnly?: boolean;
}

// Default heights sit at ~60% of the original panel lengths (v0.25) — drag
// the resize handle to make any window taller; the new size sticks.
export const ALL_TOOLS: ToolDef[] = [
  { id: 'navigator', label: 'Navigator', icon: <FaRegCompass />, defaultSize: { w: 300, h: 312 }, group: 0 },
  { id: 'scenes', label: 'Scenes', icon: <FaFilm />, defaultSize: { w: 320, h: 336 }, group: 1 },
  { id: 'pages', label: 'Pages', icon: <FaRegClone />, defaultSize: { w: 340, h: 348 }, group: 1 },
  { id: 'locations', label: 'Locations', icon: <FaMapMarkerAlt />, defaultSize: { w: 320, h: 324 }, group: 1 },
  { id: 'characters', label: 'Characters', icon: <FaUserFriends />, defaultSize: { w: 420, h: 360 }, group: 1 },
  // v4.24 batch 7: 'indexcards' retired — Index Cards is the Scenes tool's
  // Cards view now (persisted layouts carrying the old id are migrated).
  { id: 'beatboard', label: 'Outline', icon: <FaStream />, defaultSize: { w: 960, h: 372 }, group: 1 },
  // v5.21, Derek: Notes + To-Do merged into "Sticky Notes" (the 'todo' id is
  // retired and migrates onto 'sticky', which predates the merge and keeps
  // every persisted layout).
  // v5.36, Derek: renamed "Notes" with the v2 rebuild (id 'sticky' is a
  // persisted identifier — the label changes, the id never does).
  { id: 'sticky', label: 'Notes', icon: <FaRegStickyNote />, defaultSize: { w: 300, h: 336 }, group: 2 },
  // v5.25: anchored rich-text annotations on the script (set to replace
  // script highlighting, markers, sections, script notes and script to-dos
  // once Derek signs off on the core). v5.26, Derek: renamed "Annotations"
  // (label only — the 'markups' id is persisted, the Focus/Scrapbook rule).
  // v5.27, Derek: the tool wears a marker pen, not a flag.
  { id: 'markups', label: 'Annotations', icon: <FaMarker />, defaultSize: { w: 320, h: 420 }, group: 2 },
  { id: 'fragments', label: 'Snippets', icon: <FaRegClipboard />, defaultSize: { w: 300, h: 312 }, group: 2 },
  // v6.10: 'highlights' RETIRED — highlighting is the Annotations tool's job
  // (the `highlight` mark stays registered so old scripts render).
  { id: 'tags', label: 'Production Tags', icon: <FaTags />, defaultSize: { w: 340, h: 336 }, group: 2 },
  // v0.94: Analytics opens FLOATING at its natural size — squeezed into a 300px
  // panel there's nothing to read. noPanelFit only changes the DEFAULT: the
  // pop-in button still docks it, and that choice is remembered.
  { id: 'analytics', label: 'Analytics', icon: <FaChartBar />, defaultSize: { w: 620, h: 384 }, group: 3, noPanelFit: true },
  { id: 'goals', label: 'Goals', icon: <FaBullseye />, defaultSize: { w: 340, h: 400 }, group: 3 },   // v6.25: fits the v6.23 layout (top row + quick starts + footer)
  // v1.82: Vomit Draft is a MODE of Goals now — no separate tool. The 'vomit'
  // ToolId stays in the type so persisted configs typecheck (scriptnotes
  // precedent); absence from ALL_TOOLS removes it everywhere it showed.
  // v1.74: grew from one toggle to the full option suite — needs the height.
  // v1.77: stays open on editor clicks — its options are tuned while writing.
  // v4.22, Derek: renamed "Typewriter" → "Focus" (the id stays 'typewriter' —
  // it's the persisted tool key and ribbon token).
  { id: 'aiwriter', label: 'AI Writer', icon: <FaRobot />, defaultSize: { w: 300, h: 150 }, group: 3 },
  { id: 'typewriter', label: 'Focus', icon: <FaKeyboard />, defaultSize: { w: 340, h: 520 }, group: 3, keepOpenOnEditorClick: true },
  // v1.69: the joke. It ships enabled — that's the joke landing.
  // v5.53, Derek: the Thesaurus — MyThes en_US (WordNet-derived) bundled
  // locally under public/thesaurus/; follows the script caret, replaces
  // in place. No network involved (see utils/thesaurus.ts).
  { id: 'thesaurus', label: 'Thesaurus', icon: <FaBookOpen />, defaultSize: { w: 320, h: 420 }, group: 3 },
  // v1.96: the Notebook window is ONLY the pages tree — it sits inline in
  // the panel like Navigator, while the writing surface takes over the
  // editor area (NotebookSurface in ScreenplayEditor). keepOpenOnEditorClick
  // because the surface LIVES in the editor area: clicking into it must not
  // close the panel window (which would close the notebook itself).
  // v2.01: renamed Scrapbook (label only — the 'notebook' id and the
  // opendraft:notebook storage key persist user data and keep their names).
  { id: 'notebook', label: 'Scrapbook', icon: <FaBook />, defaultSize: { w: 300, h: 420 }, group: 3, keepOpenOnEditorClick: true },
  // v5.67, Derek: the standalone Title Page tool is retired — it's the Pages
  // window's Title Page TAB now. The 'titlepage' id migrates onto 'pages'
  // the way 'indexcards'/'todo' did (RETIRED_TOOL_IDS; openTool also lands
  // on the tab). The Production menu entry and the toolbar's modal door
  // still open the same TitlePageEditor.
  // v0.96: Customize is NOT a tool. It's the permanent button in the chrome, so
  // it can't be docked, hidden, or added to a panel/toolbar — removing it from
  // ALL_TOOLS is what takes it out of both Customize tabs, since those lists are
  // built from this one.
  { id: 'assets', label: 'Asset Manager', icon: <FaBoxes />, defaultSize: { w: 620, h: 372 }, group: 3 },
  // v1.67: tall enough for the full checker — tabs + toggles + the word,
  // Change To, suggestions AND the action buttons. 440 predates the tabs row.
  { id: 'spelling', label: 'Spelling & Grammar', icon: <FaSpellCheck />, defaultSize: { w: 420, h: 640 }, group: 3 },
  // v0.84: Script History is dockable again — VersionHistory already had an
  // `embedded` mode, it just wasn't registered as a tool.
  // v6.76: keepOpenOnEditorClick, the Scrapbook's reason exactly — its
  // compare surface LIVES in the editor area, so clicking the diff's own
  // buttons (or its ×) must not dismiss the panel that owns the compare.
  { id: 'history', label: 'Script History', icon: <FaHistory />, defaultSize: { w: 420, h: 480 }, group: 3, keepOpenOnEditorClick: true },
  // v4.23, Derek: the Design (tokens) surface is dockable now — the same body
  // the floating window shows (DesignPanelBody), just in a panel column. Opens
  // FLOATING by default (its sliders want width), but the pop-in button docks it.
  { id: 'design', label: 'Design', icon: <FaSlidersH />, defaultSize: { w: 360, h: 560 }, group: 3, noPanelFit: true, devOnly: true },
  // v4.23, Derek: Workspaces (saved layouts) as a dockable tool — same store
  // API as the View → Workspaces menu; apply/save/rename/delete in a panel.
  { id: 'workspaces', label: 'Workspaces', icon: <FaColumns />, defaultSize: { w: 300, h: 360 }, group: 3 },
  // v4.23, Derek: the Feedback form, dockable — same embed the Help menu opens,
  // kept beside the script instead of in a blocking modal. Opens floating (the
  // form needs width) but the pop-in button docks it.
  { id: 'feedback', label: 'Feedback', icon: <FaCommentDots />, defaultSize: { w: 460, h: 620 }, group: 3, noPanelFit: true },
  // v6.52, Derek ("allow dragging the help text window into a side panel"):
  // Helper Text is a real tool now — docking, drag-out, fullscreen and size
  // memory come from the shared machinery. Opens from Help ▸ Developer; no
  // dock row until it's dragged into a panel (DEFAULT_TOOL_CONFIG).
  { id: 'helpertext', label: 'Helper Text', icon: <FaRegEdit />, defaultSize: { w: 420, h: 620 }, group: 3 },
  // (v5.21, Derek: the v4.95 dev-only Airtable panel is removed for good.)
];

export const toolDef = (id: ToolId | null) => ALL_TOOLS.find((t) => t.id === id) || null;

/** v4.39, Derek's single-row window template (replaces the v4.27 two-row one).
 *  Every tool window — floating, docked-open, and the fullscreen takeover —
 *  is ONE header row:
 *    left:  tool name · count (TitleExtra) · tabs
 *    right: Filter / Sort / View / Search cluster · divider · fullscreen · close
 *  When the window is too narrow the row WRAPS — excess items flow onto a
 *  second line (this replaced the tabs' collapse-to-dropdown). The pop-in /
 *  pop-out buttons are gone: drag a docked window's header out of the panel
 *  to float it; drag a floating window over a side panel to dock it there.
 *  New controls should still be composed from the ToolControls primitives
 *  (ControlDropdown / ControlSearch) so every window's cluster matches. */
export interface ToolChrome {
  /** Beside the tool name — e.g. the "· 12" count. */
  TitleExtra?: React.FC;
  /** Rides with the Controls cluster — e.g. Tags' eye toggle. */
  WindowActions?: React.FC;
  /** The tab DATA (a hook — it may read stores). Rendered as a strip beside
   *  the title; a strip that doesn't fit wraps with the row. */
  useTabs?: () => ToolChromeTab[];
  /** v5.22: with this set the tabs are user-draggable; called with strip
   *  indices on drop (Sticky Notes persists its order through it). */
  onTabReorder?: (from: number, to: number) => void;
  /** v6.48: rendered inside the tab strip's host, hugging the last tab —
   *  the Outline's + (new variation) button. Stays visible when the strip
   *  collapses into a dropdown. */
  TabsExtra?: React.FC;
  /** v6.56: rendered AFTER the strip, outside its bordered pill — for chrome
   *  that belongs beside the tabs but is not one of them (the Outline's beat
   *  count, which looked boxed while it sat inside). */
  AfterTabs?: React.FC;
  /** The Filter / Sort / View / Search cluster, in that order. */
  Controls?: React.FC;
}

/** Hook-calling wrapper so useTabs runs in a component of its own — the
 *  header renders it conditionally, which a bare hook call couldn't be.
 *
 *  v4.53, Derek's two-stage overflow: when the header row is too crowded the
 *  tabs COLLAPSE into a dropdown first; only if even that can't fit on one
 *  line does the row wrap (the flex-wrap from v4.39). The decision compares
 *  the row's width against the NATURAL single-line widths — a hidden copy of
 *  the full strip, plus each sibling's unwrapped content width — so the
 *  row's own wrapping never feeds back into the decision. */
export function naturalWidth(el: HTMLElement): number {
  // flex-wrap containers report their wrapped box — sum their children the
  // same way to get the single-line width they WANT.
  //
  // v4.91, Derek ("it doesn't expand if I expand the window"): count the RIGHT
  // margin, never the left. `.tool-chrome-right` carries `margin-left: auto`
  // as the row's spacer, and getComputedStyle resolves an auto margin to its
  // USED value — every pixel of leftover space in the row. Adding that made
  // `need` grow in lockstep with the row's width, so the fit test could never
  // succeed: once the tabs collapsed they stayed collapsed at ANY size. (The
  // v4.67 pass blamed a stale ResizeObserver and re-bound it — the observer
  // was firing all along; the arithmetic was self-defeating.) Real spacing in
  // this row is right-margin anyway (the title's --dz-toolwin-title-gap).
  const cs = getComputedStyle(el);
  /* v6.16, Derek ("expanding never brings the tabs back"): the DOCKED
     strip's controls span is a flex-GROW spacer (v4.90) — its stretched
     offsetWidth absorbs every free pixel, so counting it made `need` track
     the row's width and the fit test could never succeed once the tabs
     collapsed. Same self-defeating arithmetic v4.91 killed for the auto
     margin, through the width this time: a grow container's natural width
     is the SUM OF ITS CHILDREN, and an empty grow spacer wants nothing. */
  const grows = (parseFloat(cs.flexGrow) || 0) > 0;
  if ((cs.flexWrap === 'wrap' || grows) && el.children.length > 0) {
    const gap = parseFloat(cs.columnGap) || 0;
    /* v6.48: out-of-flow children take NO flex space — the pinned corner
       actions (already reserved via the row's padding-right) and the
       Outline's absolute-centered Arrangement block were being summed in,
       inflating `need` by ~230px and collapsing the tabs in rows that fit. */
    let w = 0, inFlow = 0;
    for (const c of el.children) {
      const pos = getComputedStyle(c as HTMLElement).position;
      if (pos === 'absolute' || pos === 'fixed') continue;
      w += naturalWidth(c as HTMLElement);
      inFlow++;
    }
    return w + gap * Math.max(0, inFlow - 1)
      + (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0)
      + (parseFloat(cs.marginRight) || 0);
  }
  if (grows) {
    return (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0)
      + (parseFloat(cs.marginRight) || 0);
  }
  return el.offsetWidth + (parseFloat(cs.marginRight) || 0);
}

function HeaderTabs({ chrome }: { chrome: ToolChrome }) {
  const tabs = chrome.useTabs!();
  const hostRef = useRef<HTMLSpanElement>(null);
  const measureRef = useRef<HTMLSpanElement>(null);
  const [collapsed, setCollapsed] = useState(false);
  useLayoutEffect(() => {
    const host = hostRef.current;
    const row = host?.parentElement;
    if (!host || !row) return;
    const decide = () => {
      if (!row.clientWidth) return;            // unmeasurable (jsdom / hidden)
      const stripW = measureRef.current?.offsetWidth ?? 0;
      const cs = getComputedStyle(row);
      const gap = parseFloat(cs.columnGap) || 0;
      let need = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0) + stripW;
      let n = 1;
      for (const el of row.children) {
        if (el === host || el === measureRef.current) continue;
        need += naturalWidth(el as HTMLElement);
        n++;
      }
      need += gap * Math.max(0, n - 1);
      setCollapsed(need + 4 > row.clientWidth);
    };
    decide();
    if (typeof ResizeObserver === 'undefined') return;   // jsdom
    const ro = new ResizeObserver(decide);
    ro.observe(row);
    if (measureRef.current) ro.observe(measureRef.current);
    // v4.67, Derek ("expanding doesn't bring the tabs back"): a header
    // re-render can REPLACE the row element while this component survives —
    // the observer then watches a detached node and never fires again.
    // Re-binding on every collapse flip re-captures the live parent, and the
    // window listener catches whole-app resizes the orphaned observer missed.
    window.addEventListener('resize', decide);
    return () => { ro.disconnect(); window.removeEventListener('resize', decide); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabs.length, collapsed]);
  const active = tabs.find((t) => t.active) ?? tabs[0];
  return (
    <>
      <span ref={hostRef} className={`tool-chrome-tabs${collapsed ? ' tool-chrome-tabs-dd' : ''}`}>
        {collapsed ? (
          /* v5.71, Derek: the caret marks the collapsed strip as a MENU —
             without it the current tab's name read as a dead label. */
          <ControlDropdown
            title="Section"
            current={active?.label}
            caret
            items={tabs.map((t) => ({ label: t.label, active: t.active, onSelect: t.onSelect }))}
          />
        ) : (
          <ChromeTabs tabs={tabs} onReorder={chrome.onTabReorder} />
        )}
        {chrome.TabsExtra && <chrome.TabsExtra />}
      </span>
      {/* natural-width measurer — never visible, never interactive */}
      <span ref={measureRef} className="tool-chrome-tabs tool-chrome-tabs-measure" aria-hidden>
        <ChromeTabs tabs={tabs} />
        {chrome.TabsExtra && <chrome.TabsExtra />}
      </span>
      {chrome.AfterTabs && <chrome.AfterTabs />}
    </>
  );
}

/** The right end of the single-row header, in Derek's fixed order:
 *  controls cluster (+ window actions) · fullscreen · close.
 *  v4.69, Derek: the divider is GONE — fullscreen and close are distinct
 *  bordered buttons (classic title-bar style), which is separation enough. */
function HeaderRightCluster({ id, chrome, onClose, closeTitle, fullscreenBtn = true, onMinimize }: {
  id: ToolId; chrome?: ToolChrome; onClose: () => void; closeTitle?: string;
  /** false on the fullscreen takeover — it IS fullscreen. */
  fullscreenBtn?: boolean;
  /** v4.78, Derek: the fullscreen takeover's shrink — LEFT of close, converts
   *  back to a floating "popped out" window. */
  onMinimize?: () => void;
}) {
  const hasCluster = !!(chrome?.Controls || chrome?.WindowActions);
  return (
    <span className="tool-chrome-right">
      {hasCluster && (
        <span className="tool-chrome-controls">
          {chrome?.Controls && <chrome.Controls />}
          {chrome?.WindowActions && <chrome.WindowActions />}
        </span>
      )}
      {/* v4.86 follow-up, Derek: the window ACTIONS are their own span, pinned
          to the header's top-right corner by CSS. Free-standing because a
          right-aligned item mid-sequence has to eat the line's free space,
          which would force the tabs and controls onto a second row even in a
          wide window. Pinned, they stay in the corner while everything else
          wraps beneath them — which is exactly the rule Derek asked for:
          name, count and these buttons on the top row, the rest below. */}
      <span className="tool-chrome-actions">
        {fullscreenBtn && <ToolFullscreenButton id={id} />}
        {onMinimize && (
          <button
            className="tool-window-minimize"
            onClick={(e) => { e.stopPropagation(); onMinimize(); }}
            title="Shrink to floating window"
          ><RestoreIcon /></button>
        )}
        <button
          className="tool-window-close"
          onClick={(e) => { e.stopPropagation(); onClose(); }}
          title={closeTitle ?? 'Close'}
        ><CloseIcon /></button>
      </span>
    </span>
  );
}
export const TOOL_CHROME: Partial<Record<ToolId, ToolChrome>> = {
  // v4.27 phase 2: Characters — count beside the title,
  // Profiles/Relationships/From Script tabs, Sort/View/Search.
  // v4.35 batch-v9 #4: per-tool fullscreen WindowActions are gone — the frame
  // renders ONE generic fullscreen button for every non-excluded tool.
  characters: { TitleExtra: CharTitleExtra, useTabs: useCharTabs, Controls: CharControls },
  // v4.27 phase 3: Scenes — count beside the title; Filter/Reorder/View/Search.
  scenes: { TitleExtra: SceneTitleExtra, Controls: SceneControls },
  // v4.27 phase 4: the remaining tools' control bars, in the same row-2 slot
  // (their internal layouts are unchanged — the cluster lets them span).
  // v4.32: numbers toggle (left) + Filter dropdown + search (batch-v8 5-7)
  navigator: { Controls: NavigatorControls },
  // v5.21: the merged Sticky Notes. v5.22: All · Notes · Checklists header
  // TABS (user-draggable, persisted order) + Sort / Search in the cluster.
  sticky: { TitleExtra: StickyTitleExtra, Controls: StickyControls },
  // v4.32 batch-v8 #12: Snippets + Highlights — count beside the title.
  fragments: { TitleExtra: SnippetsTitleExtra },
  // v4.32 batch-v8 #11/#12: counts beside the title; their in-body title
  // rows are gone (Structure counts acts).
  // v4.94, Derek: Pages gains a header search and the two preview-scaling
  // buttons. v5.67: Script / Title Page / Custom header tabs (usePagesTabs);
  // the controls hide themselves off the Script tab.
  pages: { TitleExtra: PagesTitleExtra, useTabs: usePagesTabs, Controls: PagesControls },
  // v4.92, Derek: Locations gains Filter · Sort · Search — its header strip
  // held nothing but the window buttons and read as crushed.
  // v5.75/v5.77, Derek: List / Map is the cluster's VIEW dropdown (not a tab
  // strip), and the Map view adds its own options button — both inside
  // LocationsControls.
  locations: { TitleExtra: LocationsTitleExtra, Controls: LocationsControls },
  structure: { TitleExtra: StructureTitleExtra },
  // v4.32 batch-v8 #12: Production Tags — count, eye toggle as the window
  // action, View/Manage tabs (Manage carries the pending-selection dot).
  tags: { TitleExtra: TagsTitleExtra, WindowActions: TagsWindowActions, useTabs: useTagsTabs },
  // v5.25: Annotations — count + the Filter / Show in Script / Search
  // cluster. (v5.27: the header eye is retired — View menu + ribbon toggle
  // + the per-type "Show in Script" grid cover visibility.)
  markups: { TitleExtra: MarkupsTitleExtra, Controls: MarkupsControls },
  // v6.02, Derek: the Words/Pages/Time tabs go through useTabs like every
  // other window's. (v6.15: the ? helper is gone — the window explains
  // itself; the header carries tabs only.)
  goals: { useTabs: useGoalTabs },
  // v6.19, Derek: the Analytics tab options ride the window header too.
  analytics: { useTabs: useAnalyticsTabs },
  notebook: { Controls: NotebookHeaderExtra },   // v2.05: declutter + create buttons
  typewriter: { Controls: FocusHeaderControls }, // v5.66: the "?" in the header
  // v2.41: count/Arrangement/help. v6.48, Derek: the variation tabs moved up
  // into the header (rename/close/+ ride the shared strip's optional slots),
  // and Presets + Add moved into the controls cluster with them.
  beatboard: { useTabs: useOutlineTabs, TabsExtra: OutlineTabsExtra, AfterTabs: OutlineBeatCount, Controls: OutlineHeaderControls },
  // (v6.84: Feedback's v4.70 screenshot header buttons retired — the native
  // form owns its own attach button.)
  // v6.52: the "N changed" chip beside the Helper Text title.
  helpertext: { TitleExtra: HelperTextTitleExtra },
};

/** Windows summarize script info; everything else is a Tool (v0.24 taxonomy). */
/**
 * v7.05 — THE tool list every surface should read.
 *
 * `ALL_TOOLS` is the full registry, including tools that belong to an add-on
 * the user has not installed and developer-only surfaces. Anything that OFFERS
 * a tool to the user — dock rows, the ribbon palette, the Customize pickers,
 * the Tools menu — must read this instead, so a gated tool disappears from all
 * of them at once rather than each caller remembering to filter.
 *
 * Opening a tool by id still works regardless (Help ▸ Developer opens Design,
 * and a persisted layout naming a gated tool is handled where it is restored) —
 * this governs what is OFFERED, not what can exist.
 */
export function availableTools(): ToolDef[] {
  return ALL_TOOLS.filter((t) => !t.devOnly);
}

export const WINDOW_IDS: ToolId[] = ['navigator', 'pages', 'scenes', 'locations', 'characters', 'assets', 'spelling', 'history'];
export const isWindowTool = (id: ToolId) => WINDOW_IDS.includes(id);

/** v4.35 batch-v9 #4, Derek: EVERY side-panel window gets a fullscreen button
 *  — one generic control the frame renders, not per-tool WindowActions.
 *  The exclusion list lives in editorStore (v4.81) so openTool's
 *  remembered-shape branch and this button can't disagree. */
const NO_FULLSCREEN = NO_FULLSCREEN_TOOLS;

/** v5.30, Derek: a tool whose pop-out / fullscreen options are limited says
 *  so — v5.41: at the ATTEMPT (a toast when the drag-out lands in the
 *  editor), not parked at the panel's foot. Keyed by tool id; having a note
 *  here IS the "this move is disallowed" flag. */
const SHAPE_NOTES: Partial<Record<ToolId, string>> = {
  notebook: 'Scrapbook only appears in full-screen mode',
  markups: 'This window only appears in the side panel',
  navigator: 'This window only appears in the side panel',
};

function ToolFullscreenButton({ id }: { id: ToolId }) {
  // v5.21: fullscreen-ONLY tools drop the button too — they are never in a
  // shape the button could act on (fullscreen is their only shape).
  if (NO_FULLSCREEN.includes(id) || FULLSCREEN_ONLY_TOOLS.includes(id)) return null;
  return (
    <button
      className="char-profiles-fullscreen-btn"
      title="Fullscreen"
      onClick={() => useEditorStore.getState().enterToolFullscreen(id)}
    >
      <FullscreenIcon />
    </button>
  );
}

/** The editor-area takeover for whichever tool owns fullscreenTool: the SAME
 *  single-row header as the window frame (name · count · tabs left; controls ·
 *  divider · × right — no fullscreen button, it IS fullscreen) and the SAME
 *  ToolContent body. ScreenplayEditor swaps it in for the editor; toolbar/
 *  status bar stay, "Return to Editor" rides the ribbon. */
export function ToolFullscreenTakeover({ editor, scrollContainer }: {
  editor: Editor | null;
  scrollContainer?: HTMLDivElement | null;
}) {
  const id = useEditorStore((s) => s.fullscreenTool);
  const nameUpper = useEditorStore((s) => s.panelNameCase === 'upper');
  const def = ALL_TOOLS.find((t) => t.id === id);
  if (!id || !def) return null;
  const chrome = TOOL_CHROME[id];
  const close = () => useEditorStore.getState().setFullscreenTool(null);
  return (
    <div className={`fs-tool-takeover fs-tool-takeover-${id}`}>
      <div className="tool-window-header tool-fs-header">
        <span className="tool-header-title">
          <span className={`tool-window-title${nameUpper ? ' tool-name-upper' : ''}`}>{def.label}</span>
          {chrome?.TitleExtra && <chrome.TitleExtra />}
        </span>
        {chrome?.useTabs && <HeaderTabs chrome={chrome} />}
        <HeaderRightCluster
          id={id}
          chrome={chrome}
          onClose={close}
          closeTitle="Return to editor"
          fullscreenBtn={false}
          /* v4.78, Derek: shrink (left of ×) — leave fullscreen INTO a
             floating window; openTool re-activates it wherever it lives.
             v5.21: fullscreen-ONLY tools (Title Page) have no other shape
             to shrink into, so they don't offer the button. */
          onMinimize={FULLSCREEN_ONLY_TOOLS.includes(id) ? undefined : () => {
            const st = useEditorStore.getState();
            st.setFullscreenTool(null);
            st.setToolMode(id, 'floating');
            st.openTool(id);
          }}
        />
      </div>
      <div className="fs-tool-takeover-body">
        <ToolContent id={id} editor={editor} scrollContainer={scrollContainer} inTakeover />
      </div>
    </div>
  );
}

/** v3.73, Derek: tools that are NOT offered as side-panel tools and never
 *  render in a dock — they open from the Tools menu / as their own windows.
 *  ONE list, read by the dock AND Customize > Side Panels — and, since
 *  v6.27, by openTool: it LIVES in editorStore now (re-exported here for
 *  the existing importers). */
import { PANEL_EXCLUDED_IDS } from '../stores/editorStore';
export { PANEL_EXCLUDED_IDS };

const MIN_W = 240;
const MIN_H = 260;
/** Dock column width; tools whose remembered width fits open inline. */
export const DOCK_W = CHROME_SCALES.panelLeft.comfortable;   // 300 (default)
export const DOCK_W_COMPACT = CHROME_SCALES.panelLeft.compact; // 232

/** Limits for the drag-to-resize edge (v1.1). */
export const PANEL_MIN_W = 180;
export const PANEL_MAX_W = 640;
/** Dock column width for a panel's size mode — including 'custom', where the
 *  user's slider value (half-compact … double-comfortable) applies. Inline
 *  tool windows are sized and GATED against this, so a window docked in a
 *  narrowed panel still fits inside it. */
export const dockWidthFor = (
  side: 'left' | 'right',
  mode: 'compact' | 'comfortable' | 'custom' | 'icons',
  customPx?: number,
) => chromePx(side === 'left' ? 'panelLeft' : 'panelRight', mode, customPx);

/** Shared tool-content renderer (docked and temporary windows).
 *  (v5.67: the onClose prop is gone — its one reader was the hosted Title
 *  Page modal, retired into the Pages window's tab.) */
export function ToolContent({ id, editor, scrollContainer, inTakeover = false }: {
  id: ToolId; editor: Editor | null; scrollContainer?: HTMLDivElement | null;
  /** True inside the fullscreen takeover — a body may render differently there. */
  inTakeover?: boolean;
}) {
  const { currentProject } = useProjectStore();
  switch (id) {
    case 'navigator':
      return <NavigatorTool editor={editor} scrollContainer={scrollContainer} />;
    case 'scenes':
      // v4.24 batch 7: Scenes carries a List/Cards view toggle (Cards is the
      // old Index Cards tool).
      return <ScenesTool editor={editor} scrollContainer={scrollContainer ?? null} />;
    case 'pages':
    case 'structure':
    case 'locations':
      return <SceneNavigator editor={editor} scrollContainer={scrollContainer} view={id as NavTab} inTakeover={inTakeover} />;
    case 'characters':
      return <CharacterProfiles editor={editor} projectId={currentProject?.id || ''} embedded />;
    case 'assets':
      return <AssetManager projectId={currentProject?.id || ''} embedded />;
    case 'spelling':
      return <SpellCheckPanel editor={editor} />;
    case 'history':
      return <VersionHistory />;
    case 'analytics':
      return <AnalyticsTool editor={editor} />;
    case 'goals':
      return <GoalsTool editor={editor} />;
    case 'typewriter':
      return <TypewriterTool editor={editor} />;
    case 'aiwriter':
      return <AiWriterTool />;
    case 'notebook':
      return <NotebookTool />;
    case 'sticky':
      return <StickyNotesTool editor={editor} />;
    case 'markups':
      return <MarkupsPanel editor={editor} />;
    case 'thesaurus':
      return <ThesaurusTool editor={editor} />;
    case 'fragments':
      return <FragmentsTool editor={editor} />;
    case 'tags':
      return <TagsPanel editor={editor} embedded />;
    case 'beatboard':
      return <BeatBoard embedded />;
    case 'design':
      return <DesignPanelDocked />;
    case 'workspaces':
      return <WorkspacesTool />;
    case 'feedback':
      return <FeedbackTool />;
    case 'helpertext':
      return <HelperTextTool />;
    default:
      return null;
  }
}

/** Resizable window chrome shared by docked and temporary tool windows. */
export function ToolWindowFrame({ tool, onClose, temporary, side, children }: {
  tool: ToolDef; onClose: () => void; temporary?: boolean; side?: ToolSide; children: React.ReactNode;
}) {
  const nameUpper = useEditorStore((s) => s.panelNameCase === 'upper');
  const { toolSizes, setToolSize, panelSizeMode, chromeCustomPx } = useEditorStore();
  const windowRef = useRef<HTMLDivElement>(null);

  // v4.64, Derek: a window born from a drag-out gesture SNAPS to the classic
  // popped position — touching the side panel edge (the frame's CSS-anchored
  // default), exactly where the old pop-out button placed it. (v4.41 seated
  // it at the drop point; that mechanism — windowSpawnAt — is gone.)
  // Docked windows default to inline (see ToolDock below), so this frame only
  // renders windows the user has explicitly sized/popped out, plus temporary
  // Tools-menu windows — both of which should keep their own size.
  const size = toolSizes[tool.id] || tool.defaultSize;
  // Pop-back-in must target the width of the panel it's returning to, or a
  // compact panel would reject the window as too wide and it would keep floating.
  const popInW = side ? dockWidthFor(side, panelSizeMode[side], chromeCustomPx[side === 'left' ? 'panelLeft' : 'panelRight']) : DOCK_W;

  // v5.46, Derek: ANY edge or corner resizes (the bottom-corner hash grip is
  // gone). On start the frame converts to an explicit left/top anchor — the
  // same conversion the header drag does — so west/north drags can move
  // those edges while the shared math pins the opposite ones.
  const beginEdgeResize = (zone: EdgeZone, e: React.PointerEvent) => {
    const el = windowRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const parent = el.offsetParent?.getBoundingClientRect() ?? ({ left: 0, top: 0 } as DOMRect);
    const baseLeft = rect.left - parent.left;
    const baseTop = rect.top - parent.top;
    el.style.left = `${baseLeft}px`;
    el.style.right = 'auto';
    el.style.top = `${baseTop}px`;
    // v6.07: same as the header drag — a temp window's centering transform
    // must not survive the switch to explicit left/top.
    el.style.transform = 'none';
    let w = el.offsetWidth;
    let h = el.offsetHeight;
    startEdgeResize(e, zone, {
      rect: () => ({ left: baseLeft, top: baseTop, w: el.offsetWidth, h: el.offsetHeight }),
      min: { w: MIN_W, h: MIN_H },
      apply: (g) => {
        w = g.w;
        h = g.h;
        el.style.width = `${w}px`;
        el.style.height = `${h}px`;
        // v0.85: stop growing once the content no longer fills the window.
        // The gap between the body's clientHeight (space given) and
        // scrollHeight (space wanted) IS the dead space — give it back. A
        // stretching panel (Scenes, Notes…) has slack 0 and resizes freely;
        // a fixed-layout window (Title Page) stops at its content.
        const body = el.querySelector('.tool-window-body') as HTMLElement | null;
        if (body) {
          const slackH = body.clientHeight - body.scrollHeight;
          const slackW = body.clientWidth - body.scrollWidth;
          if (slackH > 1) { h = Math.max(MIN_H, h - slackH); el.style.height = `${h}px`; }
          if (slackW > 1) { w = Math.max(MIN_W, w - slackW); el.style.width = `${w}px`; }
        }
        // The dragged west/north edge tracks the FINAL size (post-slack);
        // east/south drags leave left/top at the anchor.
        el.style.left = `${zone.includes('w') ? g.left + (g.w - w) : g.left}px`;
        el.style.top = `${zone.includes('n') ? g.top + (g.h - h) : g.top}px`;
      },
      // the resized size becomes this tool's default from now on
      commit: () => setToolSize(tool.id, w, h),
    });
  };

  /** v4.39: drop the floating window on a side panel and it docks there —
   *  the pop-in button is gone, the gesture replaced it. Docking = the same
   *  width-write pop-in did (inline is DERIVED from w <= dock width), plus a
   *  config/slot move when the window came from the menu or the other side.
   *  Everything routes through openTool so the placement logic stays single. */
  const dockInto = (dropSide: ToolSide) => {
    const st = useEditorStore.getState();
    const surface = dropSide === 'left' ? 'panelLeft' : 'panelRight';
    const w = dockWidthFor(dropSide, st.panelSizeMode[dropSide], st.chromeCustomPx[surface]);
    const cfg = toolConfigFor(st.toolConfig, tool.id);
    if (!cfg.enabled || cfg.side !== dropSide) {
      st.setToolConfig({ ...st.toolConfig, [tool.id]: { side: dropSide, enabled: true } });
    }
    // Clear every slot first so openTool's placement is the only one left.
    if (st.activeTool === tool.id) st.setActiveTool(null);
    if (st.activeToolRight === tool.id) st.setActiveToolRight(null);
    st.setToolMode(tool.id, 'docked');
    st.setToolSize(tool.id, w, size.h);
    st.openTool(tool.id);
  };

  /*
   * v1.33: grab the header, move the window. The window is absolutely
   * positioned (left/right + top in CSS); on the first drag we measure where
   * it actually is, switch to explicit left/top, and follow the pointer.
   * Buttons in the header are exempt so Close (and the controls) still click.
   * v4.39: while dragging, hovering a side panel highlights it as a drop
   * target; releasing there docks the window into that panel.
   */
  const startDrag = (e: React.PointerEvent) => {
    const el = windowRef.current;
    if (!el || (e.target as HTMLElement).closest('button, select, input')) return;
    e.preventDefault();
    // v4.41: WebKit can still anchor a text selection in content the pointer
    // crosses mid-drag — suppress selection app-wide for the gesture.
    document.body.classList.add('fs-tool-dragging');
    const startX = e.clientX;
    const startY = e.clientY;
    const rect = el.getBoundingClientRect();
    const parent = el.offsetParent?.getBoundingClientRect() ?? ({ left: 0, top: 0 } as DOMRect);
    const baseLeft = rect.left - parent.left;
    const baseTop = rect.top - parent.top;
    /* v6.07, Derek ("the hand shoots to the right, off the window"): the
       TEMP window is CSS-centered — left:50% + translateX(-50%). baseLeft is
       measured from the VISUAL rect, so the transform must go the moment we
       switch to explicit left/top; left alone kept the -50% shift and
       teleported the window half its width leftward at the first move,
       parking the grab point off its right edge for the whole drag. Setting
       all four here (not in onMove) means no first-move flash either. */
    el.style.left = `${baseLeft}px`;
    el.style.top = `${baseTop}px`;
    el.style.right = 'auto';
    el.style.transform = 'none';
    const zones = !tool.neverDock && !PANEL_EXCLUDED_IDS.includes(tool.id)
      ? (['left', 'right'] as const).flatMap((s) => {
          // an icon rail has no inline shape to receive the window
          if (useEditorStore.getState().panelSizeMode[s] === 'icons') return [];
          const dockEl = document.querySelector<HTMLElement>(`.tool-dock-wrap.tool-dock-${s} .tool-dock`);
          return dockEl ? [{ s: s as ToolSide, el: dockEl }] : [];
        })
      : [];
    let over: { s: ToolSide; el: HTMLElement } | null = null;
    const hit = (x: number, y: number) => {
      for (const z of zones) {
        const r = z.el.getBoundingClientRect();
        if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return z;
      }
      return null;
    };
    const onMove = (ev: PointerEvent) => {
      el.style.left = `${baseLeft + (ev.clientX - startX)}px`;
      el.style.right = 'auto'; // right-docked windows are right-anchored until dragged
      el.style.top = `${Math.max(0, baseTop + (ev.clientY - startY))}px`;
      const nowOver = hit(ev.clientX, ev.clientY);
      if (nowOver !== over) {
        over?.el.classList.remove('tool-dock-drop-target');
        nowOver?.el.classList.add('tool-dock-drop-target');
        over = nowOver;
      }
    };
    const onUp = (ev: PointerEvent) => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.body.classList.remove('fs-tool-dragging');
      over?.el.classList.remove('tool-dock-drop-target');
      const drop = hit(ev.clientX, ev.clientY);
      if (drop) dockInto(drop.s);
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  };

  return (
    <div
      ref={windowRef}
      className={`tool-window${temporary ? ' tool-window-temp' : ''}${tool.fixedSize ? ' tool-window-fixed' : ''}`}
      // v4.70: which tool this frame holds — read by CSS (the feedback
      // screenshot veil) and by drivers; presentation-free otherwise.
      data-tool={tool.id}
      // A fixed window takes its size from its content (CSS max-content), so no
      // width/height is imposed here and there's nothing to drag.
      // v2.15: anchored to the panel's REAL edge — the CSS 308px was the
      // comfortable width baked in, so compact/custom/icon-rail panels
      // opened windows floating in space (Derek's screenshot).
      style={{
        ...(tool.fixedSize ? {} : { width: size.w, height: size.h }),
        ...(!temporary && side
          ? (side === 'right' ? { right: popInW + 8, left: 'auto' } : { left: popInW + 8 })
          : {}),
      }}
    >
      {/* v4.39, Derek's single-row header: name · count · tabs left, then
        * controls · divider · fullscreen · close right; wraps when narrow.
        * Grab anywhere on it to move the window; drop on a panel to dock. */}
      {(() => {
        const chrome = TOOL_CHROME[tool.id];
        return (
          <div className="tool-window-header" onPointerDown={startDrag}>
            <span className="tool-header-title">
              <span className={`tool-window-title${nameUpper ? ' tool-name-upper' : ''}`}>{tool.label}</span>
              {chrome?.TitleExtra && <chrome.TitleExtra />}
            </span>
            {chrome?.useTabs && <HeaderTabs chrome={chrome} />}
            <HeaderRightCluster id={tool.id} chrome={chrome} onClose={onClose} />
          </div>
        );
      })()}
      <div className={`tool-window-body${side === 'right' ? ' tool-window-body-right' : ''}`}>{children}</div>
      {/* v5.46: any edge/corner resizes — the hash grip is gone */}
      {!tool.fixedSize && <EdgeResizeZones onStart={beginEdgeResize} />}
    </div>
  );
}

interface ToolDockProps {
  side: ToolSide;
  editor: Editor | null;
  scrollContainer?: HTMLDivElement | null;
}


/** v5.97, Derek: the Locations window fullscreen ON THE MAP puts its rail
 *  here, in the side panel — the way the Scrapbook's navigator shows while
 *  its surface owns the editor. Rendered by the dock DIRECTLY rather than
 *  by activating the locations tool, because entering a panel slot clears
 *  fullscreen (openFromRow's own comment explains that machinery) — the two
 *  states fight, and this panel is about where the rail STANDS, not about
 *  which tool is open. */
function FullscreenMapRailPanel() {
  const scenes = useEditorStore((s) => s.scenes);
  const search = useEditorStore((s) => s.locationSearch);
  const filter = useEditorStore((s) => s.locationFilter);
  const sort = useEditorStore((s) => s.locationSort);
  const group = useEditorStore((s) => s.locationGroupFilter);
  const places = useEditorStore((s) => s.locationPlaces);
  const all = React.useMemo(() => groupByLocation(scenes), [scenes]);
  const locations = React.useMemo(
    () => visibleLocations(all, { search, filter, sort, places, group }),
    [all, search, filter, sort, places, group],
  );
  return (
    <div className="tool-inline tool-inline-solo locmap-rail-panel" data-tool="locations-rail">
      <div className="tool-inline-body locmap-rail-panel-body">
        <LocationMapRail locations={locations} allLocations={all} standalone />
      </div>
    </div>
  );
}

export default function ToolDock({ side, editor, scrollContainer }: ToolDockProps) {
  const nameUpper = useEditorStore((s) => s.panelNameCase === 'upper');
  const {
    activeTool, setActiveTool, activeToolRight, setActiveToolRight, toolConfig,
  } = useEditorStore();

  const { toolOrder } = useEditorStore();
  const orderIdx = (id: string) => {
    const i = toolOrder.indexOf(id);
    return i === -1 ? 1000 + ALL_TOOLS.findIndex((t) => t.id === id) : i;
  };
  /* v7.05: the DOCK RAIL filters on the persisted toolConfig, which remembers
     a tool that used to be enabled — so a dev-only surface still had a rail row
     until this filtered too. "Removed from the app" means every surface, and
     the surfaces do not share one list. */
  const tools = ALL_TOOLS.filter((t) => {
    if (PANEL_EXCLUDED_IDS.includes(t.id)) return false;   // never dock these
    if (t.devOnly) return false;
    const cfg = toolConfigFor(toolConfig, t.id);
    return cfg.enabled && cfg.side === side;
  }).sort((a, b) => orderIdx(a.id) - orderIdx(b.id));

  // Labeled divider lines (Customize > Dividers), ordered among the tools via
  // div:<id> tokens in toolOrder. Rendered as entries interleaved by order.
  const { panelDividers } = useEditorStore();
  type DockEntry =
    | { kind: 'tool'; tool: typeof ALL_TOOLS[number] }
    | { kind: 'divider'; id: string; label: string }
    | { kind: 'spacer'; id: string; size?: number };
  const entries: DockEntry[] = [
    ...tools.map((t) => ({ kind: 'tool' as const, tool: t, ord: orderIdx(t.id) })),
    // Spacers (v0.69) share the panelDividers list — a divider with spacer:true.
    // Persisted entries from before v0.69 have no flag, so they stay dividers.
    ...panelDividers.filter((d) => d.side === side).map((d) => (
      d.spacer
        ? { kind: 'spacer' as const, id: d.id, size: d.size, ord: orderIdx(`div:${d.id}`) }
        : { kind: 'divider' as const, id: d.id, label: d.label, ord: orderIdx(`div:${d.id}`) }
    )),
  ].sort((a, b) => a.ord - b.ord).map(({ ord: _o, ...rest }) => rest as DockEntry);

  const activeId = side === 'left' ? activeTool : activeToolRight;
  const setActive = side === 'left' ? setActiveTool : setActiveToolRight;
  const active = tools.find((t) => t.id === activeId) || null;
  // v5.03: the dock's open/close decisions and its caret both go through the
  // store's isToolOpen — one definition of "open", so the row can't say closed
  // and behave open. Taken off the whole-store subscription below on purpose:
  // useEditorStore((s) => s.isToolOpen) would subscribe to a STABLE function
  // identity and never re-render when fullscreenTool changed, leaving a stale
  // chevron. `activeId` still decides which tool renders INLINE in this panel —
  // a different question, and a side-specific one.
  const { toolSizes, setToolSize, toolMode, setToolMode, panelSizeMode, chromeCustomPx, setChromeCustomPx, setPanelSizeMode, uiResizeLocked, panelItemScale, isToolOpen, closeTool } = useEditorStore();
  const fsTool = useEditorStore((s) => s.fullscreenTool);
  const locationsTabNow = useEditorStore((s) => s.locationsTab);
  const dockW = dockWidthFor(side, panelSizeMode[side], chromeCustomPx[side === 'left' ? 'panelLeft' : 'panelRight']);
  // v0.66: by DEFAULT every window opens INSIDE its side panel (inline),
  // pushing the dock's remaining items down — so nothing floats over the
  // editor unasked. `inline` is decided by width <= DOCK_W, and most tools'
  // defaultSize.w exceeded it (Goals 340, Analytics 620, Index Cards 680...),
  // which is why they floated. Clamping the default HERE is what matters: the
  // v0.64 clamp lived in the floating frame and never reached this decision.
  // A size the user has chosen (drag-resize or pop-out) is stored in toolSizes
  // and still wins — pop-out sets w = DOCK_W + 140, which floats as before.
  const activeSize = active
    ? (toolSizes[active.id] || (active.noPanelFit
        // Not shrunk to the panel — opens floating at its natural size.
        ? { w: active.defaultSize.w, h: active.defaultSize.h }
        : { w: Math.min(active.defaultSize.w, dockW), h: active.defaultSize.h }))
    : null;
  // v2.06: the icon rail never hosts inline windows — everything floats.
  const iconsMode = panelSizeMode[side] === 'icons';
  // v4.52, Derek: docked-vs-floating is EXPLICIT state now. The old rule —
  // inline whenever the stored width fit the dock — meant resizing a floating
  // window narrow silently popped it back into the panel. A tool with no
  // stored mode gets its default home: noPanelFit tools float, the rest dock.
  const activeMode = active ? (toolMode[active.id] ?? (active.noPanelFit ? 'floating' : 'docked')) : null;
  // v2.15 (Settings > Tools): Scrapbook solo mode — while it's open, every
  // other sidebar item hides and its window fills the panel. Render-time
  // only: Return to editor restores the sidebars exactly, nothing rewritten.
  // v2.27: BOTH hooks must run unconditionally — `open && useSettings(...)`
  // short-circuited, so opening the Scrapbook changed the hook count and
  // crashed React ("prevDeps.length") under the failed-to-start overlay.
  const scrapbookOpenForSolo = useNotebookStore((s) => s.notebookOpen);
  const scrapbookExclusive = useSettingsStore((s) => s.scrapbookExclusive);
  const scrapbookSolo = scrapbookOpenForSolo && scrapbookExclusive;
  const soloId: ToolId | null = scrapbookSolo ? 'notebook' : null;
  // neverDock tools float regardless — even a stale small toolSize from before
  // the flag existed must not pull them inline.
  const inline = !iconsMode && !!(active && activeSize && activeMode === 'docked' && !active.neverDock);

  /** v4.84, Derek: "none of the windows are remembering the correct position."
   *  The v4.81 row handler FORCED 'docked' on every open, so reopening from
   *  the panel list always snapped a floated or fullscreen tool back into the
   *  panel — the memory was written correctly and then immediately overwritten
   *  by the commonest way to reopen a tool. The row is just the tool's list
   *  entry: it opens the tool in whatever shape it was left in, and only the
   *  explicit gestures (drag out, drop in, fullscreen, shrink) change that. */
  const openFromRow = (t: ToolDef) => {
    /* v5.03, Derek: "clicking on the tool name in the side panel should close
       it, including if it is in full screen mode." It didn't, because the test
       here was `activeId === t.id` — this side's PANEL slot — and
       enterToolFullscreen CLEARS that slot when it raises the takeover. So a
       fullscreen tool read as closed, fell through to the branch below, and
       re-entered the fullscreen it was already in. The row looked live and did
       nothing. isToolOpen/closeTool are the store's one answer; ask them. */
    if (isToolOpen(t.id)) { closeTool(t.id); return; }
    // v5.46, Derek: Design opens its INDEPENDENT window (designPanelOpen) —
    // never the panel slot, so this click disturbs no other window. The
    // store's openTool is the one door; it routes design there.
    if (t.id === 'design') { useEditorStore.getState().openTool('design'); return; }
    const mode = toolMode[t.id] ?? (t.noPanelFit ? 'floating' : 'docked');
    if (mode === 'fullscreen' && !NO_FULLSCREEN.includes(t.id)) {
      useEditorStore.getState().enterToolFullscreen(t.id);
      return;
    }
    // 'docked' and 'floating' are both just "active" — the frame below picks
    // the shape from toolMode, so nothing needs to be written here.
    setActive(t.id);
  };

  const startInlineResize = (e: React.PointerEvent) => {
    if (!active || !activeSize) return;
    e.preventDefault();
    const startY = e.clientY;
    const startH = activeSize.h;
    // Resize the BODY, not just whatever sits above the handle: tools with a
    // footer (Scenes' search) put the footer between the body and this handle,
    // so previousElementSibling would balloon the footer instead of the list.
    const el = (e.currentTarget as HTMLElement).closest('.tool-inline')?.querySelector('.tool-inline-body') as HTMLElement | null;
    let h = startH;
    const onMove = (ev: PointerEvent) => {
      h = Math.max(160, startH + (ev.clientY - startY));
      if (el) el.style.height = `${h}px`;
    };
    const onUp = () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      setToolSize(active.id, activeSize.w, h);
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  };

  // v4.41, Derek: the drag-out is a VISIBLE gesture now. Grabbing the open
  // row (or the window's header strip) and moving ~6px spawns a title-bar
  // ghost that rides the cursor; while it's over the editor area the ghost
  // arms (accent border), and RELEASING there undocks the window — which
  // SNAPS to the classic popped position touching the panel edge (v4.64,
  // Derek; it used to land at the drop point). Released anywhere short of
  // the editor, the ghost vanishes and nothing changes. While a ghost is
  // up, body.fs-tool-dragging suppresses text selection app-wide — WebKit
  // anchors a selection in whatever selectable content the pointer crosses,
  // user-select on the row alone wasn't enough (Derek was painting
  // selections across the panel).
  const draggedOutRef = useRef(false);
  const startDockDragOut = (t: ToolDef, h: number) => (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('button, select, input')) return;
    const editorEl = document.querySelector('.editor-center');
    if (!editorEl) return;
    const startX = e.clientX;
    const startY = e.clientY;
    let ghost: HTMLDivElement | null = null;
    const inEditor = (x: number, y: number) => {
      const r = editorEl.getBoundingClientRect();
      return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
    };
    // The click this gesture ends with dispatches BEFORE timers run, so the
    // flag reliably swallows it — and the timeout guarantees the flag never
    // survives to eat a later, unrelated click (a drag released off the row
    // produces no click at all).
    const armSwallow = () => {
      draggedOutRef.current = true;
      setTimeout(() => { draggedOutRef.current = false; }, 0);
    };
    const cleanup = () => {
      ghost?.remove();
      document.body.classList.remove('fs-tool-dragging');
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
    };
    const onMove = (ev: PointerEvent) => {
      if (!ghost) {
        if (Math.abs(ev.clientX - startX) < 6 && Math.abs(ev.clientY - startY) < 6) return;
        ghost = document.createElement('div');
        ghost.className = 'tool-drag-ghost';
        ghost.textContent = t.label;
        document.body.appendChild(ghost);
        document.body.classList.add('fs-tool-dragging');
        window.getSelection()?.removeAllRanges();
      }
      ghost.style.left = `${ev.clientX + 10}px`;
      ghost.style.top = `${ev.clientY + 8}px`;
      ghost.classList.toggle('armed', inEditor(ev.clientX, ev.clientY));
    };
    const onUp = (ev: PointerEvent) => {
      const dragged = !!ghost;
      cleanup();
      if (!dragged) return;
      armSwallow();   // a real drag must never read as an accordion toggle
      if (inEditor(ev.clientX, ev.clientY)) {
        // v5.41, Derek: a shape-limited tool announces the limit AT the
        // attempt — the drag lands, the toast explains, nothing moves.
        if (SHAPE_NOTES[t.id]) { showToast(SHAPE_NOTES[t.id]!); return; }
        // v5.47: dragging Design out of the panel hands it back to its
        // INDEPENDENT window (mode 'floating' routes every open there).
        if (t.id === 'design') {
          setToolMode(t.id, 'floating');
          const st = useEditorStore.getState();
          st.closeTool('design');
          st.openTool('design');
          return;
        }
        setToolMode(t.id, 'floating');
        setToolSize(t.id, dockW + 140, h);
        // v4.78, Derek: a CLOSED row drags out too — floating means open.
        setActive(t.id);
      }
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  };

  // Clicking back into the script minimizes a FLOATING tool window. A tool
  // docked IN the side panel stays open — v5.35, Derek: "if there is a tool
  // in a side panel toggled open, and i click into the script, that tool
  // window should stay open." (The v1.77 rule predates docked-vs-floating;
  // it was written when every open tool was an overlay.) Tools flagged
  // keepOpenOnEditorClick (Typewriter) survive even as floats — their whole
  // point is being adjusted while the editor has focus.
  useEffect(() => {
    if (!active) return;
    if (toolDef(active.id)?.keepOpenOnEditorClick) return;
    const onPointerDown = (e: PointerEvent) => {
      // presentation can change while open (drag-out) — read it live
      if (useEditorStore.getState().toolMode[active.id] !== 'floating') return;
      const target = e.target as HTMLElement | null;
      if (target && target.closest('.editor-center')) setActive(null);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [active, setActive]);

  const hasSoloTool = soloId !== null && tools.some((t) => t.id === soloId);
  const shownEntries = soloId
    ? entries.filter((en) => en.kind === 'tool' && en.tool.id === soloId)
    : entries;
  const solo = soloId !== null && hasSoloTool;

  if (tools.length === 0) return null;
  if (soloId && !hasSoloTool) return null;   // the other sidebar hides

  /**
   * v1.1 — drag the panel's OUTER edge to size it. Setting a width by opening
   * Customize and picking Compact/Comfortable/Custom was a long way round for
   * something you can see: grab the edge and pull.
   *
   * A drag switches the panel to 'custom' and writes the px, which is the same
   * state Customize edits — so the two agree rather than being rival settings.
   * The left panel grows rightwards and the right panel leftwards, so the delta
   * is inverted for the right.
   */
  const startEdgeResize = (e: React.PointerEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startY = e.clientY;
    const startW = dockW;
    const startScale = useEditorStore.getState().panelItemScale[side];
    const surface = side === 'left' ? 'panelLeft' : 'panelRight';
    let w = startW;
    let wChanged = false;
    // v2.88, Derek: ONE axis per drag — the first direction to travel ≥3px
    // claims it. Pulling sideways sizes the width and never nudges the item
    // scale; pulling vertically scales the items and never resizes.
    let axis: 'h' | 'v' | null = null;
    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      if (!axis) {
        if (Math.abs(dx) < 3 && Math.abs(dy) < 3) return;
        axis = Math.abs(dx) >= Math.abs(dy) ? 'h' : 'v';
        // Switch to custom on the first real horizontal move, not on
        // mousedown — a stray click shouldn't silently change the mode.
        if (axis === 'h') setPanelSizeMode(side, 'custom');
      }
      if (axis === 'v') {
        useEditorStore.getState().setPanelItemScale(side, startScale + dy / 220);
        return;
      }
      const raw = startW + (side === 'left' ? dx : -dx);
      // v2.29, Derek: dragged small enough, the panel clicks into the
      // icon-only rail; dragged back out, it's a normal custom-width panel.
      // The threshold sits halfway between the rail and the minimum width so
      // the snap doesn't flap at the boundary.
      const iconThreshold = (ICON_RAIL_W + PANEL_MIN_W) / 2;
      const st = useEditorStore.getState();
      if (raw < iconThreshold) {
        if (st.panelSizeMode[side] !== 'icons') st.setPanelSizeMode(side, 'icons');
        return;
      }
      if (st.panelSizeMode[side] === 'icons') st.setPanelSizeMode(side, 'custom');
      w = Math.round(Math.max(PANEL_MIN_W, Math.min(PANEL_MAX_W, raw)));
      wChanged = true;
      setChromeCustomPx(surface, w);
    };
    const onUp = () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      if (wChanged && useEditorStore.getState().panelSizeMode[side] !== 'icons') setChromeCustomPx(surface, w);
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  };

  const itemScale = panelItemScale[side];
  return (
    <div
      className={`tool-dock-wrap tool-dock-${side} tool-dock-${panelSizeMode[side]}`}
      // v2.77: the edge's vertical axis scales the dock items via this var.
      style={{ ['--dock-scale' as string]: itemScale }}
    >
      {/* v2.55: the sizing lock removes the grab edge — no dead controls. */}
      {!uiResizeLocked && (
        <div
          className={`tool-dock-edge tool-dock-edge-${side}`}
          onPointerDown={startEdgeResize}
        >
          {/* v2.77: Premiere-style indicator — where the item scale sits */}
          <span
            className="tool-dock-edge-dot"
            style={{ top: `${10 + ((itemScale - 0.7) / 1.1) * 80}%` }}
          />
        </div>
      )}
      <div className={`tool-dock${iconsMode ? ' tool-dock-iconrail' : ''}${solo ? ' tool-dock-scrapbook-solo' : ''}`} style={{ width: dockW }}>
        {/* v3.07's collapse chevron row was REMOVED in v3.25 at Derek's
            request — panels hide from View > Toolbars; the edge strips
            (fs-panel-expand) still re-open a collapsed panel. */}
        {/* v2.06: icon rail — a square per tool (OneNote-style). Clicking
            opens the tool as a floating window; there is no inline state. */}
        {iconsMode ? shownEntries.map((entry) => entry.kind === 'tool' ? (
          <button
            key={entry.tool.id}
            className={`tool-dock-iconbtn${isToolOpen(entry.tool.id) ? ' active' : ''}`}
            title={entry.tool.label}
            // v5.03: the collapsed rail is the same list — an open tool closes,
            // and "open" includes the fullscreen takeover. It used to call
            // setActive(id) on a fullscreen tool, which DOCKED it instead.
            onClick={() => (isToolOpen(entry.tool.id) ? closeTool(entry.tool.id) : setActive(entry.tool.id))}
          >
            {entry.tool.icon}
          </button>
        ) : entry.kind === 'divider' ? (
          <div key={`div-${entry.id}`} className="tool-dock-iconrail-divider" />
        ) : (
          <div key={`sp-${entry.id}`} className="tool-dock-spacer" style={entry.size ? { height: entry.size } : undefined} />
        )) : shownEntries.map((entry) => entry.kind === 'spacer' ? (
          // v0.82: sizeable. Older spacers have no size and keep the default.
          <div
            key={`sp-${entry.id}`}
            className="tool-dock-spacer"
            style={entry.size ? { height: entry.size } : undefined}
          />
        ) : entry.kind === 'divider' ? (
          <div key={`div-${entry.id}`} className="tool-dock-divider">
            <span className="tool-dock-divider-line" />
            {entry.label && <span className="tool-dock-divider-label">{entry.label}</span>}
            {entry.label && <span className="tool-dock-divider-line" />}
          </div>
        ) : (() => {
          const t = entry.tool;
          const isOpenInline = inline && active && active.id === t.id;
          const chrome = TOOL_CHROME[t.id];
          /* v2.00: the pop-out button lives in the window's HEADER — the row
             INSIDE the window, below the dock button (Derek's terminology) —
             on the side closest to the editor: far right in the left panel,
             far left in the right panel, pointing at the editor.
             v3.83, Derek: the Scrapbook is panel-bound again — its writing
             surface takes over the editor area, so a floating pop-out makes no
             sense. No pop-out button on it. */
          return (
          <React.Fragment key={t.id}>
            {/* a div, not a button: the header row can CONTAIN buttons and
                dropdowns (chrome controls, show/hide), and buttons can't nest.
                v4.40, Derek: the docked look is the PRE-v4.39 one again — a
                compact accordion row (count + window actions ride it), with
                tabs + controls on their own strip inside the window below.
                Only the MECHANICS kept v4.39: no pop buttons; drag the row
                all the way into the editor area to float the window. The
                Scrapbook stays panel-bound (v3.83), so no drag-out on it. */}
            <div
              role="button"
              tabIndex={0}
              data-tool-row={t.id}
              className={'tool-dock-item' + (isToolOpen(t.id) ? ' active' : '') + (isOpenInline ? ' tool-dock-item-header' : '')}
              onClick={(e) => {
                // Header controls (dropdowns, chrome buttons) act, they don't toggle.
                if ((e.target as HTMLElement).closest('select, input, button')) return;
                // A drag just happened — the release must not re-toggle.
                if (draggedOutRef.current) { draggedOutRef.current = false; return; }
                openFromRow(t);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  if ((e.target as HTMLElement).closest('select, input, button')) return;
                  e.preventDefault();
                  openFromRow(t);
                }
              }}
              // v4.78, Derek: closed rows drag out too — a tool doesn't need
              // to be open to be pulled into a floating window. Height comes
              // from its remembered (or default) size when it isn't open.
              onPointerDown={!t.neverDock && t.id !== 'notebook'
                ? startDockDragOut(t, isOpenInline ? activeSize!.h : (toolSizes[t.id]?.h ?? t.defaultSize.h))
                : undefined}
              title={t.label}
            >
              {/* v1.34: Premiere-style caret — a SINGLE chevron: right when
                * closed, down when open. */}
              <span className="tool-dock-caret">
                {isToolOpen(t.id) ? <FaChevronDown /> : <FaChevronRight />}
              </span>
              <span className="tool-dock-icon">{t.icon}</span>
              <span className={`tool-dock-label${nameUpper ? ' tool-name-upper' : ''}`}>{t.label}</span>
              {isOpenInline && chrome?.TitleExtra && <chrome.TitleExtra />}
              {isOpenInline && chrome?.WindowActions && (
                <span className="tool-dock-item-actions"><chrome.WindowActions /></span>
              )}
            </div>
            {/* v5.99, Derek: fullscreen on the map, the rail sits UNDER the
                Locations row — in whichever panel the writer keeps it. The
                row is the label, so the panel carries no second header. */}
            {t.id === 'locations' && fsTool === 'locations' && locationsTabNow === 'map' && (
              <FullscreenMapRailPanel />
            )}
            {isOpenInline && (
              <div className={`tool-inline${side === 'right' ? ' tool-inline-right' : ''}${solo ? ' tool-inline-solo' : ''}`} data-tool={t.id}>
                {/* The window's own header strip — tabs left, controls right,
                    the fullscreen button at the editor-facing end (where the
                    pop-out used to sit). Wraps when the column is narrow. */}
                <div
                  className="tool-inline-header"
                  // v4.41: this strip is a drag-out handle too — Derek grabs
                  // "the window's header", which is as often this row as the
                  // accordion row above it. Controls are exempt (the guard).
                  onPointerDown={!t.neverDock && t.id !== 'notebook'
                    ? startDockDragOut(t, activeSize!.h)
                    : undefined}
                >
                  {chrome?.useTabs && <HeaderTabs chrome={chrome} />}
                  <span className="tool-chrome-controls">
                    {chrome?.Controls && <chrome.Controls />}
                  </span>
                  {/* v4.90, Derek: "keep the X close button in all tool window
                      headers when it is inside the side panel too." So the
                      docked strip carries the SAME actions cluster as a
                      floating window — fullscreen · close, pinned to the
                      header's top-right corner by the shared CSS. That also
                      retires the v4.40 editor-facing placement, which put the
                      fullscreen button on the left in a right-hand panel: with
                      a close button beside it, the pair belongs where every
                      window's buttons are. Closing collapses the tool back to
                      its row, which is what clicking the row again does. */}
                  <span className="tool-chrome-actions">
                    {!NO_FULLSCREEN.includes(t.id) && <ToolFullscreenButton id={t.id} />}
                    <button
                      className="tool-window-close"
                      onClick={(e) => { e.stopPropagation(); setActive(null); }}
                      title="Close"
                    ><CloseIcon /></button>
                  </span>
                </div>
                <div className="tool-inline-body" style={solo ? undefined : { height: activeSize!.h }}>
                  <ToolContent id={active!.id} editor={editor} scrollContainer={scrollContainer} />
                </div>
                {/* v5.30, Derek: shape-limited tools SAY so at the bottom of
                    their side-panel window instead of just missing buttons. */}
                {/* (v5.41: the SHAPE_NOTES foot text is gone — the limit
                    toasts at the attempted move instead.) */}
                {!solo && (
                  <div
                    className="tool-inline-resize"
                    onPointerDown={startInlineResize}
                  />
                )}
              </div>
            )}
          </React.Fragment>
          );
        })())}
      </div>

      {active && !inline && (
        <ToolWindowFrame tool={active} side={side} onClose={() => setActive(null)}>
          <ToolContent id={active.id} editor={editor} scrollContainer={scrollContainer} />
        </ToolWindowFrame>
      )}
    </div>
  );
}

/** Temporary window for tools disabled in both panels (opened from the Tools menu). */
export function TempToolWindow({ editor, scrollContainer }: {
  editor: Editor | null; scrollContainer?: HTMLDivElement | null;
}) {
  const { tempTool, setTempTool } = useEditorStore();

  // Clicking back into the script closes the temporary window too —
  // same keepOpenOnEditorClick exemption as the docked windows (v1.77).
  useEffect(() => {
    if (!tempTool) return;
    if (toolDef(tempTool)?.keepOpenOnEditorClick) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && target.closest('.editor-center')) setTempTool(null);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [tempTool, setTempTool]);

  const tool = toolDef(tempTool);
  if (!tool) return null;
  return (
    <div className="tool-temp-anchor">
      <ToolWindowFrame tool={tool} onClose={() => setTempTool(null)} temporary>
        <ToolContent id={tool.id} editor={editor} scrollContainer={scrollContainer} />
      </ToolWindowFrame>
    </div>
  );
}
