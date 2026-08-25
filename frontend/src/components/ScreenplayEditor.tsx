import React, { useEffect, useCallback, useRef, useState, useMemo } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import type { JSONContent } from '@tiptap/react';
import Document from '@tiptap/extension-document';
import Text from '@tiptap/extension-text';
import Bold from '@tiptap/extension-bold';
import Italic from '@tiptap/extension-italic';
import Underline from '@tiptap/extension-underline';
import History from '@tiptap/extension-history';
import Dropcursor from '@tiptap/extension-dropcursor';
import SmartTypography from '../editor/extensions/SmartTypography';
import VomitLock from '../editor/extensions/VomitLock';
import TypewriterScroll, { refreshTypewriterChrome, centerCaretLine } from '../editor/extensions/TypewriterScroll';
import OutlineBar from './OutlineBar';
import { NotebookSurface } from './NotebookTool';
import ScriptNotePopover from './ScriptNotePopover';
import MarkupPopover from './MarkupPopover';
import MarkupIconLayer from './MarkupIconLayer';
import { useNotebookStore } from '../stores/notebookStore';
import Gapcursor from '@tiptap/extension-gapcursor';
import TextAlign from '@tiptap/extension-text-align';
import Placeholder from '@tiptap/extension-placeholder';
import TextStyle from '@tiptap/extension-text-style';
import Color from '@tiptap/extension-color';
import FontFamily from '@tiptap/extension-font-family';
import { Extension } from '@tiptap/core';
import { TextSelection, type Transaction } from '@tiptap/pm/state';

import {
  SceneHeading, Action, Character, Dialogue, Parenthetical,
  Transition, General, Shot, NewAct, EndOfAct, Lyrics,
  ShowEpisode, CastList, FontSize, ScriptNoteMark, ScriptMarkupMark, MarkupBlockAnchor, TagMark,
  FormatOverride, CustomElement, DualDialogue, DualDialogueColumn,
  TitlePage, CustomPage, CustomPageKeymap,
  AvBlock, AvRow, AvCell, AvPara, AvShot, AvDirection, AvKeymap,
} from '../editor/extensions';
import { registerAvCellPicker } from '../editor/extensions/AvBlock';
import Strike from '@tiptap/extension-strike';
import Subscript from '@tiptap/extension-subscript';
import Superscript from '@tiptap/extension-superscript';
import Highlight from '@tiptap/extension-highlight';
import { useFormattingTemplateStore } from '../stores/formattingTemplateStore';
import { generateTemplateCss, injectTemplateCss } from '../utils/templateCss';
import { collectOutlineSections, outlineSectionSignature, syncSectionAnnotations } from '../utils/outlineScriptSync';
import { docHasAnyText } from '../utils/docText';
import { getCurrentElementRule, getLockedFormatting } from '../utils/effectiveFormatting';
import UpdateBanner from './UpdateBanner';
import { setPaginationPrintMode, setPaginationVisibility, setPaginationContinuousMode, CONTINUOUS_GAP_PX, createPaginationPlugin, getPageMetrics, setMeasuredFills } from '../editor/pagination';
import { createContdCasePlugin } from '../editor/contdCase';
import { ScreenplayImage } from '../editor/extensions/ScreenplayImage';
import { insertImageNode } from '../utils/insertImage';

import type { PageLayout } from '../stores/editorStore';
import { useEditorStore, migratePageLayout, DEFAULT_HEADER_CONTENT, DEFAULT_FOOTER_CONTENT, DEFAULT_PAGE_LAYOUT, DEFAULT_TAG_CATEGORIES, resolveMoresContds } from '../stores/editorStore';
import type { ElementType } from '../stores/editorStore';
import MenuBar from './MenuBar';
import Toolbar from './Toolbar';
import ToolDock, { TempToolWindow, ToolFullscreenTakeover } from './ToolDock';
import DesignPanel from './DesignPanel';
import { applyDesignVars } from '../design/designTokens';
import { DoubleChevronIcon } from './uiIcons';
import { useBookmarkStore, bookmarkScriptKey } from '../stores/bookmarkStore';
import TitleBar from './TitleBar';
import BeatBoard from './BeatBoard';
import ScriptStatistics from './ScriptStatistics';
import { captureSelectionSnippet } from './StickyNotes';
import { ht } from '../utils/helperText';
import { isScriptExt, scriptFileName, SCRIPT_FORMAT_LABEL } from '../utils/scriptFileExt';
import LocationDatabase, { parseLocationFromHeading } from './LocationDatabase';
import FormatPanel from './FormatPanel';
import StatusBar from './StatusBar';
import SearchReplace, { createSearchPlugin } from './SearchReplace';
import GoToPage from './GoToPage';
import EditorRulers from './EditorRulers';
import SavedFlash from './SavedFlash';
import { chromePx, chromeMin, chromeMax } from './chromeSizes';
import ElementPicker from './ElementPicker';
import CharacterAutocomplete from './CharacterAutocomplete';
import SpellCheckModal from './SpellCheckModal';
import WritingSuggestionsModal from './WritingSuggestionsModal';
import GrammarRulesPanel from './GrammarRulesPanel';
// MobileAccessoryBar removed — context menu via 3-finger touch only
import ScriptContextMenu from './ScriptContextMenu';
import { SpellCheck, spellCheckPluginKey } from '../editor/extensions/SpellCheck';
import { Grammar, grammarPluginKey } from '../editor/extensions/Grammar';
import { spellChecker, BUILTIN_LANGUAGE } from '../editor/spellchecker';
import { grammarIgnore } from '../editor/grammar/grammarIgnore';
import { runRetext, RETEXT_CATEGORIES, type RetextCategory } from '../editor/grammar/retextProvider';
import { runHarper } from '../editor/grammar/harperProvider';
import { clearEditorHistory } from '../editor/clearHistory';
import { useProjectStore } from '../stores/projectStore';
import { api } from '../services/api';
import { cloudApi } from '../services/cloudApi';
import { projectApi } from '../services/projectApi';
import { scriptApi } from '../services/scriptApi';
import { showToast } from './Toast';
import { confirmDialog } from './ConfirmDialog';
import AssetManager from './AssetManager';
import { useParams, useNavigate } from 'react-router';
import OpenFile from './OpenFile';
import type { OpenSource } from './OpenFile';
import WelcomeDialog, { type WelcomeChoice } from './WelcomeDialog';
import { parseFountain } from '../utils/fountainParser';
import { parseFDXFull } from '../utils/fdxParser';
import { parseOdraft } from '../utils/odraftFormat';
import SaveAsDialog from './SaveAsDialog';
import PreviewSidebar from './PreviewSidebar';
import { mirrorSnapshot } from '../services/saveLocations';
import TitlePageEditor from './TitlePageEditor';
import MoresContdsDialog from './MoresContdsDialog';
import CompareVersionPicker from './CompareVersionPicker';
import ScriptDiffView from './ScriptDiffView';
import ZoomPanel from './ZoomPanel';
import { useIsTouchDevice, useSwipeEdge, usePinchZoom } from '../hooks/useTouch';
import { usePanelResize } from '../hooks/usePanelResize';
import { useFileAssociation } from '../hooks/useFileAssociation';
import { useAutoContd } from '../hooks/useAutoContd';
import { useCastCollection } from '../hooks/useCastCollection';
import { useSettingsStore } from '../stores/settingsStore';
import { refreshTitlePageDraftDate, DISPLAY_REFRESH_META } from '../utils/titlePageDraftLine';
import { setLogoutEditorReset } from '../services/collabAuth';
import { isTauri } from '../services/platform';
import { reportSaveError } from '../stores/saveErrorStore';
import { pluginRegistry } from '../plugins/registry';
import { createTrackChangesPlugin, trackChangesPluginKey } from '../editor/trackChanges';
import type { VersionInfo } from '../services/api';
import { resolveHFFields, composeSaveContent, stripSaveExtras, resolveSpellCheckOnLoad } from '../utils/screenplaySaveContent';
import { readPlaces, migratePins } from '../utils/locationPlaces';
import { migrateShelfCards } from '../utils/shelfMigrate';

import { DEFAULT_NEXT_TYPE, ALL_ELEMENT_TYPES, SCENE_PREFIX_OPTIONS, SAMPLE_CONTENT, resolvePickedElement } from './screenplayEditorConstants';
import { isWorkingNoteText } from '../utils/workingNotes';

interface OverlayInfo {
  top: number;
  pageNumber: number;
  isDialogueSplit: boolean;
  characterName: string;
  isTitlePage: boolean;
  /** v5.40: this break opens a CUSTOM page — unnumbered, no header */
  isCustomPage?: boolean;
  /** v5.40: the page before this break is custom — its footer is suppressed */
  afterCustomPage?: boolean;
}


// resolveHFFields + composeSaveContent moved to utils/screenplaySaveContent.ts
// (imported above) so composeSaveContent — the single source of truth for the
// save extras list — can be unit-tested in isolation.

const ScreenplayEditor: React.FC = () => {
  const { projectId: urlProjectId, scriptId: urlScriptId, commitHash: urlCommitHash } = useParams<{ projectId?: string; scriptId?: string; commitHash?: string }>();
  const navigate = useNavigate();
  const isHistoryMode = Boolean(urlCommitHash);

  // v5.47, Derek: while the annotation EDIT window is open, the script shows
  // annotations whatever the hide toggle says (an override, not a write —
  // closing the window falls back to the chosen state untouched).
  const markupEditOpen = useEditorStore((s) => s.markupEditorId != null);
  // v5.51, Derek: the pick-to-place prompt is a persistent banner at the
  // top of the editor section (sticky, centered) until text is selected;
  // Escape cancels (the MarkupIconLayer listener owns both).
  const markupCreatePick = useEditorStore((s) => s.markupCreatePick);

  const {
    setActiveElement, setScenes, setPageCount, setCurrentPage,
    zoomLevel, setZoomLevel, fontFamily, fontSize, pageLayout, tagsVisible, notesVisible, markupsVisible,
    sectionsVisible, scriptTodosVisible, markersVisible, viewStyle, previewMode, previewOpts,
    beatBoardOpen, statisticsOpen, fullscreenTool,
    navigatorOpen, toggleNavigator, shelfOpen, toggleShelf,
    characterProfilesOpen, tagsPanelOpen, locationDatabaseOpen,
    spellCheckEnabled, spellModalOpen, setSpellModalOpen, spellPanelMounted,
    grammarCheckEnabled, grammarModalOpen, setGrammarModalOpen, grammarPanelMounted,
    grammarRulesPanelOpen, setGrammarRulesPanelOpen,
    setDocumentTitle,
    sceneNumbersVisible, sceneNumbersLocked,
    saveStatus, saveError, setSaveStatus,
  } = useEditorStore();

  const { currentProject, currentScriptId, setCurrentProject, setCurrentScriptId, scriptReloadKey, markCloudScript, isCloudScript } = useProjectStore();

  // ── Panel resize (hooks/usePanelResize) ──
  const { navWidth, rightPanelWidth, onResizePointerDown: handleResizePointerDown } = usePanelResize();

  // Sync nav width to store for floating menu positioning
  useEffect(() => {
    useEditorStore.getState().setNavPanelWidth(navigatorOpen ? 300 : 0);
  }, [navWidth, navigatorOpen]);

  const rightPanelVisible = shelfOpen || characterProfilesOpen || tagsPanelOpen || locationDatabaseOpen;



  const editorMainRef = useRef<HTMLDivElement | null>(null);
  /* v5.04: the scroll container ALSO lives in state, and the tools read the
     state one — not `editorMainRef.current`.
     Reading a ref during render is the bug that made clicking a scene in the
     Scenes list do nothing: on the first render .current is still null (the
     div below hasn't mounted), and a ref changing never re-renders, so every
     tool was handed `null` forever. goToScene's `if (scrollContainer)` then
     quietly skipped the scroll. IndexCards had already worked around it with
     its own document.querySelector('.editor-main') fallback — one component
     patched, the other left broken, which is how the two views disagreed.
     A callback ref feeds both, so there is one container and it is never
     null after mount. */
  const [editorMainEl, setEditorMainEl] = useState<HTMLDivElement | null>(null);
  const attachEditorMain = useCallback((el: HTMLDivElement | null) => {
    editorMainRef.current = el;
    setEditorMainEl(el);
  }, []);


  /* v2.29/v2.31, Derek: two separate grips. The strip UNDER the menu bar +
     toolbar scales those two together (custom px, mode flips to 'custom');
     the strip at the very bottom — only when the outline bar is open —
     scales the outline bar's row height alone. */
  const topChromeRef = useRef<HTMLDivElement>(null);
  const startBarsResize = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const s0 = useEditorStore.getState();
    const menu0 = chromePx('menu', s0.menuMode === 'hidden' ? 'compact' : s0.menuMode, s0.chromeCustomPx.menu);
    const toolbar0 = chromePx('toolbar', s0.toolbarMode === 'hidden' ? 'compact' : s0.toolbarMode, s0.chromeCustomPx.toolbar);
    const menuHidden = s0.menuMode === 'hidden';
    const toolbarHidden = s0.toolbarMode === 'hidden';
    const h0 = menu0 + toolbar0;
    if (h0 <= 0) return;
    const onMove = (ev: PointerEvent) => {
      const f = Math.min(2.5, Math.max(0.5, (h0 + ev.clientY - startY) / h0));
      const st = useEditorStore.getState();
      if (!menuHidden) {
        if (st.menuMode !== 'custom') st.setMenuMode('custom');
        st.setChromeCustomPx('menu', Math.min(chromeMax('menu'), Math.max(chromeMin('menu'), Math.round(menu0 * f))));
      }
      if (!toolbarHidden) {
        if (st.toolbarMode !== 'custom') st.setToolbarMode('custom');
        st.setChromeCustomPx('toolbar', Math.min(chromeMax('toolbar'), Math.max(chromeMin('toolbar'), Math.round(toolbar0 * f))));
      }
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }, []);
  const startOutlineBarResize = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const rowScale0 = useEditorStore.getState().outlineBarRowScale;
    const onMove = (ev: PointerEvent) => {
      // v2.50, Derek: 1:1 — the bar grows exactly as far as the mouse moves.
      // Every row takes the SAME pixel delta (see OutlineBar's rowDelta,
      // 26px per scale unit), so dy spreads over rows × 26.
      const rows = Math.max(1, useEditorStore.getState().outlineBarRows.length);
      useEditorStore.getState().setOutlineBarRowScale(rowScale0 + (ev.clientY - startY) / (rows * 26));
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }, []);
  const pageRef = useRef<HTMLDivElement>(null);
  const setPageCountRef = useRef(setPageCount);
  setPageCountRef.current = setPageCount;
  const pageLayoutRef = useRef(pageLayout);
  pageLayoutRef.current = pageLayout;

  // ── Touch gestures (must be after editorMainRef) ──
  const isTouch = useIsTouchDevice();
  useSwipeEdge({
    edge: 'left',
    onSwipe: toggleNavigator,
    enabled: isTouch && !navigatorOpen && typeof window !== 'undefined' && window.innerWidth <= 1100,
  });
  useSwipeEdge({
    edge: 'right',
    onSwipe: toggleShelf,
    enabled: isTouch && !rightPanelVisible,
  });
  usePinchZoom(editorMainRef, {
    currentZoom: zoomLevel,
    onZoomChange: setZoomLevel,
    enabled: isTouch && !beatBoardOpen,
  });

  // 3-finger touch opens context menu on touch devices
  useEffect(() => {
    if (!isTouch) return;
    const handleThreeFingerTouch = (e: TouchEvent) => {
      if (e.touches.length === 3) {
        e.preventDefault();
        // Use center of the three touches as position
        let cx = 0, cy = 0;
        for (let i = 0; i < 3; i++) {
          cx += e.touches[i].clientX;
          cy += e.touches[i].clientY;
        }
        cx /= 3;
        cy /= 3;
        setCtxMenuState({ visible: true, position: { x: cx, y: cy }, spellInfo: null, grammarInfo: null });
      }
    };
    document.addEventListener('touchstart', handleThreeFingerTouch, { passive: false });
    return () => document.removeEventListener('touchstart', handleThreeFingerTouch);
  }, [isTouch]);

  const zoomLevelRef = useRef(zoomLevel);
  // Preserve scroll position when zoom changes: content scales but scrollTop
  // is in viewport pixels, so without an adjustment the user lands on a
  // completely different page after each zoom step.
  const prevZoomRef = useRef(zoomLevel);
  useEffect(() => {
    const el = editorMainRef.current;
    if (!el) {
      prevZoomRef.current = zoomLevel;
      return;
    }
    const oldScale = (prevZoomRef.current || 100) / 100;
    const newScale = (zoomLevel || 100) / 100;
    if (oldScale !== newScale && el.scrollTop > 0) {
      el.scrollTop = el.scrollTop * (newScale / oldScale);
    }
    prevZoomRef.current = zoomLevel;
  }, [zoomLevel]);
  zoomLevelRef.current = zoomLevel;

  const [overlays, setOverlays] = useState<OverlayInfo[]>([]);

  const {
    openFileOpen, setOpenFileOpen, saveAsOpen, setSaveAsOpen,
    titlePageEditorOpen, setTitlePageEditorOpen,
    moresContdsOpen, setMoresContdsOpen,
    compareVersionOpen, setCompareVersionOpen,
    setTrackChangesEnabled, setTrackChangesLabel,
  } = useEditorStore();

  // Auto-fit page to viewport on mobile/tablet
  const autoZoomApplied = useRef(false);
  useEffect(() => {
    const handleAutoZoom = () => {
      if (window.innerWidth <= 768 && editorMainRef.current) {
        const containerWidth = editorMainRef.current.clientWidth - 16; // small padding
        const pageWidthPx = pageLayout.pageWidth * 96; // 1in = 96px
        const fitZoom = Math.floor((containerWidth / pageWidthPx) * 100);
        setZoomLevel(Math.max(50, Math.min(100, fitZoom)));
        autoZoomApplied.current = true;
      } else if (autoZoomApplied.current && window.innerWidth > 768) {
        setZoomLevel(100);
        autoZoomApplied.current = false;
      }
    };
    // Delay initial call to ensure editorMainRef is measured
    const timer = setTimeout(handleAutoZoom, 100);
    window.addEventListener('resize', handleAutoZoom);
    window.addEventListener('orientationchange', handleAutoZoom);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('resize', handleAutoZoom);
      window.removeEventListener('orientationchange', handleAutoZoom);
    };
  }, [pageLayout.pageWidth, setZoomLevel]);

  // v1.57: the old welcome card no longer fronts a launch — the New Script
  // prompt does (see the auto-load effect). The card stays wired for the
  // welcome-choice handler but never self-opens.
  const [showWelcome, setShowWelcome] = useState(false);

  // ── Drag-and-drop file import state ──

  // Element picker state. `availableTypes`, when set, restricts the picker
  // to that exact list (used inside AV cells where only avPara/avShot/avDirection apply).
  const [pickerState, setPickerState] = useState<{
    visible: boolean;
    position: { top: number; left: number };
    defaultType: ElementType;
    availableTypes?: ElementType[];
    suggestType?: ElementType;
    prevScriptType?: string | null;
  }>({ visible: false, position: { top: 0, left: 0 }, defaultType: 'action' });

  const showPickerRef = useRef<(defaultType: ElementType, availableTypes?: ElementType[], suggestType?: ElementType, prevScriptType?: string | null) => void>(() => {});

  // Character autocomplete state. v3.44, Derek: the same dropdown also serves
  // scene headings (INT./EXT.) and transitions — `mode` picks how a pick is
  // inserted (a trailing space for scene prefixes).
  // v7.08: the cast is no longer mirrored into local state — collectCast()
  // reads the document, so the dropdown and the tools can't drift apart.
  const [charAutoState, setCharAutoState] = useState<{
    visible: boolean;
    mode: 'character' | 'scene' | 'transition';
    position: { top: number; left: number };
    suggestions: string[];
  }>({ visible: false, mode: 'character', position: { top: 0, left: 0 }, suggestions: [] });
  const charAutoDismissedRef = useRef(false);

  const [formatPanelOpen, setFormatPanelOpen] = useState(false);

  // Script context menu state
  const [ctxMenuState, setCtxMenuState] = useState<{
    visible: boolean;
    position: { x: number; y: number };
    spellInfo: { word: string; from: number; to: number; suggestions: string[] } | null;
    grammarInfo: { from: number; to: number; ruleId: string; message: string; severity: 'style' | 'grammar'; suggestions: string[] } | null;
    savedSelection?: { from: number; to: number };
  }>({ visible: false, position: { x: 0, y: 0 }, spellInfo: null, grammarInfo: null });

  const breaksRef = useRef<import('../editor/pagination').BreakInfo[]>([]);
  // Editor handle + last-applied measured fills, for the measured-fill pass that
  // pads each page to its exact rendered height (see measureOverlays).
  const editorRef = useRef<ReturnType<typeof useEditor> | null>(null);
  const appliedFillsRef = useRef<Map<number, number>>(new Map());

  // Measure overlay positions from the actual DOM after decorations are applied
  const measureOverlays = useCallback(() => {
    if (!pageRef.current) return;
    const pageEl = pageRef.current;
    const root = pageEl.querySelector('.tiptap');
    if (!root) return;

    const pageRect = pageEl.getBoundingClientRect();
    const m = getPageMetrics(pageLayoutRef.current);
    // Track-change deletion widgets become DOM siblings of real document
    // nodes, which would shift every index after them and make the page
    // break overlay land in the wrong place.  Filter them out so
    // children[brk.nodeIndex] matches the ProseMirror model index.
    // Normal editing (no track changes) has no such widgets, so this is
    // a no-op there.
    const children = (Array.from(root.children) as HTMLElement[]).filter(
      (el) =>
        !el.classList.contains('track-change-deleted') &&
        !el.classList.contains('track-change-deleted-block'),
    );
    const breaks = breaksRef.current;
    if (breaks.length === 0) { setOverlays([]); return; }

    // getBoundingClientRect returns coordinates in viewport space (affected by
    // CSS transform: scale), but the overlay top is in the page's local
    // (unscaled) coordinate system.  Divide by zoom to convert.
    const scale = (zoomLevelRef.current || 100) / 100;
    const lineHeightPx = 12 * (96 / 72); // 16px — matches pagination LINE_HEIGHT_PT
    const newOverlays: OverlayInfo[] = [];
    for (const brk of breaks) {
      const el = children[brk.nodeIndex];
      if (!el) continue;
      const elRect = el.getBoundingClientRect();
      // Continuous view: the boundary line owns the whole fixed gap — no
      // CONT'D allowance is reserved there, so subtracting it drew the line
      // one text-line too high, striking through the previous block.
      const continuous = viewStyleRef.current === 'continuous';
      const contdHeight = !continuous && brk.isDialogueSplit ? lineHeightPx : 0;
      // Continuous: the divide line sits at the MIDDLE of the 2-row gap, so one
      // blank row falls above it (below the finished page) and one below it
      // (above the next page). Page view: the sep owns the full margin band.
      const sepSpace = continuous ? CONTINUOUS_GAP_PX / 2 : m.sepHeightPx;
      const overlayTop = (elRect.top - pageRect.top) / scale - sepSpace - contdHeight;
      newOverlays.push({
        top: overlayTop,
        pageNumber: brk.pageNumber,
        isDialogueSplit: brk.isDialogueSplit,
        characterName: brk.characterName,
        isTitlePage: brk.isTitlePage,
        isCustomPage: brk.isCustomPage,
        afterCustomPage: brk.afterCustomPage,
      });
    }
    setOverlays(newOverlays);

    // ── Measured page fill (v4.22, Derek) ──────────────────────────────────
    // The line-budget fill can be a hair off from what the browser actually
    // renders, leaving pages slightly over/under a full page. Measure each
    // page's REAL content height and hand the paginator the exact whitespace
    // to make it precisely one page tall. Keyed by page number (stable across
    // edits); only re-dispatched when a fill really moved, so it converges in
    // one pass and never loops. Skipped in Preview (its title page shifts the
    // geometry and it isn't the editing surface).
    if (!previewModeRef.current) {
      const fills = new Map<number, number>();
      let pageStart = m.contentStartPx;                     // page 1 content top (unscaled)
      for (const brk of breaks) {
        const breakEl = children[brk.nodeIndex];
        // The title region keeps the budget path; just advance the cursor.
        // v5.40: a custom-page-opening break shares its pageNumber with the
        // next script page — recording its fill would cross their wires.
        if (!brk.isTitlePage && !brk.isCustomPage) {
          const lastEl = children[brk.nodeIndex - 1];
          if (lastEl && breakEl) {
            const contentEnd = (lastEl.getBoundingClientRect().bottom - pageRect.top) / scale;
            const naturalHeight = contentEnd - pageStart;
            fills.set(brk.pageNumber, Math.max(0, m.pageContentPx - naturalHeight));
          }
        }
        if (breakEl) pageStart = (breakEl.getBoundingClientRect().top - pageRect.top) / scale;
      }
      // Re-dispatch only when a fill really moved. The threshold sits above
      // sub-pixel getBoundingClientRect noise (which /scale amplifies at low
      // zoom) so a converged layout can't oscillate; 2px is 0.02", invisible.
      const prev = appliedFillsRef.current;
      let changed = fills.size !== prev.size;
      if (!changed) {
        for (const [pg, v] of fills) {
          const pv = prev.get(pg);
          if (pv === undefined || Math.abs(pv - v) > 2) { changed = true; break; }
        }
      }
      if (changed) {
        appliedFillsRef.current = fills;
        setMeasuredFills(fills);
        const ed = editorRef.current;
        if (ed) {
          try { ed.view.dispatch(ed.state.tr.setMeta('forceRepaginate', true)); } catch { /* ignore */ }
        }
      }
    }
  }, []);

  const [PaginationExtension] = React.useState(() =>
    Extension.create({
      name: 'pagination',
      addProseMirrorPlugins() {
        return [
          createPaginationPlugin(
            (state) => {
              setPageCountRef.current(state.pageCount);
              breaksRef.current = state.breaks;
              // Measure from DOM after ProseMirror applies decoration margins
              requestAnimationFrame(() => requestAnimationFrame(measureOverlays));
            },
            () => pageLayoutRef.current,
          ),
        ];
      },
    })
  );

  const [ContdCaseExtension] = React.useState(() =>
    Extension.create({
      name: 'contdCase',
      addProseMirrorPlugins() {
        return [createContdCasePlugin(() => pageLayoutRef.current)];
      },
    })
  );

  // Search highlight plugin
  const [SearchExtension] = React.useState(() =>
    Extension.create({
      name: 'searchHighlight',
      addProseMirrorPlugins() {
        return [createSearchPlugin()];
      },
    })
  );

  // Track changes plugin
  const [TrackChangesExtension] = React.useState(() =>
    Extension.create({
      name: 'trackChanges',
      addProseMirrorPlugins() {
        return [createTrackChangesPlugin()];
      },
    })
  );

  // Block formatting shortcuts (Mod-b/i/u) when the attribute is locked by the template
  const [EnforceGuardExtension] = React.useState(() =>
    Extension.create({
      name: 'enforceGuard',
      priority: 1001,
      addKeyboardShortcuts() {
        const isLocked = (editor: any, attr: 'bold' | 'italic' | 'underline') => {
          const tpl = useFormattingTemplateStore.getState().getActiveTemplate();
          if (tpl.mode !== 'enforce') return false;
          const rule = getCurrentElementRule(editor, tpl);
          const locked = getLockedFormatting(rule, true);
          return locked[attr];
        };
        return {
          'Mod-b': ({ editor }) => isLocked(editor, 'bold'),
          'Mod-i': ({ editor }) => isLocked(editor, 'italic'),
          'Mod-u': ({ editor }) => isLocked(editor, 'underline'),
        };
      },
    })
  );

  // Centralized Enter handler — overrides per-extension Enter handlers via high priority
  const [EnterHandlerExtension] = React.useState(() =>
    Extension.create({
      name: 'enterHandler',
      priority: 1000,
      addKeyboardShortcuts() {
        return {
          Enter: ({ editor }) => {
            const { $from } = editor.state.selection;
            const currentNode = $from.parent;
            const currentType = currentNode.type.name;
            const isEmpty = currentNode.textContent.trim() === '';

            // A non-text selection (e.g. a selected image atom) — let ProseMirror's
            // default Enter handle it. Computing block positions below would throw
            // "no position before the top-level node" for a top-level NodeSelection.
            if (!$from.parent.isTextblock) return false;

            // ── To-Do lists continue on Enter (v0.94) ──
            // A to-do line is a `general` node starting with [ ] or [x]. Enter on
            // one starts the next to-do in the list; Enter on an EMPTY to-do ends
            // the list, clearing the marker so you're back to a normal line —
            // the same rhythm as a bullet list anywhere else.
            if (currentType === 'general') {
              const line = currentNode.textContent;
              const m = /^\[[ x]\]\s?(.*)$/.exec(line);
              if (m) {
                const rest = m[1].trim();
                const start = $from.before($from.depth);
                if (rest === '') {
                  // Empty to-do: strip the marker and end the list.
                  const tr = editor.state.tr.delete(start + 1, start + 1 + line.length);
                  editor.view.dispatch(tr);
                  return true;
                }
                // Otherwise: a fresh to-do line, ready to type into.
                editor.chain().focus()
                  .insertContentAt($from.after($from.depth), {
                    type: 'general',
                    content: [{ type: 'text', text: '[ ] ' }],
                  })
                  .run();
                // Park the caret AFTER the "[ ] " marker of the new line.
                const after = editor.state.selection.$from;
                editor.commands.setTextSelection(after.pos);
                return true;
              }
            }

            // Title-page lines must STAY in the title page: Enter adds another
            // (blank) title-page line instead of a body element, so the content
            // shifts down one line rather than breaking to the next page.
            if (currentType === 'titlePage') {
              const atStartTp = $from.parentOffset === 0;
              editor.chain().splitBlock().run();
              const s2 = editor.state;
              const np = s2.selection.$from;
              if (np.depth > 0) {
                const cursorStart = np.before(np.depth);
                let blankPos = -1;
                if (atStartTp) {
                  if (cursorStart > 0) {
                    const prev = s2.doc.resolve(cursorStart - 1);
                    if (prev.depth > 0) blankPos = prev.before(prev.depth);
                  }
                } else {
                  const n = s2.doc.nodeAt(cursorStart);
                  if (n && n.textContent.trim() === '') blankPos = cursorStart;
                }
                if (blankPos >= 0) {
                  const bn = s2.doc.nodeAt(blankPos);
                  if (bn && bn.type.name === 'titlePage' && bn.attrs.field !== 'blank') {
                    editor.view.dispatch(s2.tr.setNodeMarkup(blankPos, undefined, { ...bn.attrs, field: 'blank' }));
                  }
                }
              }
              return true;
            }

            // Inside dualDialogue on an empty line: exit the container
            if (isEmpty) {
              for (let d = $from.depth; d >= 0; d--) {
                if ($from.node(d).type.name === 'dualDialogue') {
                  // Delete the empty node, then insert action after dual dialogue
                  const emptyFrom = $from.before($from.depth);
                  const emptyTo = $from.after($from.depth);
                  const afterDual = $from.after(d);
                  editor.chain()
                    .deleteRange({ from: emptyFrom, to: emptyTo })
                    .insertContentAt(afterDual - (emptyTo - emptyFrom), { type: 'action' })
                    .focus(afterDual - (emptyTo - emptyFrom) + 1)
                    .run();
                  return true;
                }
              }
              // Normal blank line: show element picker.
              // v4.58, Derek: the picker is grammar-filtered by the element
              // ABOVE this line. Working-note lines (sections, markers,
              // to-dos) don't count — they take no space in the final
              // document — so walk back past them to the real script element.
              let prevScriptType: string | null = null;
              {
                let pos = $from.before($from.depth);
                for (;;) {
                  const n = editor.state.doc.resolve(pos).nodeBefore;
                  if (!n) break;
                  if (n.type.name === 'general' && isWorkingNoteText(n.textContent)) {
                    pos -= n.nodeSize;
                    continue;
                  }
                  prevScriptType = n.type.name;
                  break;
                }
              }
              // v4.56, Derek: an empty dialogue right under a character name
              // leads with Parenthetical — the natural next insertion in the
              // couplet, since the dialogue itself is already the caret's home.
              const suggest: ElementType | undefined =
                currentType === 'dialogue' && prevScriptType === 'character'
                  ? 'parenthetical'
                  : undefined;
              showPickerRef.current(currentType as ElementType, undefined, suggest, prevScriptType);
              return true;
            }

            // v4.54, Derek: Enter in a parenthetical never splits the row —
            // the parens stay the first and last characters and the caret
            // drops into a fresh line below (the template's nextOnEnter,
            // dialogue by default), wherever it sat in the row.
            if (currentType === 'parenthetical') {
              const tplStore = useFormattingTemplateStore.getState();
              const tpl = tplStore.getActiveTemplate();
              const next = tpl.rules['parenthetical']?.nextOnEnter
                || DEFAULT_NEXT_TYPE['parenthetical'] || 'dialogue';
              const after = $from.after($from.depth);
              const chain = editor.chain();
              if (editor.schema.nodes[next]) {
                chain.insertContentAt(after, { type: next });
              } else {
                const nextRule = tpl.rules[next];
                if (!nextRule) return false;
                chain.insertContentAt(after, {
                  type: 'customElement',
                  attrs: { customTypeId: next, customLabel: nextRule.label },
                });
              }
              chain.focus(after + 1).run();
              return true;
            }

            // v4.57, Derek: Enter at the END of a written dialogue line skips
            // a line — the fresh element is an action ("Action..." hint),
            // whose space-before is the blank line. v4.65: the picker does
            // NOT auto-open here — a second Enter on the now-empty line
            // brings it up, like everywhere else. Mid-line and start-of-line
            // Enter keep the generic behavior; dual-dialogue columns theirs.
            if (currentType === 'dialogue' && $from.parentOffset === currentNode.content.size) {
              let inDual = false;
              for (let d = $from.depth; d >= 0; d--) {
                if ($from.node(d).type.name === 'dualDialogue') { inDual = true; break; }
              }
              if (!inDual) {
                editor.chain().splitBlock().setNode('action').run();
                return true;
              }
            }

            // Check if cursor is at the very beginning of the block
            const atBlockStart = $from.parentOffset === 0;

            // Non-empty line: split block, then fix up both halves' types
            // Use template rules if available, fall back to DEFAULT_NEXT_TYPE
            const templateStore = useFormattingTemplateStore.getState();
            const activeTemplate = templateStore.getActiveTemplate();
            // For custom elements, use customTypeId to find the rule
            const effectiveType = currentType === 'customElement'
              ? (currentNode.attrs?.customTypeId || currentType)
              : currentType;
            const elementRule = activeTemplate.rules[effectiveType];
            const nextType = elementRule?.nextOnEnter || DEFAULT_NEXT_TYPE[currentType] || currentType;
            /* v7.08, Derek ("if I try to add anything above a scene header, the
               scene header below the added text loses its element type and bold
               formatting"): the fix-up rides the SAME transaction as the split
               now. It used to be a second `view.dispatch` after the chain, which
               made one Enter two undo steps and — the part Derek hit — left the
               caret sitting in the SCENE HEADING after inserting a blank line
               above it. Everything he did next (typing, or picking Action from
               the element dropdown) landed on the heading instead of the new
               line, which is how a heading ends up an un-bolded action. */
            editor.chain().splitBlock().command(({ tr, dispatch }) => {
              if (!dispatch) return true;
              const schema = editor.schema;
              // After the split the caret is in the new (second) block.
              const pos = tr.selection.$from;
              const newBlockStart = pos.before(pos.depth);

              if (atBlockStart) {
              // Cursor was at position 0: user is inserting a blank line above.
              // The second block (with content) should keep the original type.
              // The first block (empty, above) becomes action for a clean blank line.
              const origNodeType = schema.nodes[currentType];
              if (origNodeType && tr.doc.nodeAt(newBlockStart)?.type.name !== currentType) {
                tr.setNodeMarkup(newBlockStart, origNodeType);
              }
              const prevResolved = tr.doc.resolve(newBlockStart - 1);
              const prevBlockStart = prevResolved.before(prevResolved.depth);
              const actionType = schema.nodes['action'];
              if (actionType && tr.doc.nodeAt(prevBlockStart)?.type.name !== 'action') {
                tr.setNodeMarkup(prevBlockStart, actionType);
              }
              // The caret belongs on the line the writer just made, not on the
              // element they pushed down. setNodeMarkup keeps positions, so
              // prevBlockStart + 1 is inside the new empty block.
              tr.setSelection(TextSelection.create(tr.doc, prevBlockStart + 1));
            } else {
              // Cursor was in the middle/end: apply normal type transition.
              // Fix the new block's type, and ensure the first block kept original type.
              const isNextBuiltIn = !!schema.nodes[nextType];
              if (isNextBuiltIn) {
                const newNodeType = schema.nodes[nextType];
                if (newNodeType && tr.doc.nodeAt(newBlockStart)?.type.name !== nextType) {
                  tr.setNodeMarkup(newBlockStart, newNodeType);
                }
              } else {
                // Custom element transition
                const customNodeType = schema.nodes['customElement'];
                const nextRule = activeTemplate.rules[nextType];
                if (customNodeType && nextRule) {
                  tr.setNodeMarkup(newBlockStart, customNodeType, {
                    customTypeId: nextType,
                    customLabel: nextRule.label,
                  });
                }
              }
              const prevResolved = tr.doc.resolve(newBlockStart - 1);
              const prevBlockStart = prevResolved.before(prevResolved.depth);
              const origNodeType = schema.nodes[currentType] || schema.nodes['customElement'];
              if (origNodeType && tr.doc.nodeAt(prevBlockStart)?.type.name !== currentType) {
                if (schema.nodes[currentType]) {
                  tr.setNodeMarkup(prevBlockStart, schema.nodes[currentType]);
                }
                // For customElement, the type is already correct from splitBlock
              }
            }
              return true;
            }).run();
            return true;
          },
        };
      },
    })
  );

  // Element shortcuts: Mod-1 through Mod-8 to set element type
  const [ElementShortcutExtension] = React.useState(() =>
    Extension.create({
      name: 'elementShortcuts',
      priority: 999,
      addKeyboardShortcuts() {
        const types = ['sceneHeading', 'action', 'character', 'dialogue', 'parenthetical', 'transition', 'general', 'shot'];
        const shortcuts: Record<string, any> = {};
        types.forEach((type, i) => {
          shortcuts[`Mod-${i + 1}`] = ({ editor }: { editor: any }) => {
            if (!editor.schema.nodes[type]) return false;
            editor.chain().focus().setNode(type).run();
            return true;
          };
        });
        return shortcuts;
      },
    })
  );

  // Centralized Tab handler — reads nextOnTab from active template
  const [TabHandlerExtension] = React.useState(() =>
    Extension.create({
      name: 'tabHandler',
      priority: 1000,
      addKeyboardShortcuts() {
        return {
          Tab: ({ editor }) => {
            const { $from } = editor.state.selection;
            const currentNode = $from.parent;
            const currentType = currentNode.type.name;

            // v4.57, Derek: Tab on an empty far-left line (a fresh action /
            // general row) starts a dialogue at the character-name prompt
            // ("Dialogue (Name)"), moving the caret over to the indent.
            if (
              (currentType === 'action' || currentType === 'general')
              && currentNode.textContent.trim() === ''
            ) {
              editor.chain().setNode('character').run();
              return true;
            }

            // For custom elements, look up by customTypeId
            const effectiveType = currentType === 'customElement'
              ? (currentNode.attrs?.customTypeId || currentType)
              : currentType;

            const templateStore = useFormattingTemplateStore.getState();
            const activeTemplate = templateStore.getActiveTemplate();
            const rule = activeTemplate.rules[effectiveType];

            if (!rule?.nextOnTab) return false;

            const nextId = rule.nextOnTab;
            // Check if next type is a built-in or custom element
            const isBuiltIn = ALL_ELEMENT_TYPES.includes(nextId as ElementType);

            // v4.54: a parenthetical never splits — the parens stay the first
            // and last characters of the row; Tab, like Enter, drops into a
            // fresh next element below.
            if (currentType === 'parenthetical') {
              const after = $from.after($from.depth);
              if (isBuiltIn) {
                return editor.chain().insertContentAt(after, { type: nextId }).focus(after + 1).run();
              }
              const nextRule = activeTemplate.rules[nextId];
              if (!nextRule) return false;
              return editor.chain().insertContentAt(after, {
                type: 'customElement',
                attrs: { customTypeId: nextId, customLabel: nextRule.label },
              }).focus(after + 1).run();
            }

            // v4.65, Derek: an EMPTY line converts IN PLACE — splitting it
            // left the empty source row behind (Tab in a blank dialogue put
            // a blank line between the name and its new parenthetical).
            const inPlace = currentNode.textContent.trim() === '';
            if (isBuiltIn) {
              const chain = editor.chain();
              if (!inPlace) chain.splitBlock();
              return chain.setNode(nextId).run();
            } else {
              // Custom element
              const nextRule = activeTemplate.rules[nextId];
              if (nextRule) {
                const chain = editor.chain();
                if (!inPlace) chain.splitBlock();
                return chain.setNode('customElement', {
                  customTypeId: nextId,
                  customLabel: nextRule.label,
                }).run();
              }
            }
            return false;
          },
        };
      },
    })
  );

  const editor = useEditor({
    extensions: [
      Document.extend({
        content: 'block+',
      }),
      Text, Bold, Italic, Underline, Strike, Dropcursor, Gapcursor,
      Subscript, Superscript,
      Highlight.configure({ multicolor: true }),
      TextStyle, Color, FontFamily, FontSize,
      /* Action is registered FIRST among the block nodes ON PURPOSE (v6.18,
         Derek: pasting with an action active put the text "below" it with
         wrong spacing). Schema order decides where ProseMirror puts content
         with no matching parse rule — external-clipboard paragraphs, plain
         text lines, dropped snippet text. That fallback used to be
         CustomElement (registered here), which minted ATTRLESS custom
         elements: no customTypeId, no template rule, wrong margins. The
         fallback block of a screenplay is action. Keep Action ahead of
         CustomElement (and of every other textblock) or the bug returns —
         check-v618 pins it. */
      Action,
      FormatOverride, CustomElement, ScreenplayImage,
      History.configure({ newGroupDelay: 150 }),
      TextAlign.configure({ types: [...ALL_ELEMENT_TYPES, 'customElement'] }),
      Placeholder.configure({
        placeholder: ({ node }) => {
          // Check template rules first for custom placeholders
          const tplStore = useFormattingTemplateStore.getState();
          const tpl = tplStore.getActiveTemplate();
          // For custom elements, use customTypeId attribute
          /* v6.20: template-provided hints route through ht() too — the
             Helper Text row must never silently lose to the template path
             (the active template's strings mirror the defaults unless the
             user edited them, and user-edited ones are already theirs). */
          if (node.type.name === 'customElement') {
            const customTypeId = node.attrs?.customTypeId;
            if (customTypeId && tpl.rules[customTypeId]) {
              return ht(tpl.rules[customTypeId].placeholder || '');
            }
            return '';
          }
          // For built-in elements, check template rule
          if (tpl.rules[node.type.name]?.placeholder) {
            return ht(tpl.rules[node.type.name].placeholder);
          }
          /* Fallback defaults. v6.20: each hint reads through ht() so the
             Design window's Helper Text section can override it — the map
             is rebuilt per call and the decoration repaints on every doc/
             selection change, so an edit shows the next time it paints. */
          const m: Record<string, string> = {
            sceneHeading: ht('INT./EXT. LOCATION - TIME'), action: ht('Action...'),
            character: ht('CHARACTER NAME'), dialogue: ht('Dialogue...'),
            parenthetical: ht('(direction)'), transition: ht('CUT TO:'),
            general: ht('Text...'), shot: ht('SHOT DESCRIPTION'),
            newAct: ht('ACT ONE'), endOfAct: ht('END OF ACT'),
            lyrics: ht('Lyrics...'), showEpisode: ht('SHOW TITLE'), castList: ht('Cast...'),
          };
          return m[node.type.name] || '';
        },
        // includeChildren: nested nodes (the character/dialogue inside a dual
        // dialogue column) are counted as empty too, so they get a hint at all.
        //
        // v1.2 — showOnlyCurrent is back to TRUE. Setting it false in v0.81 (to
        // light up both dual-dialogue columns at once) meant EVERY empty element
        // in the whole script showed its hint, so an action you'd left blank and
        // walked away from kept saying "Describe the action..." forever, stacked
        // three deep. Only the element with the caret prompts now; the rest are
        // just empty lines, which is what they are.
        includeChildren: true,
        showOnlyCurrent: true,
      }),
      SceneHeading, Character, Dialogue, Parenthetical,
      Transition, General, Shot, NewAct, EndOfAct, Lyrics,
      ShowEpisode, CastList, DualDialogue, DualDialogueColumn, TitlePage, CustomPage, CustomPageKeymap,
      AvBlock, AvRow, AvCell, AvPara, AvShot, AvDirection, AvKeymap,
      ScriptNoteMark, ScriptMarkupMark, MarkupBlockAnchor, TagMark,
      PaginationExtension,
      ContdCaseExtension,
      SearchExtension,
      TrackChangesExtension,
      ...(isHistoryMode ? [] : [EnforceGuardExtension, EnterHandlerExtension, TabHandlerExtension, ElementShortcutExtension]),
      SmartTypography,
      VomitLock,
      TypewriterScroll,
      SpellCheck,
      Grammar,
      ...pluginRegistry.getEditorExtensions(),
    ],
    // For editing from URL, content is loaded later via useEffect.
    content: (urlScriptId || urlCommitHash) ? undefined : { type: 'doc', content: [{ type: 'action', content: [] }] },
    // v1.54: the caret is visible from the first frame, sitting in the
    // starting action element — like any word processor.
    autofocus: (urlScriptId || urlCommitHash) ? false : 'start',
    editable: !isHistoryMode,
    // v7.88 (security review D8): if content passed to the editor doesn't fit
    // the screenplay schema — a corrupt or foreign file whose JSON parsed but
    // whose nodes don't — TipTap otherwise drops the bad parts SILENTLY and can
    // leave the page blank with no word to the writer. enableContentCheck turns
    // that into onContentError; we tell the writer and keep whatever DID load,
    // instead of a silent empty document.
    enableContentCheck: true,
    onContentError: ({ error }) => {
      console.error('[content-check] invalid content on load:', error);
      showToast('This file could not be fully read — some of its content may be missing.', 'error');
    },
    editorProps: {
      attributes: { class: `screenplay-content${isHistoryMode ? ' history-readonly' : ''}`, spellcheck: 'false' },
    },
    onSelectionUpdate: ({ editor: ed }) => {
      // Check custom element first
      if (ed.isActive('customElement')) {
        // Use customTypeId as the active element label
        const attrs = ed.getAttributes('customElement');
        if (attrs?.customTypeId) {
          setActiveElement(attrs.customTypeId as ElementType);
          return;
        }
      }
      for (const type of ALL_ELEMENT_TYPES) {
        if (ed.isActive(type)) { setActiveElement(type); break; }
      }
    },
  }, []);

  /* DEV ONLY (speed audit, 2026-07-28): hand the drivers the editor instance
     so they can INJECT a fixture script (editor.commands.setContent) instead
     of typing it keystroke by keystroke — ~40s of every Playwright check was
     synthetic typing. v5.21: the STORE rides along for the same reason —
     drivers set up state (open tools, modes) deterministically instead of
     clicking through chrome. import.meta.env.DEV is false in `npm run
     build`, so nothing ships. See frontend/devtools/. */
  useEffect(() => {
    if (import.meta.env.DEV) {
      (window as unknown as Record<string, unknown>).__scEditor = editor;
      (window as unknown as Record<string, unknown>).__scStore = useEditorStore;
      // v6.69: the PROJECT store too — Snapshots/Script History read from it,
      // and a check can't reproduce "a script is open" without it.
      (window as unknown as Record<string, unknown>).__scProjectStore = useProjectStore;
      // v7.48: and the NOTEBOOK store. Several ribbon controls change identity
      // while the Scrapbook is open — the font, size and text-colour pickers
      // each become a different control against a different document — so a
      // check that cannot open the Scrapbook cannot reach half of them.
      (window as unknown as Record<string, unknown>).__scNotebookStore = useNotebookStore;
    }
  }, [editor]);

  /* v6.65, Derek: an ANNOTATION sent from the outline MIRRORS its section —
     "if section info changes, such as the name or the estimated page amount,
     the change should be indicated in the annotation as well". It lives here
     rather than on the Outline Bar because the bar is often closed while the
     writer renames a section on the board, and a mirror that only runs when
     a particular panel happens to be mounted is exactly the silent no-op
     this repo keeps re-learning. The signature keeps a column-resize drag
     (width changes, same names) from rewriting anything. */
  const beatColumnsForMirror = useEditorStore((s) => s.beatColumns);
  const outlineStashForMirror = useEditorStore((s) => s.outlineStash);
  const outlineSectionSig = useMemo(
    () => outlineSectionSignature(collectOutlineSections(beatColumnsForMirror, outlineStashForMirror)),
    [beatColumnsForMirror, outlineStashForMirror],
  );
  useEffect(() => {
    const st = useEditorStore.getState();
    syncSectionAnnotations(collectOutlineSections(st.beatColumns, st.outlineStash));
  }, [outlineSectionSig]);

  /* v5.04: the ONE place a "go to this scene" request is carried out. A panel
     asks via requestEditorScroll(pos); this runs when the editor AND its
     scroll container both exist, which is what makes it work from a fullscreen
     tool — lowering the takeover unmounts the panel, so the panel cannot
     finish the job itself. */
  const pendingEditorScroll = useEditorStore((s) => s.pendingEditorScroll);
  const clearEditorScroll = useEditorStore((s) => s.clearEditorScroll);
  useEffect(() => {
    if (pendingEditorScroll == null || !editor || !editorMainEl) return;
    const raf = requestAnimationFrame(() => {
      try {
        editor.chain().focus().setTextSelection(pendingEditorScroll).run();
        const coords = editor.view.coordsAtPos(pendingEditorScroll);
        const rect = editorMainEl.getBoundingClientRect();
        editorMainEl.scrollTo({ top: editorMainEl.scrollTop + (coords.top - rect.top) - 60, behavior: 'auto' });
      } catch {
        // The view can be mid-remount; a failed measure must not wedge the
        // request and swallow the next click.
      }
      clearEditorScroll();
    });
    return () => cancelAnimationFrame(raf);
  }, [pendingEditorScroll, editor, editorMainEl, clearEditorScroll]);

  // Route native undo/redo (e.g. iOS shake-to-undo) to the editor
  useEffect(() => {
    if (!editor) return;
    const handleBeforeInput = (e: Event) => {
      const ie = e as InputEvent;
      if (ie.inputType === 'historyUndo') {
        e.preventDefault();
        try { editor.chain().undo().run(); } catch {}
      } else if (ie.inputType === 'historyRedo') {
        e.preventDefault();
        try { editor.chain().redo().run(); } catch {}
      }
    };
    document.addEventListener('beforeinput', handleBeforeInput);
    return () => document.removeEventListener('beforeinput', handleBeforeInput);
  }, [editor]);

  // ── Dynamic CSS injection for custom formatting templates ──
  const activeTemplateId = useFormattingTemplateStore((s) => s.activeTemplateId);
  const templatesLoaded = useFormattingTemplateStore((s) => s.loaded);
  const templates = useFormattingTemplateStore((s) => s.templates);

  useEffect(() => {
    // Load templates on mount
    useFormattingTemplateStore.getState().loadTemplates();
  }, []);

  useEffect(() => {
    const template = useFormattingTemplateStore.getState().getActiveTemplate();
    // If the resolved template is industry standard, use static CSS
    if (template.id === '__industry_standard__') {
      injectTemplateCss(null);
      return;
    }
    const css = generateTemplateCss(template, pageLayout);
    injectTemplateCss(css);

    return () => { injectTemplateCss(null); };
  }, [activeTemplateId, templatesLoaded, templates, pageLayout]);

  // --- Image insertion: upload to the project's assets, then insert a node that
  // references the asset (keeps the document small). Falls back to an inline data
  // URL only when there is no project to upload to. ---
  const imageFileInputRef = useRef<HTMLInputElement>(null);
  // The cursor position captured when the menu/toolbar triggers image insertion,
  // so the upload's async gap (file dialog) doesn't lose the insertion point.
  const imageInsertPosRef = useRef<number | null>(null);
  // v4.8: mirror the Design panel's token overrides onto :root whenever they
  // change (and once on mount, so persisted overrides apply at boot).
  const designVars = useEditorStore((s) => s.designVars);
  useEffect(() => { applyDesignVars(designVars); }, [designVars]);

  const setImageInsertHandler = useEditorStore((s) => s.setImageInsertHandler);
  useEffect(() => {
    setImageInsertHandler(() => {
      imageInsertPosRef.current = editor ? editor.state.selection.to : null;
      imageFileInputRef.current?.click();
    });
    return () => setImageInsertHandler(null);
  }, [setImageInsertHandler, editor]);

  const handleImageFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-selecting the same file
    if (!file || !editor) return;
    if (!file.type.startsWith('image/')) { showToast('Please choose an image file', 'error'); return; }
    // Insert at the captured cursor position (valid block position), not doc start.
    const pos = imageInsertPosRef.current ?? editor.state.selection.to;
    const insertAt = (attrs: Record<string, unknown>) => insertImageNode(editor, attrs, pos);
    try {
      if (currentProject) {
        const asset = await api.uploadAsset(currentProject.id, file, ['inline-image']);
        insertAt({ assetId: asset.id, projectId: currentProject.id, filename: asset.filename ?? file.name, align: 'center' });
      } else {
        // No project yet (unsaved local doc) — embed as a data URL.
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const r = new FileReader();
          r.onload = () => resolve(r.result as string);
          r.onerror = () => reject(r.error);
          r.readAsDataURL(file);
        });
        insertAt({ src: dataUrl, align: 'center' });
      }
    } catch (err) {
      showToast(`Failed to insert image: ${err instanceof Error ? err.message : String(err)}`, 'error');
    }
  }, [editor, currentProject]);

  // Helper: clear track changes when switching documents
  const clearTrackChanges = useCallback(() => {
    const store = useEditorStore.getState();
    if (!store.trackChangesEnabled) return;
    store.setTrackChangesEnabled(false);
    store.setTrackChangesLabel('');
    if (editor) {
      const { tr } = editor.state;
      tr.setMeta(trackChangesPluginKey, { enabled: false, baseline: null });
      editor.view.dispatch(tr);
    }
  }, [editor]);

  // --- Scene navigator + scene number assignment ---
  const updateScenes = useCallback(() => {
    if (!editor) return;
    const list: { id: string; heading: string; sceneNumber: number | null; color: string; synopsis: string }[] = [];
    const locked = useEditorStore.getState().sceneNumbersLocked;
    const visible = useEditorStore.getState().sceneNumbersVisible;
    let idx = 0;
    // Collect scene positions for attribute updates
    const attrUpdates: { pos: number; number: string }[] = [];
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === 'sceneHeading') {
        idx++;
        let num: string;
        if (locked && node.attrs.sceneNumber != null) {
          // Keep the locked number
          num = String(node.attrs.sceneNumber);
        } else {
          num = String(idx);
        }
        const sceneId = `scene-${idx}`;
        list.push({ id: sceneId, heading: node.textContent || 'Untitled Scene', sceneNumber: parseInt(num, 10), color: node.attrs.sceneColor || '', synopsis: node.attrs.synopsis || '' });
        // Update node attrs if scene numbers are visible and the number changed
        if (visible && String(node.attrs.sceneNumber) !== num) {
          attrUpdates.push({ pos, number: num });
        }
        // Clear scene number attr if not visible and it was set
        if (!visible && node.attrs.sceneNumber != null) {
          attrUpdates.push({ pos, number: '' });
        }
      }
      return true;
    });
    // Batch attribute updates in a single transaction
    if (attrUpdates.length > 0) {
      const { tr } = editor.state;
      for (const { pos, number } of attrUpdates) {
        tr.setNodeMarkup(pos, undefined, {
          ...editor.state.doc.nodeAt(pos)?.attrs,
          sceneNumber: number || null,
        });
      }
      tr.setMeta('addToHistory', false);
      editor.view.dispatch(tr);
    }
    setScenes(list);
  }, [editor, setScenes]);

  /* v4.82, Derek: "the lists should only continually refresh if the tool in
     question is open. it also should refresh when opened initially. it does
     not need to constantly refresh if the tool is closed."

     Both rescans walk the WHOLE document on every keystroke-ish event, which
     is the app's biggest idle cost in a long script. They now run only while
     something needs them; otherwise the doc change just sets a dirty flag and
     the scan happens the moment a consumer opens.

     The scene scan is NOT purely a list feeder — it stamps scene numbers into
     the document, and those print. So visible scene numbers keep it live
     regardless of which tools are open. */
  const openToolKey = useEditorStore(
    (s) => `${s.activeTool}|${s.activeToolRight}|${s.tempTool}|${s.fullscreenTool}`,
  );
  // Tools that render from store.scenes. Pages / Locations / Structure are all
  // SceneNavigator views under their own ids — see the v4.92 note below.
  const SCENES_READERS = ['scenes', 'navigator', 'characters', 'pages', 'locations', 'structure'];
  const toolIsOpen = useCallback(
    (id: string) => openToolKey.split('|').includes(id),
    [openToolKey],
  );
  // Who reads store.scenes / store.characters.
  //
  // v4.92 FIX: this list was missing Pages, Locations and Structure. All three
  // are SceneNavigator views — they render from store.scenes like Scenes does,
  // but they open under their own tool ids, so opening one on its own left the
  // scan gated off and the tool sat on a stale (usually empty) list saying
  // "No locations yet" forever. It only ever looked right because Scenes or
  // Navigator happened to be open too. The list is a named constant now, so
  // adding a scenes-reading tool means adding it in ONE place.
  const scenesNeeded = sceneNumbersVisible || SCENES_READERS.some(toolIsOpen);
  const charsNeeded = toolIsOpen('navigator') || toolIsOpen('characters');
  const scenesDirty = useRef(true);

  useEffect(() => {
    if (!editor) return;
    const onUpdate = () => {
      scenesDirty.current = true;
      if (scenesNeeded) { scenesDirty.current = false; updateScenes(); }
    };
    // Opening a consumer (or turning scene numbers on) catches up immediately.
    if (scenesNeeded && scenesDirty.current) { scenesDirty.current = false; updateScenes(); }
    editor.on('update', onUpdate);
    return () => { editor.off('update', onUpdate); };
  }, [editor, updateScenes, scenesNeeded]);

  // Re-run when scene numbering visibility or lock state changes — these
  // rewrite the numbers in the document, so they never wait on a tool.
  useEffect(() => {
    if (editor) { scenesDirty.current = false; updateScenes(); }
  }, [editor, sceneNumbersVisible, sceneNumbersLocked, updateScenes]);

  // Per-document "Mores & Continueds" config. Reactive: editing it re-runs the
  // CONT'D effect and re-renders the page-break markers.
  const moresContds = resolveMoresContds(pageLayout);
  const { characterContd, contdText } = moresContds;

  /* v7.38: the cast reader moved to hooks/useCastCollection — see there for
     the ghost-entry bug that shaped it. It stays a hook rather than a util
     because it owns dirty-flag state and two editor listeners. */
  const { stripCharacterExtension, collectCast } = useCastCollection(editor, charsNeeded);

  /* v2.36: stamp real document edits so smart undo can tell whether the
     freshest change was in the script or on the outline. It rode inside the
     cast effect for no reason but proximity — it has nothing to do with the
     cast, so it did not follow it into useCastCollection. */
  useEffect(() => {
    if (!editor) return;
    const stampDocEdit = ({ transaction }: { transaction: { docChanged: boolean } }) => {
      if (transaction.docChanged) useEditorStore.getState().noteDocEdit();
    };
    editor.on('update', stampDocEdit);
    return () => { editor.off('update', stampDocEdit); };
  }, [editor]);


  // v3.08/v3.25: the selection after every docChanged transaction becomes
  // the script's "last edit" spot (Edit > Last Edit Location).
  useEffect(() => {
    if (!editor) return;
    const onTx = ({ transaction }: { transaction: { docChanged: boolean; selection: { from: number } } }) => {
      if (!transaction.docChanged) return;
      const scriptId = bookmarkScriptKey(useProjectStore.getState().currentScriptId);
      useBookmarkStore.getState().setLastEdit(scriptId, transaction.selection.from);
    };
    editor.on('transaction', onTx);
    return () => { editor.off('transaction', onTx); };
  }, [editor]);

  // --- Auto CONT'D (hooks/useAutoContd) ---
  useAutoContd(editor, { characterContd, contdText, stripCharacterExtension });

  // --- Element autofill: character names, scene INT./EXT., transitions ---
  // v3.44, Derek: the dropdown appears the moment you're in an EMPTY element
  // (all options), then filters as you type. Scene headings and transitions
  // join characters as autofill sources.
  useEffect(() => {
    if (!editor) return;
    const onUpdate = () => {
      // Autofill is an active-typing affordance — never show it unless the
      // editor actually has focus. Without this it popped up at (0,0) on every
      // launch: a selectionUpdate fires while the doc loads (often with the
      // caret in a transition), and coordsAtPos returns the top-left corner
      // because the editor isn't focused/laid out yet (e.g. the Scrapbook is
      // covering the editor area).
      if (!editor.isFocused) {
        setCharAutoState(s => s.visible ? { ...s, visible: false } : s);
        charAutoDismissedRef.current = false;
        return;
      }
      const mode: 'character' | 'scene' | 'transition' | null =
        editor.isActive('character') ? 'character'
          : editor.isActive('sceneHeading') ? 'scene'
            : editor.isActive('transition') ? 'transition'
              : null;
      if (!mode) {
        setCharAutoState(s => s.visible ? { ...s, visible: false } : s);
        charAutoDismissedRef.current = false;
        return;
      }
      if (charAutoDismissedRef.current) return;

      const { $from } = editor.state.selection;
      const rawText = $from.parent.textContent.trim().toUpperCase();

      // The option pool + the text to filter it by. Empty element ⇒ show all;
      // otherwise options that start with the typed text (no exact match).
      let pool: string[];
      let text: string;
      if (mode === 'character') {
        /* v7.08: read the CAST OUT OF THE DOCUMENT, here, now — not out of a
           cache that goes stale the moment a cue is deleted — and leave out
           the cue being typed so a half-written name can't suggest itself. */
        pool = collectCast($from.before($from.depth));
        text = stripCharacterExtension(rawText);
      } else if (mode === 'transition') {
        // v4.22: the customizable list (Customize ▸ Script Editor ▸ Transitions).
        pool = useFormattingTemplateStore.getState().getEffectiveTransitions();
        text = rawText;
      } else {
        // scene: INT./EXT. first, then — once a prefix is chosen — every
        // location the Location tool knows (derived from the script's headings,
        // upper-cased so it matches whatever case is stored).
        const afterPrefix = rawText.match(/^(?:INT\.|EXT\.|INT\.\/EXT\.|EST\.)\s+(.*)$/);
        if (afterPrefix) {
          const locs = new Set<string>();
          editor.state.doc.descendants((n) => {
            if (n.type.name === 'sceneHeading') {
              const loc = parseLocationFromHeading(n.textContent);
              if (loc) locs.add(loc);
            }
            return true;
          });
          pool = Array.from(locs).sort();
          text = afterPrefix[1].trim();
        } else {
          pool = SCENE_PREFIX_OPTIONS;
          text = rawText;
        }
      }
      const matches = text
        ? pool.filter(n => n.startsWith(text) && n !== text)
        : pool.slice();

      if (matches.length === 0) {
        setCharAutoState(s => s.visible ? { ...s, visible: false } : s);
        return;
      }

      const { from } = editor.state.selection;
      const coords = editor.view.coordsAtPos(from);
      setCharAutoState({
        visible: true,
        mode,
        position: { top: coords.bottom + 4, left: coords.left },
        suggestions: matches,
      });
    };
    const onBlur = () => setCharAutoState(s => (s.visible ? { ...s, visible: false } : s));
    editor.on('update', onUpdate);
    editor.on('selectionUpdate', onUpdate);
    editor.on('blur', onBlur);
    return () => { editor.off('update', onUpdate); editor.off('selectionUpdate', onUpdate); editor.off('blur', onBlur); };
  }, [editor, collectCast, stripCharacterExtension]);

  // Re-measure overlays after editor updates (decorations settle)
  useEffect(() => {
    if (!editor) return;
    const run = () => requestAnimationFrame(() => requestAnimationFrame(measureOverlays));
    editor.on('update', run);
    // Initial measurement passes
    const timers = [200, 500, 1000].map(ms => setTimeout(run, ms));
    return () => { editor.off('update', run); timers.forEach(clearTimeout); };
  }, [editor, measureOverlays]);

  // Re-paginate when page layout changes (e.g., after FDX import)
  useEffect(() => {
    if (!editor) return;
    const t = setTimeout(() => {
      const { tr } = editor.state;
      tr.setMeta('forceRepaginate', true);
      editor.view.dispatch(tr);
    }, 300);
    return () => clearTimeout(t);
  }, [editor, pageLayout]);

  // --- Initialize spell checker on mount ---
  useEffect(() => {
    spellChecker.init().catch(() => {});
  }, []);

  // --- Toggle spell check plugin when store changes ---
  useEffect(() => {
    if (!editor) return;
    const { tr } = editor.state;
    tr.setMeta(spellCheckPluginKey, { toggle: spellCheckEnabled });
    editor.view.dispatch(tr);
  }, [editor, spellCheckEnabled]);

  // --- Spell modal needs decorations to highlight the active word.
  //     If auto-check is off, enable the plugin while the modal is open and
  //     restore the store's setting on close. ---
  useEffect(() => {
    if (!editor) return;
    if (!spellModalOpen) return;
    if (spellCheckEnabled) return; // plugin already on via the toggle effect above
    const tr1 = editor.state.tr.setMeta(spellCheckPluginKey, { toggle: true });
    editor.view.dispatch(tr1);
    return () => {
      if (editor.isDestroyed) return;
      // Re-read the latest setting; if user turned auto-check on while the modal was open, leave it on.
      const stillOff = !useEditorStore.getState().spellCheckEnabled;
      if (stillOff) {
        const tr2 = editor.state.tr.setMeta(spellCheckPluginKey, { toggle: false });
        editor.view.dispatch(tr2);
      }
    };
  }, [editor, spellModalOpen, spellCheckEnabled]);

  // --- Register the local rule-based grammar providers exactly once. ---
  // retext: style/wordiness checks (passive voice, weak intensifiers, etc.)
  // harper: actual grammar (subject-verb agreement, tense, articles, ...)
  useEffect(() => {
    pluginRegistry.registerGrammarProvider('opendraft-retext', async (text, baseOffset, signal) => {
      const enabledSet = new Set<RetextCategory>();
      const rulesEnabled = useEditorStore.getState().grammarRulesEnabled || {};
      for (const cat of RETEXT_CATEGORIES) {
        if (rulesEnabled[cat] !== false) enabledSet.add(cat);
      }
      return runRetext(text, baseOffset, enabledSet, signal);
    });
    pluginRegistry.registerGrammarProvider('opendraft-harper', (text, baseOffset, signal) => {
      return runHarper(text, baseOffset, signal);
    });
    return () => {
      pluginRegistry.unregisterGrammarProvider('opendraft-retext');
      pluginRegistry.unregisterGrammarProvider('opendraft-harper');
    };
  }, []);

  // --- Toggle grammar plugin when store changes ---
  useEffect(() => {
    if (!editor) return;
    const { tr } = editor.state;
    tr.setMeta(grammarPluginKey, { toggle: grammarCheckEnabled });
    editor.view.dispatch(tr);
  }, [editor, grammarCheckEnabled]);

  // --- If auto-grammar is off but the modal is open, enable it temporarily. ---
  useEffect(() => {
    if (!editor) return;
    if (!grammarModalOpen) return;
    if (grammarCheckEnabled) return;
    const tr1 = editor.state.tr.setMeta(grammarPluginKey, { toggle: true });
    editor.view.dispatch(tr1);
    return () => {
      if (editor.isDestroyed) return;
      const stillOff = !useEditorStore.getState().grammarCheckEnabled;
      if (stillOff) {
        const tr2 = editor.state.tr.setMeta(grammarPluginKey, { toggle: false });
        editor.view.dispatch(tr2);
      }
    };
  }, [editor, grammarModalOpen, grammarCheckEnabled]);

  // Build a saveable content object: editor JSON + store metadata at top level
  const buildSaveContent = useCallback((): Record<string, unknown> | undefined => {
    if (!editor || editor.isDestroyed) return undefined;
    return composeSaveContent(editor.getJSON());
  }, [editor]);

  // --- Auto-save to backend every 30 seconds if a project/script is active ---
  const lastSavedJsonRef = useRef<string>('');
  // Tracks whether the script currently in the editor has real (textful) content
  // saved. When true, an auto-save that finds the editor body suddenly empty is
  // treated as an editor glitch (reset/remount) and skipped — never written.
  const lastSavedNonEmptyRef = useRef<boolean>(false);

  // Register an editor-reset hook so performLogout can flush any pending
  // save for a cloud file and then drop the editor back to a blank, local
  // "Untitled Script". Runs while the access token is still valid so the
  // final PUT is authenticated; without this the auto-save loop keeps firing
  // after signout and every save returns 401.
  useEffect(() => {
    setLogoutEditorReset(async () => {
      scriptSwitchingRef.current = true;
      try {
        if (currentProject && currentScriptId && isCloudScript(currentProject.id, currentScriptId)) {
          const pendingContent = buildSaveContent();
          if (pendingContent) {
            const pendingJson = JSON.stringify(pendingContent);
            if (pendingJson !== lastSavedJsonRef.current) {
              try {
                await scriptApi.saveScript(currentProject.id, currentScriptId, { content: pendingContent });
                lastSavedJsonRef.current = pendingJson;
              } catch (err) {
                // Save can fail if the token already expired — log and keep going.
                console.warn('Final cloud save on signout failed:', err);
              }
            }
          }
        }

        // Reset the editor to a fresh, blank document — mirrors handleNewScreenplay.
        if (editor && !editor.isDestroyed) {
          clearTrackChanges();
          editor.commands.setContent(
            { type: 'doc', content: [{ type: 'sceneHeading', content: [] }] },
            true,
          );
          clearEditorHistory(editor);
        }
        setCurrentProject(null);
        setCurrentScriptId(null);
        const store = useEditorStore.getState();
        store.setDocumentTitle('Untitled Script');
        store.setBeats([]);
        store.setBeatColumns([]);
        store.setBeatArrangeMode('auto');
        store.setNotes([]);
        store.setGeneralNotes([]);
        store.setTags([]);
        store.setTagCategories([...DEFAULT_TAG_CATEGORIES]);
        store.setCharacterProfiles([]);
        store.setCharacterRelationships([]);
        store.setReferredTags({});
        store.setScanResults(null);
        store.setScenes([]);
        store.setPageLayout({ ...DEFAULT_PAGE_LAYOUT });
        lastSavedJsonRef.current = '';
        if (window.location.pathname !== '/') {
          navigate('/', { replace: true });
        }
      } finally {
        scriptSwitchingRef.current = false;
      }
    });
    return () => { setLogoutEditorReset(null); };
  }, [editor, currentProject, currentScriptId, isCloudScript, buildSaveContent, setCurrentProject, setCurrentScriptId, navigate]);
  // Guard: suppress auto-save while switching scripts.  During the switch the
  // store metadata is cleared (0 relationships, 0 profiles, etc.) but the
  // auto-save closure still holds the OLD project/script IDs.  Without this
  // guard the auto-save would overwrite the old script with empty metadata.
  const scriptSwitchingRef = useRef(false);
  useEffect(() => {
    if (!editor || !currentProject || !currentScriptId) return;
    const { setSaveStatus } = useEditorStore.getState();
    const timer = setInterval(() => {
      if (scriptSwitchingRef.current) return;
      const content = buildSaveContent();
      if (!content) return;
      // Data-loss guard: never let an empty/just-reset editor body overwrite a
      // script that has real content saved (the blank-document bug).
      if (!docHasAnyText(content) && lastSavedNonEmptyRef.current) {
        console.warn('Auto-save skipped: editor body is empty but saved content is not (likely editor reset).');
        return;
      }
      const json = JSON.stringify(content);
      if (json !== lastSavedJsonRef.current) {
        lastSavedJsonRef.current = json;
        lastSavedNonEmptyRef.current = docHasAnyText(content);
        setSaveStatus('saving');
        scriptApi.saveScript(currentProject.id, currentScriptId, { content }).then(() => {
          useEditorStore.getState().markSaved('auto', currentScriptId);
        }).catch((err) => {
          console.error('Auto-save failed:', err);
          const msg = err instanceof Error ? err.message : String(err);
          setSaveStatus('error', msg);
          // AuthGate / QuotaExceededDialog already showed a dialog for handled
          // errors (401/402/403); reportSaveError skips them.  All other
          // failures get a blocking modal the user must acknowledge.
          reportSaveError(err, 'auto-save');
        });
      }
    }, 30000);
    return () => clearInterval(timer);
  }, [editor, currentProject, currentScriptId, buildSaveContent]);

  // v1.60: theme follows the OS appearance while the setting is on.
  const followSystemTheme = useSettingsStore((st) => st.followSystemTheme);
  useEffect(() => {
    if (!followSystemTheme || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => useEditorStore.getState().setTheme(mq.matches ? 'dark' : 'light');
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [followSystemTheme]);

  // v1.74: Writing focus — fullscreen, chrome hidden (CSS via the body
  // class), vignette. Esc leaves. Session-only by design.
  const writingFocus = useEditorStore((st) => st.writingFocus);
  useEffect(() => {
    document.body.classList.toggle('fs-writing-focus', writingFocus);
    if (isTauri()) {
      import('@tauri-apps/api/window')
        .then(({ getCurrentWindow }) => getCurrentWindow().setFullscreen(writingFocus))
        .catch(() => { /* window API unavailable — CSS focus still applies */ });
    }
    // v4.22, Derek: entering/leaving Extreme focus hides chrome AND asks the OS
    // to go fullscreen (async, animated), so the editor recenters over several
    // frames. Reposition the highlight bar / recenter at a few delays that cover
    // the whole transition — the misalignment was the bar being measured before
    // the page finished recentering.
    if (editor && !editor.isDestroyed) {
      const ed = editor;
      [0, 60, 250, 550].forEach((d) => setTimeout(() => {
        if (!ed.isDestroyed) { refreshTypewriterChrome(ed); centerCaretLine(ed); }
      }, d));
    }
    if (!writingFocus) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') useEditorStore.getState().setWritingFocus(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [writingFocus, editor]);

  // v1.75: Outline Bar visibility (View > Outline Bar).
  const outlineBarOpen = useEditorStore((st) => st.outlineBarOpen);
  // v6.74: the Snapshots tool's compare pair — owns the editor area while set.
  const scriptCompare = useProjectStore((st) => st.scriptCompare);
  const rulersVisible = useEditorStore((st) => st.rulersVisible);
  // v4.22, Derek: a body flag so a popped-out tool window drops below the ruler
  // when it's on (and shifts back up when off).
  useEffect(() => {
    document.body.classList.toggle('fs-rulers-on', rulersVisible);
    return () => document.body.classList.remove('fs-rulers-on');
  }, [rulersVisible]);
  const notebookOpen = useNotebookStore((st) => st.notebookOpen);
  // v2.35: the Scrapbook's declutter toggle also drops the outline bar —
  // render-time only, outlineBarOpen itself is never rewritten.
  const scrapbookDeclutter = useSettingsStore((st) => st.scrapbookExclusive);
  const outlineBarShown = outlineBarOpen && !(notebookOpen && scrapbookDeclutter);
  // v2.55: the sizing lock hides the resize strips. Subscribed HERE, top
  // level — never inside a short-circuited JSX expression (rules of hooks).
  const uiResizeLocked = useEditorStore((st) => st.uiResizeLocked);

  // v1.77: how faint "Dim unfocused text" goes — the decorations read the var.
  const typewriterDimOpacity = useEditorStore((st) => st.typewriterDimOpacity);
  useEffect(() => {
    document.body.style.setProperty('--fs-dimmed-opacity', String(typewriterDimOpacity));
  }, [typewriterDimOpacity]);

  // --- Preferences: remember the last edited script + reopen it on start ---
  // Recorded whenever a real project script is open (not history/collab views);
  // consumed once per app session when the "/" route loads with the preference on.
  useEffect(() => {
    if (!currentProject || !currentScriptId || isHistoryMode) return;
    try {
      localStorage.setItem('opendraft:lastOpenedScript',
        JSON.stringify({ projectId: currentProject.id, scriptId: currentScriptId }));
    } catch { /* ignore */ }
  }, [currentProject, currentScriptId, isHistoryMode]);

  useEffect(() => {
    // Only from the bare "/" route, only once per session (the guard prevents a
    // redirect loop if the remembered script was deleted and loading it bounces
    // back to "/").
    if (urlProjectId || urlScriptId) return;
    try {
      if (sessionStorage.getItem('opendraft:autoLoadAttempted') === '1') return;
      sessionStorage.setItem('opendraft:autoLoadAttempted', '1');
      // v1.57: a launch with nothing to reopen — first run, reopen-last off,
      // or no remembered doc — starts at the New Script prompt instead of a
      // bare editor (whose doc may lack a seeded action element + hint).
      // v1.60: a fresh session starts with the user's spell-check default;
      // documents that carry their own choice override it on load (v4.77).
      useEditorStore.getState().setSpellCheckEnabled(useSettingsStore.getState().spellCheckByDefault);
      useEditorStore.getState().setSpellCheckChoice(null);
      const askForNewScript = () => useEditorStore.getState().setNewScriptPromptRequest(true);
      if (!useSettingsStore.getState().autoLoadLastScript) { askForNewScript(); return; }
      const raw = localStorage.getItem('opendraft:lastOpenedScript');
      if (!raw) { askForNewScript(); return; }
      const last = JSON.parse(raw) as { projectId?: string; scriptId?: string };
      if (last.projectId && last.scriptId) {
        navigate(`/project/${last.projectId}/edit/${last.scriptId}`, { replace: true });
      } else {
        askForNewScript();
      }
    } catch { /* ignore */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* --- Preferences: AUTO SAVE (a spare copy, not a snapshot) ---
     v6.72, Derek: "remove the first option 'Local version history (always
     on)' — this was adding autosaves to the snapshot window, which we do not
     want." This used to call api.checkin('Auto save') on every tick, which
     is the SAME call File ▸ Take Snapshot makes — so every auto save became
     a snapshot, and pruneVersions then trimmed that shared history by
     position, which could take deliberate snapshots with it. Both are gone.
     An auto save now writes timestamped FILES to the chosen Auto Save
     Locations and touches the version history not at all. Snapshots are
     taken by hand, and nothing deletes them. */
  const autoSnapshotMinutes = useSettingsStore((s) => s.autoSnapshotMinutes);
  useEffect(() => {
    if (!autoSnapshotMinutes || !currentProject || isHistoryMode) return;
    const timer = setInterval(() => {
      if (scriptSwitchingRef.current) return;
      const snapContent = buildSaveContent();
      if (!snapContent) return;
      // mirrorSnapshot no-ops when no location is ticked — the Settings hint
      // says so rather than the app pretending to protect the writer.
      void mirrorSnapshot({
        projectId: currentProject.id,
        projectName: currentProject.name,
        title: useEditorStore.getState().documentTitle || 'Untitled',
        content: snapContent,
        // v7.20: lowercase, one word — it becomes the filename part
        // (EpisodeX_autosave_08-15-26_23-15.odraft).
        message: 'autosave',
      }).catch((err) => {
        // Silent by design — a failed auto save shouldn't interrupt writing.
        console.warn('Auto save failed:', err);
      });
    }, autoSnapshotMinutes * 60 * 1000);
    return () => clearInterval(timer);
  }, [autoSnapshotMinutes, currentProject, isHistoryMode, buildSaveContent]);

  // --- File > Preview: read-only formatted presentation ---
  useEffect(() => {
    if (!editor) return;
    editor.setEditable(!isHistoryMode && !previewMode);
  }, [editor, previewMode, isHistoryMode]);

  // --- View > Editor Style: page view vs continuous view ---
  const viewStyleRef = useRef(viewStyle);
  viewStyleRef.current = previewMode ? 'page' : viewStyle;
  editorRef.current = editor;
  const previewModeRef = useRef(previewMode);
  previewModeRef.current = previewMode;
  useEffect(() => {
    // Preview always paginates like Page View — it exists to show the final
    // printed/exported document, so the continuous style is suspended while
    // it's open and restored on exit.
    setPaginationContinuousMode(viewStyle === 'continuous' && !previewMode);
    if (editor) {
      try { editor.view.dispatch(editor.state.tr.setMeta('forceRepaginate', true)); } catch { /* ignore */ }
    }
  }, [viewStyle, editor, previewMode]);

  // --- Visibility-aware pagination: keep the paginator's line counts in sync
  // with what's actually rendered. Preview mode (and its sidebar options) hide
  // outline lines with display:none and can double-space scene headers; both
  // change real content height, so the paginator must know — and the page-sep
  // overlays must remeasure — every time any of these flip. (Root cause of the
  // v0.28 page misalignment in Page View and Preview.)
  useEffect(() => {
    // v6.09: Preview hides working notes UNCONDITIONALLY now (the include
    // toggles are gone — Preview's Include list is annotations-only).
    const hideSections = previewMode ? true : !sectionsVisible;
    const hideTodos = previewMode ? true : !scriptTodosVisible;
    const doubleSpaceHeaders = previewMode && previewOpts.doubleSpaceHeaders;
    // The title page shows in Preview (and in print/PDF, which build from it) —
    // never in the Page or Continuous views you actually write in.
    const hideTitlePage = !previewMode;
    setPaginationVisibility({ hideSections, hideTodos, doubleSpaceHeaders, hideTitlePage });
    if (editor) {
      // Recompute breaks + decorations, which also re-runs overlay measurement.
      requestAnimationFrame(() => {
        try { editor.view.dispatch(editor.state.tr.setMeta('forceRepaginate', true)); } catch { /* ignore */ }
      });
    }
  }, [editor, previewMode, previewOpts, sectionsVisible, scriptTodosVisible]);

  // --- Print: swap pixel-margin page spacers for real page breaks ---
  // The editor's page gaps are inline margin-top decorations sized to the
  // on-screen page; printers use their own page geometry, so those margins
  // printed as drift and mid-page voids. During printing the paginator emits
  // an `fd-print-break` class instead (CSS: break-before + top margin), so
  // printed pages match the editor's pagination exactly.
  useEffect(() => {
    if (!editor) return;
    const refresh = () => { try { editor.view.dispatch(editor.state.tr.setMeta('forceRepaginate', true)); } catch { /* ignore */ } };
    const before = () => { setPaginationPrintMode(true); refresh(); };
    const after = () => { setPaginationPrintMode(false); refresh(); };
    window.addEventListener('beforeprint', before);
    window.addEventListener('afterprint', after);
    return () => {
      window.removeEventListener('beforeprint', before);
      window.removeEventListener('afterprint', after);
      setPaginationPrintMode(false);
    };
  }, [editor]);

  // --- Track unsaved changes for status bar ---
  useEffect(() => {
    if (!editor || !currentProject || !currentScriptId) return;
    const markUnsaved = ({ transaction }: { transaction: Transaction }) => {
      // v7.24: a stored value re-rendered in the current display format is
      // not an edit the writer made. Marking a script dirty the moment it
      // opens would be a worse bug than the date format it corrects.
      if (transaction.getMeta(DISPLAY_REFRESH_META)) return;
      const { saveStatus } = useEditorStore.getState();
      // Only mark unsaved if we're in idle or saved state (not during saving or error)
      if (saveStatus === 'idle' || saveStatus === 'saved') {
        useEditorStore.getState().setSaveStatus('unsaved');
      }
    };
    editor.on('update', markUnsaved);
    return () => { editor.off('update', markUnsaved); };
  }, [editor, currentProject, currentScriptId]);

  /* --- The title page's draft date follows Settings ▸ Dates & Times (v7.24)
     Derek: "the date format on the title page is still not matching the date
     format I picked". v7.11 taught the BUILDERS to format it, but the line
     lives in the document as text, so pages built before — or by an importer,
     which passes no format — kept whatever they were built with.

     Two triggers, one writer. The effect body catches a format CHANGE; the
     transaction listener catches a content LOAD, which is the single choke
     point every open/import/template path goes through (setContent always
     stamps `preventUpdate`, true or false). Deferred out of the transaction
     so the dispatch never lands inside another dispatch. */
  const dateFormat = useSettingsStore((s) => s.dateFormat);
  useEffect(() => {
    if (!editor) return;
    const refresh = () => {
      if (!editor.isDestroyed) refreshTitlePageDraftDate(editor, useSettingsStore.getState().dateFormat);
    };
    refresh();
    const onTx = ({ transaction }: { transaction: Transaction }) => {
      if (transaction.getMeta('preventUpdate') === undefined) return;
      queueMicrotask(refresh);
    };
    editor.on('transaction', onTx);
    return () => { editor.off('transaction', onTx); };
  }, [editor, dateFormat]);

  // --- Flush metadata-only changes to backend ---
  // Store metadata (profiles, relationships, notes, etc.) can change without an
  // editor document update.  The 30s auto-save would eventually persist them, but
  // users expect "Save" to mean "saved" — a refresh within 30s would lose data.
  // This effect watches key metadata fields and triggers a debounced save (2s).
  useEffect(() => {
    if (!editor || !currentProject || !currentScriptId) return;
    const pid = currentProject.id;
    const sid = currentScriptId;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const unsub = useEditorStore.subscribe((state, prev) => {
      // Only react to metadata field changes
      if (
        state.characterRelationships === prev.characterRelationships &&
        state.characterProfiles === prev.characterProfiles &&
        state.notes === prev.notes &&
        state.generalNotes === prev.generalNotes &&
        state.shelfCards === prev.shelfCards &&
        state.tags === prev.tags &&
        state.beats === prev.beats &&
        state.beatColumns === prev.beatColumns &&
        state.outlineTabs === prev.outlineTabs &&
        state.outlineStash === prev.outlineStash &&
        state.outlineBarTab === prev.outlineBarTab &&
        state.viewedOutlineTab === prev.viewedOutlineTab &&
        state.spellCheckEnabled === prev.spellCheckEnabled &&
        state.grammarCheckEnabled === prev.grammarCheckEnabled
      ) return;
      if (scriptSwitchingRef.current) return;
      // Mark unsaved immediately
      const { saveStatus, setSaveStatus } = useEditorStore.getState();
      if (saveStatus === 'idle' || saveStatus === 'saved') setSaveStatus('unsaved');
      // Debounce the actual save (2s)
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        if (scriptSwitchingRef.current) return;
        const content = buildSaveContent();
        if (!content) return;
        // Data-loss guard (see auto-save): don't overwrite real content with an
        // empty/just-reset editor body.
        if (!docHasAnyText(content) && lastSavedNonEmptyRef.current) {
          console.warn('Metadata-save skipped: editor body is empty but saved content is not.');
          return;
        }
        const json = JSON.stringify(content);
        if (json !== lastSavedJsonRef.current) {
          lastSavedJsonRef.current = json;
          lastSavedNonEmptyRef.current = docHasAnyText(content);
          useEditorStore.getState().setSaveStatus('saving');
          scriptApi.saveScript(pid, sid, { content }).then(() => {
            // v7.61: the debounce is the app saving on its own, so 'auto' —
            // it fires from a store subscription, not from a keystroke the
            // writer aimed at saving.
            useEditorStore.getState().markSaved('auto', sid);
          }).catch((err) => {
            console.error('Metadata save failed:', err);
            const msg = err instanceof Error ? err.message : String(err);
            useEditorStore.getState().setSaveStatus('error', msg);
            reportSaveError(err, 'metadata-save');
          });
        }
      }, 2000);
    });

    return () => { unsub(); if (timer) clearTimeout(timer); };
  }, [editor, currentProject, currentScriptId, buildSaveContent]);

  // --- Sticky Notes snippet capture: ⌥⌘X (cut selection to sticky) / ⌥⌘C (copy) ---
  // Creates a Snippet card from the current editor selection and opens the
  // Sticky Notes panel. Cut additionally deletes the selection from the doc.
  useEffect(() => {
    if (!editor || isHistoryMode) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || !e.altKey || e.shiftKey) return;
      if (e.code !== 'KeyX' && e.code !== 'KeyC') return;
      // v6.38: ONE implementation with the Snippets window's buttons.
      if (!captureSelectionSnippet(editor, e.code === 'KeyX' ? 'cut' : 'copy')) return;
      e.preventDefault();
      useEditorStore.getState().openTool('fragments');
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [editor, isHistoryMode]);

  // --- Persist project dictionary words when they change ---
  // Words live on the Project entity (shared by every script in the project).
  // Subscribe to spell-checker changes and write the new list back to the
  // project via projectApi, debounced.
  useEffect(() => {
    if (!currentProject) return;
    const pid = currentProject.id;
    let timer: ReturnType<typeof setTimeout> | null = null;
    // Baseline: whatever the project currently believes its words are.
    let lastSavedKey = JSON.stringify(
      [...((currentProject.properties?.dictionary_words ?? []) as string[])].sort(),
    );
    const unsub = spellChecker.onChange(() => {
      const words = spellChecker.getProjectWords();
      const key = JSON.stringify(words);
      if (key === lastSavedKey) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(async () => {
        try {
          const proj = useProjectStore.getState().currentProject;
          if (!proj || proj.id !== pid) return;
          const updated = await projectApi.updateProject(pid, {
            properties: { ...proj.properties, dictionary_words: words } as any,
          });
          setCurrentProject(updated);
          lastSavedKey = key;
        } catch (err) {
          console.warn('Failed to persist project dictionary words', err);
        }
      }, 800);
    });
    return () => { unsub(); if (timer) clearTimeout(timer); };
  }, [currentProject, setCurrentProject]);

  // --- Save on page unload (refresh / close) ---
  // Two strategies depending on platform:
  //   1. Tauri desktop / mobile — register a `onCloseRequested` handler that
  //      preventDefault()s the close, awaits the SQLite save, and only then
  //      closes the window.  Plain `beforeunload` is unreliable on WebView2
  //      (Windows): the renderer is torn down before the async IPC save
  //      completes, so the last unsaved edits are silently lost.
  //   2. Web — `beforeunload` is the only hook available.  We fire the save
  //      and, if there are unsaved changes, also set returnValue so the
  //      browser shows its standard "Leave this page?" prompt.  That gives
  //      the in-flight save a few extra milliseconds before the tab dies.
  //
  // NOTE: We intentionally do NOT save on component unmount because the
  // editor may already be destroyed at that point, and editor.getJSON()
  // would return an empty doc, overwriting the saved file with blank content.
  useEffect(() => {
    if (!editor || !currentProject || !currentScriptId) return;
    const pid = currentProject.id;
    const sid = currentScriptId;

    const flushPendingSave = async (): Promise<void> => {
      if (editor.isDestroyed) return;
      const content = buildSaveContent();
      if (!content) return;
      const json = JSON.stringify(content);
      if (json === lastSavedJsonRef.current) return;
      lastSavedJsonRef.current = json;
      try {
        await scriptApi.saveScript(pid, sid, { content });
      } catch (err) {
        // Bubble through console — the close handler decides what to do
        // about persistence failures (it falls back to confirm()).
        console.error('Save-on-close failed:', err);
        throw err;
      }
    };

    // ── Tauri path ────────────────────────────────────────────────────────
    let unlistenCloseRequested: (() => void) | null = null;
    let cancelled = false;

    if (isTauri()) {
      (async () => {
        try {
          const { getCurrentWebviewWindow } = await import(
            '@tauri-apps/api/webviewWindow'
          );
          const win = getCurrentWebviewWindow();
          const unlisten = await win.onCloseRequested(async (event) => {
            if (editor.isDestroyed) return;
            const content = buildSaveContent();
            if (!content) return;
            const json = JSON.stringify(content);
            if (json === lastSavedJsonRef.current) return;
            // We have unsaved edits.  Block the close, run the save, then
            // close programmatically.  If the save fails, ask the user
            // before discarding their work.
            event.preventDefault();
            try {
              await flushPendingSave();
              await win.destroy();
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              // v2.24: window.confirm is an async Tauri shim in the app —
              // always truthy, so this guard silently never guarded.
              const proceed = await confirmDialog(
                `Could not save your latest changes:\n\n${msg}\n\nClose anyway and lose those changes?`,
                { title: 'Save Failed', confirmLabel: 'Close Anyway', danger: true },
              );
              if (proceed) await win.destroy();
            }
          });
          if (cancelled) unlisten();
          else unlistenCloseRequested = unlisten;
        } catch (err) {
          console.error('Failed to register onCloseRequested handler:', err);
        }
      })();
    }

    // ── Web path (and a defensive fallback for Tauri) ─────────────────────
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (editor.isDestroyed) return;
      const content = buildSaveContent();
      if (!content) return;
      const json = JSON.stringify(content);
      if (json === lastSavedJsonRef.current) return;
      lastSavedJsonRef.current = json;
      // Fire-and-forget save.  The browser will give the request a brief
      // grace window before terminating the tab.  If the user cancels the
      // unload (returnValue prompt below), they'll still be in the editor
      // and need to know the save failed — so push it to the modal store.
      scriptApi.saveScript(pid, sid, { content }).catch((err) => {
        console.error('Save-on-unload failed:', err);
        reportSaveError(err, 'save-on-close');
      });
      // Trigger the browser's native confirm prompt so the user gets a
      // chance to abort the close while the save is still in flight.
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      cancelled = true;
      if (unlistenCloseRequested) unlistenCloseRequested();
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [editor, currentProject, currentScriptId, buildSaveContent]);

  // --- Load script from URL params ---
  // Reset the guard when the editor instance changes so we reload
  // content if TipTap recreates the editor.
  const loadedScriptRef = useRef<string | null>(null);
  const [historyVersionLabel, setHistoryVersionLabel] = useState('');
  useEffect(() => {
    // Allow re-load for a new editor instance.
    if (editor) {
      loadedScriptRef.current = null;
    }
  }, [editor]);
  // Reset load guard when a version is restored so the editor refetches the content
  useEffect(() => {
    if (scriptReloadKey > 0) {
      loadedScriptRef.current = null;
    }
  }, [scriptReloadKey]);
  useEffect(() => {
    if (!editor || !urlProjectId || !urlScriptId) return;
    const loadKey = `${urlProjectId}/${urlScriptId}${urlCommitHash ? `@${urlCommitHash}` : ''}`;
    // Avoid reloading the same script
    if (loadedScriptRef.current === loadKey) return;

    // Capture the previous load key BEFORE overwriting it. A null value here
    // means this is the first load in this mount — there is nothing to flush
    // (the editor only holds its default empty content, which would overwrite
    // the stored script if saved).
    const prevLoadKey = loadedScriptRef.current;
    loadedScriptRef.current = loadKey;
    clearTrackChanges();
    scriptSwitchingRef.current = true;
    (async () => {
      try {
        // Flush unsaved changes to the CURRENT script before switching so
        // metadata (character profiles, relationships, etc.) is not lost.
        // Only do this if we actually loaded a prior script in this mount —
        // otherwise the "pending" content is just the editor's default empty
        // state and would clobber a stored script.
        if (prevLoadKey && currentProject && currentScriptId) {
          const pendingContent = buildSaveContent();
          if (pendingContent) {
            const pendingJson = JSON.stringify(pendingContent);
            if (pendingJson !== lastSavedJsonRef.current) {
              lastSavedJsonRef.current = pendingJson;
              try { await scriptApi.saveScript(currentProject.id, currentScriptId, { content: pendingContent }); } catch {}
            }
          }
        }

        const project = await projectApi.getProject(urlProjectId);
        setCurrentProject(project);
        setCurrentScriptId(isHistoryMode ? null : urlScriptId);
        // Loading a project-backed script means we're no longer editing an
        // imported standalone file — drop the source-file notice.
        useEditorStore.getState().setImportedSource(null);

        let scriptResp;
        if (isHistoryMode && urlCommitHash) {
          scriptResp = await api.getScriptAtVersion(urlProjectId, urlCommitHash, urlScriptId);
          setHistoryVersionLabel(urlCommitHash.slice(0, 7));
        } else {
          scriptResp = await scriptApi.getScript(urlProjectId, urlScriptId);
        }
        const content = scriptResp.content as Record<string, unknown> | null;

        // Strip app metadata keys before feeding to ProseMirror
        let pmDoc: Record<string, unknown> | null = null;
        if (content && typeof content === 'object' && 'type' in content && content.type === 'doc') {
          pmDoc = stripSaveExtras(content);
        }

        try {
          if (pmDoc && Array.isArray(pmDoc.content) && pmDoc.content.length > 0) {
            editor.commands.setContent(pmDoc);
          } else if (content && typeof content === 'object' && Object.keys(content).length > 0) {
            editor.commands.setContent(content);
          } else {
            editor.commands.setContent({ type: 'doc', content: [{ type: 'action', content: [] }] });
          }
        } catch (setErr) {
          console.error('setContent failed:', setErr);
          showToast(`Failed to render content: ${setErr instanceof Error ? setErr.message : String(setErr)}`, 'error');
          editor.commands.setContent({ type: 'doc', content: [{ type: 'action', content: [] }] });
        }
        clearEditorHistory(editor);

        // Record whether this script holds real content, so a later editor reset
        // to an empty body cannot silently overwrite it (data-loss guard).
        lastSavedNonEmptyRef.current = docHasAnyText(pmDoc ?? content);

        // Restore metadata from top-level content keys (skip in history mode)
        if (!isHistoryMode) {
          const store = useEditorStore.getState();
          // Clear per-screenplay metadata so we don't carry over from a previously opened script
          store.setCharacterProfiles([]);
          store.setCharacterRelationships([]);
          store.setReferredTags({});
          store.setScanResults(null);
          store.setNotes([]);
          store.setGeneralNotes([]);
          store.setShelfCards([]);
          store.setTags([]);
          store.setTagCategories([...DEFAULT_TAG_CATEGORIES]);
          store.setBeats([]);
          store.setBeatColumns([]);
          store.setPageLayout({ ...DEFAULT_PAGE_LAYOUT });
          const parseAttr = (val: unknown): unknown[] => {
            if (typeof val === 'string') { try { const p = JSON.parse(val); return Array.isArray(p) ? p : []; } catch { return []; } }
            if (Array.isArray(val)) return val;
            return [];
          };
          if (content) {
            const c = content as Record<string, unknown>;
            const notes = parseAttr(c._notes);
            if (notes.length > 0) store.setNotes(notes as import('../stores/editorStore').NoteInfo[]);
            const markups = parseAttr(c._markups);
            store.setMarkups(markups as import('../stores/slices/markupsSlice').ScriptMarkup[]);
            const gNotes = parseAttr(c._generalNotes);
            if (gNotes.length > 0) store.setGeneralNotes(gNotes as import('../stores/editorStore').GeneralNote[]);
            const shelfArr = parseAttr(c._shelf);
            // v5.36: legacy note/checklist cards become rich notes here —
            // the ONE door saved files enter through.
            if (shelfArr.length > 0) store.setShelfCards(migrateShelfCards(shelfArr as import('../stores/editorStore').ShelfCard[]));
            const tagsArr = parseAttr(c._tags);
            if (tagsArr.length > 0) store.setTags(tagsArr as import('../stores/editorStore').TagItem[]);
            const tagCats = parseAttr(c._tagCategories);
            if (tagCats.length > 0) store.setTagCategories(tagCats as import('../stores/editorStore').TagCategory[]);
            const profiles = parseAttr(c._characterProfiles);
            if (profiles.length > 0) {
              for (const prof of profiles as Record<string, unknown>[]) {
                if (prof.name && typeof prof.name === 'string') {
                  // v4.22: carry ALL saved fields (fullName, firstName, lastName,
                  // sexuality, customFields, …) rather than a hand-picked list
                  // that silently dropped anything new. upsert fills defaults.
                  const { name, ...rest } = prof;
                  store.upsertCharacterProfile(name, rest as Partial<import('../stores/editorStore').CharacterProfile>);
                }
              }
            }
            const rels = parseAttr(c._characterRelationships);
            if (rels.length > 0) {
              store.setCharacterRelationships(rels as import('../stores/editorStore').CharacterRelationship[]);
            }
            // v4.24: From Script classifications + scan list ride in the file
            if (c._referredTags && typeof c._referredTags === 'object' && !Array.isArray(c._referredTags)) {
              store.setReferredTags(c._referredTags as Record<string, import('../stores/editorStore').ReferredTag>);
            }
            const charScan = parseAttr(c._characterScan);
            if (charScan.length > 0) {
              store.setScanResults(charScan as import('../utils/characterScan').ScannedCharacter[]);
            }
            const custFields = parseAttr(c._characterCustomFields);
            if (custFields.length > 0) {
              store.setCharacterCustomFields(custFields as import('../stores/editorStore').CharacterCustomField[]);
            }
            // v5.75: the Locations Map tab — image + pins.
            store.setLocationMapImage(
              c._locationMapImage && typeof c._locationMapImage === 'object'
                ? c._locationMapImage as import('../utils/locationPlaces').LocationMapImage : null,
            );
            store.setLocationPlaces(
              c._locationPlaces
                ? readPlaces(c._locationPlaces)
                // v5.75 files hold flat `{name,x,y}` pins — read them as places.
                : migratePins(parseAttr(c._locationPins) as Array<{ name?: string; x?: number; y?: number }>),
            );
            const beatsArr = parseAttr(c._beats);
            store.setBeats(beatsArr as import('../stores/editorStore').BeatInfo[]);
            const beatColsArr = parseAttr(c._beatColumns);
            store.setBeatColumns(beatColsArr as import('../stores/editorStore').BeatColumn[]);
            // v2.30: outline variation tabs — restore, or wrap legacy data in one tab.
            if (Array.isArray(c._outlineTabs) && (c._outlineTabs as unknown[]).length > 0) {
              store.loadOutlineTabs(
                c._outlineTabs as Array<{ id: string; name: string }>,
                typeof c._outlineViewedTab === 'string' ? c._outlineViewedTab : '',
                typeof c._outlineBarTab === 'string' ? c._outlineBarTab : '',
                (c._outlineStash && typeof c._outlineStash === 'object' ? c._outlineStash : {}) as Record<string, import('../stores/editorStore').OutlineTabData>,
              );
            } else {
              store.resetOutlineTabs();
            }
            if (c._beatArrangeMode === 'auto' || c._beatArrangeMode === 'custom') {
              store.setBeatArrangeMode(c._beatArrangeMode);
            }
            // Restore scene numbering state
            if (typeof c._sceneNumbersVisible === 'boolean') {
              store.setSceneNumbersVisible(c._sceneNumbersVisible);
            }
            if (typeof c._sceneNumbersLocked === 'boolean') {
              store.setSceneNumbersLocked(c._sceneNumbersLocked);
            }
            // Restore per-document formatting template
            if (c._templateId && typeof c._templateId === 'string') {
              useFormattingTemplateStore.getState().setActiveTemplateId(c._templateId);
            } else {
              useFormattingTemplateStore.getState().setActiveTemplateId(null);
            }
            // Restore per-document ignored words for spell check
            const ignoredArr = parseAttr(c._ignoredWords);
            spellChecker.setIgnoredWords(ignoredArr as string[]);
            const ignoredOnceArr = parseAttr(c._ignoredOnce);
            spellChecker.setIgnoredOnce(ignoredOnceArr as string[]);
            // Project dictionary: words live on the Project entity. Merge with
            // any legacy per-script `_customDictWords` so we don't lose words
            // saved by older clients (the script copy is dropped on next save).
            const scriptDictWords = (parseAttr(c._customDictWords) as string[]).map((s) => String(s));
            const projDictWords = ((project.properties?.dictionary_words ?? []) as string[]).map((s) => String(s));
            const mergedSet = new Set<string>();
            for (const w of projDictWords) if (typeof w === 'string') mergedSet.add(w.toLowerCase());
            for (const w of scriptDictWords) if (typeof w === 'string') mergedSet.add(w.toLowerCase());
            const merged = [...mergedSet].sort();
            spellChecker.setProjectWords(merged);
            // If the script carried words the project didn't have, write the
            // merged set back to the project so the migration sticks.
            const needsMigration =
              scriptDictWords.length > 0 &&
              JSON.stringify(merged) !== JSON.stringify([...projDictWords].sort());
            if (needsMigration) {
              try {
                const updated = await projectApi.updateProject(project.id, {
                  properties: { ...project.properties, dictionary_words: merged } as any,
                });
                setCurrentProject(updated);
              } catch (err) {
                console.warn('Project dictionary migration save failed', err);
              }
            }
            if (c._enabledGlobalDicts === undefined) {
              // Legacy script (saved before this feature) — auto-enable "Personal"
              // if it exists, so users who had the old global custom dictionary keep
              // those words recognized.
              const lib = useEditorStore.getState().customDictionaries;
              spellChecker.setEnabledGlobalDicts(lib['Personal'] ? ['Personal'] : []);
            } else {
              const enabledGlobals = parseAttr(c._enabledGlobalDicts);
              spellChecker.setEnabledGlobalDicts(enabledGlobals as string[]);
            }
            // Per-script project-dictionary toggle. Default to enabled (back-compat).
            spellChecker.setProjectDictionaryEnabled(
              typeof c._projectDictEnabled === 'boolean' ? c._projectDictEnabled : true,
            );
            // Per-script enabled-languages. Default to built-in only.
            const langs = parseAttr(c._enabledLanguages);
            spellChecker.setEnabledLanguages(
              langs.length > 0 ? (langs as string[]) : [BUILTIN_LANGUAGE],
            );
            // Restore per-document ignored grammar rules / occurrences
            const grammarRules = parseAttr(c._ignoredGrammarRules);
            grammarIgnore.setIgnoredRules(grammarRules as string[]);
            const grammarOnce = parseAttr(c._ignoredGrammarOnce);
            grammarIgnore.setIgnoredOnce(grammarOnce as string[]);
            // Restore per-document spell/grammar toggles — v4.77: one shared
            // rule (explicit choice > legacy true > Settings default).
            {
              const sc = resolveSpellCheckOnLoad(c as Record<string, unknown>, useSettingsStore.getState().spellCheckByDefault);
              store.setSpellCheckEnabled(sc.enabled);
              store.setSpellCheckChoice(sc.choice);
            }
            store.setGrammarCheckEnabled(c._grammarCheckEnabled === true);
            // Restore per-document page layout (header/footer, margins)
            if (c._pageLayout && typeof c._pageLayout === 'object') {
              store.setPageLayout(migratePageLayout({ ...DEFAULT_PAGE_LAYOUT, ...(c._pageLayout as Record<string, unknown>) } as PageLayout));
            store.setDraftLabel(typeof (c as any)._draftLabel === 'string' && (c as any)._draftLabel ? (c as any)._draftLabel as string : 'First Draft');
            }
          }
        }

        setDocumentTitle(scriptResp.meta.title);
        useEditorStore.getState().setSaveStatus('idle');
        lastSavedJsonRef.current = '';
        requestAnimationFrame(() => updateScenes());
      } catch (err) {
        console.error('Failed to load script:', err);
        const errMsg = err instanceof Error ? err.message : String(err);
        // If the script doesn't exist (404), redirect to the project view
        if (errMsg.includes('404') && urlProjectId) {
          showToast('Script not found. It may have been removed by a version restore.', 'error');
          navigate(`/project/${urlProjectId}`, { replace: true });
        } else if (errMsg.includes('401') || errMsg.includes('Authentication required')) {
          // AuthGate has already opened the sign-in dialog for this 401; a red
          // error toast on top of it is just noise. After a successful sign-in
          // the load re-runs automatically (AuthGate bumps scriptReloadKey).
        } else {
          showToast(`Failed to load script: ${errMsg}`, 'error');
        }
      } finally {
        scriptSwitchingRef.current = false;
      }
    })();
  }, [editor, urlProjectId, urlScriptId, urlCommitHash, isHistoryMode, currentScriptId, setCurrentProject, setCurrentScriptId, setDocumentTitle, updateScenes, scriptReloadKey, navigate, buildSaveContent]);

  // --- Sync orphaned marks: runs ONCE after editor is ready, not on every doc change ---
  const orphanSyncDone = useRef(false);
  useEffect(() => {
    if (!editor || orphanSyncDone.current) return;
    const timer = setTimeout(() => {
      orphanSyncDone.current = true;
      const store = useEditorStore.getState();
      const noteMarkType = editor.schema.marks.scriptNote;
      const tagMarkType = editor.schema.marks.productionTag;
      const noteIds = new Set(store.notes.map((n) => n.id));
      const tagIds = new Set(store.tags.map((t) => t.id));
      const orphanedNotes: { noteId: string; text: string; elementType: string }[] = [];
      const orphanedTags: { tagId: string; categoryId: string; color: string; text: string; elementType: string }[] = [];

      editor.state.doc.descendants((node) => {
        if (!node.isText) return;
        for (const mark of node.marks) {
          if (noteMarkType && mark.type === noteMarkType) {
            const id = mark.attrs.noteId as string;
            if (id && !noteIds.has(id)) {
              orphanedNotes.push({ noteId: id, text: node.textContent.slice(0, 80), elementType: 'action' });
              noteIds.add(id);
            }
          }
          if (tagMarkType && mark.type === tagMarkType) {
            const id = mark.attrs.tagId as string;
            if (id && !tagIds.has(id)) {
              orphanedTags.push({
                tagId: id,
                categoryId: (mark.attrs.categoryId as string) || 'props',
                color: (mark.attrs.color as string) || '#9370DB',
                text: node.textContent.slice(0, 80),
                elementType: 'action',
              });
              tagIds.add(id);
            }
          }
        }
      });

      if (orphanedNotes.length > 0) {
        store.setNotes([...store.notes, ...orphanedNotes.map((o) => ({
          id: o.noteId, content: '', anchorText: o.text, elementType: o.elementType,
          contextLabel: '', color: 'Yellow' as const, createdAt: new Date().toISOString(), sceneId: null,
        }))]);
      }
      if (orphanedTags.length > 0) {
        store.setTags([...store.tags, ...orphanedTags.map((o) => ({
          id: o.tagId, categoryId: o.categoryId, name: o.text, text: o.text, notes: '',
          sceneId: null, elementType: o.elementType, createdAt: new Date().toISOString(),
        }))]);
      }
    }, 2000);
    return () => clearTimeout(timer);
  }, [editor]);

  // --- Scroll → current page tracking ---
  // ov.top is in the page's unscaled coordinate system; pageRect/containerRect
  // are in viewport (scaled) space, so ov.top must be multiplied by the zoom
  // scale before mixing with rect deltas.
  const handleScroll = useCallback(() => {
    if (!editorMainRef.current || !pageRef.current) return;
    const containerTop = editorMainRef.current.getBoundingClientRect().top;
    const pageTop = pageRef.current.getBoundingClientRect().top;
    const scale = (zoomLevelRef.current || 100) / 100;
    let page = 1;
    for (const ov of overlays) {
      if (pageTop + ov.top * scale - containerTop < 50) page = ov.pageNumber;
    }
    setCurrentPage(page);
  }, [overlays, setCurrentPage]);

  useEffect(() => {
    const el = editorMainRef.current;
    if (!el) return;
    el.addEventListener('scroll', handleScroll, { passive: true });
    return () => el.removeEventListener('scroll', handleScroll);
  }, [handleScroll]);

  // --- Go to page ---
  // Jump instantly: smooth-scrolling thousands of pixels on a long script
  // takes seconds. ov.top is unscaled, so multiply by zoom scale to land on
  // the correct page when zoom != 100%. ov.top sits at the top of the page
  // separator block (previous page's bottom margin + gap + new page's top
  // margin). Skip past the previous-page bottom margin and the 40px visual
  // gap so the new page (with its header line at the top) lands flush with
  // the viewport top — not flush with the start of the body content, which
  // would hide the page header and look like we'd overshot.
  const handleGoToPage = useCallback((page: number) => {
    if (!editorMainRef.current || !pageRef.current) return;
    if (page <= 1) {
      editorMainRef.current.scrollTo({ top: 0, behavior: 'auto' });
      return;
    }
    const ov = overlays.find(o => o.pageNumber === page);
    if (ov) {
      const pageRect = pageRef.current.getBoundingClientRect();
      const containerRect = editorMainRef.current.getBoundingClientRect();
      const scale = (zoomLevelRef.current || 100) / 100;
      const layout = pageLayoutRef.current;
      const bottomMarginPx = (layout.bottomMargin / 72) * 96;
      const pageTopOffset = ov.top + bottomMarginPx + 40; // 40 = page-sep-gap
      const scrollTo = editorMainRef.current.scrollTop + (pageRect.top + pageTopOffset * scale - containerRect.top);
      editorMainRef.current.scrollTo({ top: scrollTo, behavior: 'auto' });
    }
  }, [overlays]);

  // Wire up the picker trigger
  showPickerRef.current = useCallback((defaultType: ElementType, availableTypes?: ElementType[], suggestType?: ElementType, prevScriptType?: string | null) => {
    if (!editor) return;
    // Use requestAnimationFrame so the DOM has settled after the split
    requestAnimationFrame(() => {
      if (!editor.view) return;
      const { from } = editor.state.selection;
      const coords = editor.view.coordsAtPos(from);
      setPickerState({
        visible: true,
        position: { top: coords.bottom + 4, left: coords.left },
        defaultType,
        availableTypes,
        suggestType,
        prevScriptType,
      });
    });
  }, [editor]);

  // Bridge: let the AvKeymap extension surface the same element picker, but
  // restricted to the cell-valid types (avPara/avShot/avDirection).
  React.useEffect(() => {
    registerAvCellPicker((defaultType, types) => {
      showPickerRef.current(defaultType as ElementType, types as readonly ElementType[] as ElementType[]);
    });
    return () => registerAvCellPicker(null);
  }, []);

  const handlePickerSelect = useCallback((picked: ElementType) => {
    if (!editor) return;
    // v4.84: "Dialogue" starts at the character name unless a name is already
    // above the caret — one shared resolver, so the picker, the toolbar
    // dropdown and the Insert menu all behave identically.
    const { $from } = editor.state.selection;
    const prevNode = $from.depth > 0 && $from.index($from.depth - 1) > 0
      ? $from.node($from.depth - 1).child($from.index($from.depth - 1) - 1)
      : null;
    const type = resolvePickedElement(picked, prevNode?.type.name ?? null) as ElementType;
    // Dual Dialogue is a structure, not a paragraph type — run its command
    // instead of trying to setNode a type that doesn't exist as a block (v0.84).
    if ((type as string) === 'dualDialogue') {
      (editor as unknown as { commands: { toggleDualDialogue: () => boolean } })
        .commands.toggleDualDialogue();
      setPickerState((st) => ({ ...st, visible: false }));
      return;
    }
    // setNode works for any real schema node (built-in script elements as
    // well as the AV inner types avPara/avShot/avDirection). Custom-id elements
    // declared only in template rules go through the customElement wrapper.
    if (editor.schema.nodes[type]) {
      editor.chain().focus().setNode(type).run();
    } else {
      const tpl = useFormattingTemplateStore.getState().getActiveTemplate();
      const rule = tpl.rules[type];
      if (rule) {
        editor.chain().focus().setNode('customElement', {
          customTypeId: type,
          customLabel: rule.label,
        }).run();
      }
    }
    setPickerState(s => ({ ...s, visible: false }));
  }, [editor]);

  const handlePickerDismiss = useCallback(() => {
    setPickerState(s => ({ ...s, visible: false }));
    // Re-focus editor
    editor?.commands.focus();
  }, [editor]);

  const handleOpenFile = useCallback(
    async (
      projectId: string,
      project: import('../services/api').ProjectInfo,
      scriptId: string,
      scriptTitle: string,
      source: OpenSource = 'local',
    ) => {
      if (!editor) {
        console.error('Editor not available');
        return;
      }
      setOpenFileOpen(false);
      // Cloud files must be tagged before the load so scriptApi routes reads
      // and subsequent saves to cloudApi rather than the local SQLite.
      if (source === 'cloud') markCloudScript(projectId, scriptId);

      clearTrackChanges();
      scriptSwitchingRef.current = true;
      try {
        // Flush unsaved changes to the CURRENT script before switching
        if (currentProject && currentScriptId) {
          const pendingContent = buildSaveContent();
          if (pendingContent) {
            const pendingJson = JSON.stringify(pendingContent);
            if (pendingJson !== lastSavedJsonRef.current) {
              lastSavedJsonRef.current = pendingJson;
              try { await scriptApi.saveScript(currentProject.id, currentScriptId, { content: pendingContent }); } catch {}
            }
          }
        }

        const scriptResp = await scriptApi.getScript(projectId, scriptId);
        const content = scriptResp.content as Record<string, unknown> | null;

        // Switch the project context first so the dictionary-words save effect
        // sees the new project before any spellChecker.setProjectWords() fires.
        setCurrentProject(project);
        setCurrentScriptId(scriptId);
        // Opening a project script clears any prior "imported file" notice.
        useEditorStore.getState().setImportedSource(null);

        try {
          if (content && typeof content === 'object' && 'type' in content && content.type === 'doc') {
            editor.commands.setContent(stripSaveExtras(content as Record<string, unknown>));
          } else if (content && typeof content === 'object' && Object.keys(content).length > 0) {
            editor.commands.setContent(content);
          } else {
            editor.commands.setContent({ type: 'doc', content: [{ type: 'action', content: [] }] });
          }
        } catch (setErr) {
          console.error('setContent failed, using blank doc:', setErr);
          showToast(`Failed to render content: ${setErr instanceof Error ? setErr.message : String(setErr)}`, 'error');
          editor.commands.setContent({ type: 'doc', content: [{ type: 'action', content: [] }] });
        }
        clearEditorHistory(editor);

        // Restore metadata from top-level content keys
        const store = useEditorStore.getState();
        // Clear all per-file metadata first
        store.setCharacterProfiles([]);
        store.setCharacterRelationships([]);
        store.setReferredTags({});
        store.setScanResults(null);
        store.setNotes([]);
        store.setGeneralNotes([]);
        store.setTags([]);
        store.setTagCategories([...DEFAULT_TAG_CATEGORIES]);
        store.setBeats([]);
        store.setBeatColumns([]);
        store.setPageLayout({ ...DEFAULT_PAGE_LAYOUT });
        // Default per-doc spell/grammar to off; the block below overrides
        // from the loaded content if the user had enabled them previously.
        store.setSpellCheckEnabled(false);
        store.setGrammarCheckEnabled(false);
        const parseAttr2 = (val: unknown): unknown[] => {
          if (typeof val === 'string') { try { const p = JSON.parse(val); return Array.isArray(p) ? p : []; } catch { return []; } }
          if (Array.isArray(val)) return val;
          return [];
        };
        if (content) {
          const c = content as Record<string, unknown>;
          const notes2 = parseAttr2(c._notes);
          if (notes2.length > 0) store.setNotes(notes2 as import('../stores/editorStore').NoteInfo[]);
          const markups2 = parseAttr2(c._markups);
          store.setMarkups(markups2 as import('../stores/slices/markupsSlice').ScriptMarkup[]);
          const gNotes2 = parseAttr2(c._generalNotes);
          if (gNotes2.length > 0) store.setGeneralNotes(gNotes2 as import('../stores/editorStore').GeneralNote[]);
          const tags2 = parseAttr2(c._tags);
          if (tags2.length > 0) store.setTags(tags2 as import('../stores/editorStore').TagItem[]);
          const tagCats2 = parseAttr2(c._tagCategories);
          if (tagCats2.length > 0) store.setTagCategories(tagCats2 as import('../stores/editorStore').TagCategory[]);
          const profiles2 = parseAttr2(c._characterProfiles);
          if (profiles2.length > 0) {
            for (const prof of profiles2 as Record<string, unknown>[]) {
              if (prof.name && typeof prof.name === 'string') {
                const { name, ...rest } = prof; // v4.22: carry all saved fields
                store.upsertCharacterProfile(name, rest as Partial<import('../stores/editorStore').CharacterProfile>);
              }
            }
          }
          const rels2 = parseAttr2(c._characterRelationships);
          if (rels2.length > 0) {
            store.setCharacterRelationships(rels2 as import('../stores/editorStore').CharacterRelationship[]);
          }
          // v4.24: From Script classifications + scan list ride in the file
          if (c._referredTags && typeof c._referredTags === 'object' && !Array.isArray(c._referredTags)) {
            store.setReferredTags(c._referredTags as Record<string, import('../stores/editorStore').ReferredTag>);
          }
          const charScan2 = parseAttr2(c._characterScan);
          if (charScan2.length > 0) {
            store.setScanResults(charScan2 as import('../utils/characterScan').ScannedCharacter[]);
          }
          const custFields2 = parseAttr2(c._characterCustomFields);
          if (custFields2.length > 0) {
            store.setCharacterCustomFields(custFields2 as import('../stores/editorStore').CharacterCustomField[]);
          }
          // v5.75: the Locations Map tab — image + pins.
          store.setLocationMapImage(
            c._locationMapImage && typeof c._locationMapImage === 'object'
              ? c._locationMapImage as import('../utils/locationPlaces').LocationMapImage : null,
          );
          store.setLocationPlaces(
              c._locationPlaces
                ? readPlaces(c._locationPlaces)
                // v5.75 files hold flat `{name,x,y}` pins — read them as places.
                : migratePins(parseAttr2(c._locationPins) as Array<{ name?: string; x?: number; y?: number }>),
            );
          const beatsArr2 = parseAttr2(c._beats);
          store.setBeats(beatsArr2 as import('../stores/editorStore').BeatInfo[]);
          const beatCols2 = parseAttr2(c._beatColumns);
          store.setBeatColumns(beatCols2 as import('../stores/editorStore').BeatColumn[]);
          // v2.30: outline variation tabs — restore, or wrap legacy data in one tab.
          if (Array.isArray(c._outlineTabs) && (c._outlineTabs as unknown[]).length > 0) {
            store.loadOutlineTabs(
              c._outlineTabs as Array<{ id: string; name: string }>,
              typeof c._outlineViewedTab === 'string' ? c._outlineViewedTab : '',
              typeof c._outlineBarTab === 'string' ? c._outlineBarTab : '',
              (c._outlineStash && typeof c._outlineStash === 'object' ? c._outlineStash : {}) as Record<string, import('../stores/editorStore').OutlineTabData>,
            );
          } else {
            store.resetOutlineTabs();
          }
          // Restore per-document template
          if (c._templateId && typeof c._templateId === 'string') {
            useFormattingTemplateStore.getState().setActiveTemplateId(c._templateId);
          } else {
            useFormattingTemplateStore.getState().setActiveTemplateId(null);
          }
          // Restore per-document page layout (header/footer, margins)
          if (c._pageLayout && typeof c._pageLayout === 'object') {
            store.setPageLayout(migratePageLayout({ ...DEFAULT_PAGE_LAYOUT, ...(c._pageLayout as Record<string, unknown>) } as PageLayout));
            store.setDraftLabel(typeof (c as any)._draftLabel === 'string' && (c as any)._draftLabel ? (c as any)._draftLabel as string : 'First Draft');
          }
          // Restore per-document spell/grammar toggles — v4.77: the SAME rule
          // as the cloud path (this one used to ignore the Settings default).
          {
            const sc = resolveSpellCheckOnLoad(c as Record<string, unknown>, useSettingsStore.getState().spellCheckByDefault);
            store.setSpellCheckEnabled(sc.enabled);
            store.setSpellCheckChoice(sc.choice);
          }
          store.setGrammarCheckEnabled(c._grammarCheckEnabled === true);
          // Per-script project-dictionary toggle (default on).
          spellChecker.setProjectDictionaryEnabled(
            typeof c._projectDictEnabled === 'boolean' ? c._projectDictEnabled : true,
          );
          // Per-script enabled-languages (default: built-in only).
          const langs2 = parseAttr2(c._enabledLanguages);
          spellChecker.setEnabledLanguages(
            langs2.length > 0 ? (langs2 as string[]) : [BUILTIN_LANGUAGE],
          );
          // Enabled global dictionaries.
          if (c._enabledGlobalDicts === undefined) {
            const lib = useEditorStore.getState().customDictionaries;
            spellChecker.setEnabledGlobalDicts(lib['Personal'] ? ['Personal'] : []);
          } else {
            const enabledGlobals2 = parseAttr2(c._enabledGlobalDicts);
            spellChecker.setEnabledGlobalDicts(enabledGlobals2 as string[]);
          }
          // Ignored-words / ignored-once carry per document.
          spellChecker.setIgnoredWords(parseAttr2(c._ignoredWords) as string[]);
          spellChecker.setIgnoredOnce(parseAttr2(c._ignoredOnce) as string[]);
          // Project dictionary: project entity is source of truth; merge with
          // legacy per-script `_customDictWords` for back-compat.
          const scriptDict2 = (parseAttr2(c._customDictWords) as string[]).map(String);
          const projDict2 = ((project.properties?.dictionary_words ?? []) as string[]).map(String);
          const merged2 = new Set<string>();
          for (const w of projDict2) if (typeof w === 'string') merged2.add(w.toLowerCase());
          for (const w of scriptDict2) if (typeof w === 'string') merged2.add(w.toLowerCase());
          const mergedArr2 = [...merged2].sort();
          spellChecker.setProjectWords(mergedArr2);
          const needsMigration2 =
            scriptDict2.length > 0 &&
            JSON.stringify(mergedArr2) !== JSON.stringify([...projDict2].sort());
          if (needsMigration2) {
            try {
              const updated = await projectApi.updateProject(project.id, {
                properties: { ...project.properties, dictionary_words: mergedArr2 } as any,
              });
              setCurrentProject(updated);
            } catch (err) {
              console.warn('Project dictionary migration save failed (open-file path)', err);
            }
          }
        }
        setDocumentTitle(scriptTitle);
        requestAnimationFrame(() => updateScenes());
      } catch (err) {
        console.error('Failed to open script:', err);
        showToast('Failed to open script. See the console for details.', 'error');
      } finally {
        scriptSwitchingRef.current = false;
      }
    },
    [editor, setOpenFileOpen, setCurrentProject, setCurrentScriptId, setDocumentTitle, updateScenes, currentProject, currentScriptId, buildSaveContent, markCloudScript],
  );

  const handleWelcomeChoice = useCallback(async (choice: WelcomeChoice) => {
    setShowWelcome(false);
    localStorage.setItem('opendraft:welcomed', 'true');

    if (choice === 'sample') {
      editor?.commands.setContent(SAMPLE_CONTENT, true);
      if (editor) clearEditorHistory(editor);
    } else if (choice === 'open') {
      // v1.53: straight into the same Open flow File > Open uses.
      setOpenFileOpen(true);
    } else if (choice === 'import') {
      if (!editor) return;
      const { openTextFile } = await import('../utils/fileOps');
      const result = await openTextFile([
        { name: 'Script', extensions: ['fountain', 'fdx', 'txt'] },
      ]);
      if (!result) return;

      const { name, content: text } = result;
      const ext = name.split('.').pop()?.toLowerCase();
      let doc;
      if (ext === 'fdx') {
        const parsed = parseFDXFull(text);
        doc = parsed.doc;
        if (parsed.pageLayout) {
          useEditorStore.getState().setPageLayout({
            ...useEditorStore.getState().pageLayout,
            ...parsed.pageLayout,
          });
        }
        if (parsed.beats.length > 0) {
          const store = useEditorStore.getState();
          store.setBeats(parsed.beats);
          if (parsed.beatColumns.length > 0) {
            store.setBeatColumns(parsed.beatColumns);
          }
        }
        if (parsed.castList.length > 0 || parsed.characterHighlighting.length > 0) {
          const store = useEditorStore.getState();
          const highlightMap = new Map(parsed.characterHighlighting.map((h) => [h.name.toUpperCase(), h]));
          for (const member of parsed.castList) {
            const hl = highlightMap.get(member.name.toUpperCase());
            store.upsertCharacterProfile(member.name, {
              description: member.description,
              color: hl?.color || '',
              highlighted: hl?.highlighted || false,
            });
            highlightMap.delete(member.name.toUpperCase());
          }
          for (const [, hl] of highlightMap) {
            store.upsertCharacterProfile(hl.name, {
              color: hl.color,
              highlighted: hl.highlighted,
            });
          }
        }
      } else {
        doc = parseFountain(text);
      }
      editor.commands.setContent(doc, true);
      clearEditorHistory(editor);
      const scriptTitle = name.replace(/\.\w+$/, '') || 'Untitled';
      useEditorStore.getState().setDocumentTitle(scriptTitle);
      const fmtLabel = ext === 'fdx' ? 'Final Draft (.fdx)'
        : ext === 'fountain' ? 'Fountain (.fountain)'
        : ext ? `.${ext}` : 'imported file';
      useEditorStore.getState().setImportedSource({ name, format: fmtLabel });
    }
    // 'blank' — editor already has empty content, nothing to do
  }, [editor]);

  // ── File association: open files passed by the OS ──────────────────────
  const handleExternalFile = useCallback(async (filePath: string) => {
    if (!editor) {
      console.warn('[file-assoc] editor not ready, ignoring:', filePath);
      showToast('Editor not ready — please try again', 'error');
      return;
    }
    console.log('[file-assoc] opening:', filePath);
    try {
      const { invoke } = await import('@tauri-apps/api/core');

      let text: string;
      let filename: string;

      if (filePath.startsWith('content://')) {
        // Android content URI — read via ContentResolver (JNI)
        console.log('[file-assoc] reading content URI via JNI...');
        const result = await invoke<{ content: string; filename: string }>('read_content_uri', { uri: filePath });
        text = result.content;
        filename = result.filename;
        if (!text && text !== '') {
          throw new Error(`ContentResolver returned empty content for ${filename}`);
        }
        console.log('[file-assoc] content URI read', text.length, 'chars, filename:', filename);
      } else {
        console.log('[file-assoc] reading file path via read_text_file...');
        text = await invoke<string>('read_text_file', { path: filePath });
        filename = filePath.replace(/^.*[\\/]/, '') || 'Untitled';
        console.log('[file-assoc] read', text.length, 'chars from', filePath);
      }

      const ext = filename.split('.').pop()?.toLowerCase();
      const title = filename.replace(/\.\w+$/, '');

      let doc: any;
      if (ext === 'fdx') {
        const parsed = parseFDXFull(text);
        doc = parsed.doc;
        if (parsed.pageLayout) {
          useEditorStore.getState().setPageLayout({
            ...useEditorStore.getState().pageLayout,
            ...parsed.pageLayout,
          });
        }
        if (parsed.beats.length > 0) {
          const store = useEditorStore.getState();
          store.setBeats(parsed.beats);
          if (parsed.beatColumns.length > 0) store.setBeatColumns(parsed.beatColumns);
        }
        if (parsed.castList.length > 0 || parsed.characterHighlighting.length > 0) {
          const store = useEditorStore.getState();
          const highlightMap = new Map(parsed.characterHighlighting.map((h) => [h.name.toUpperCase(), h]));
          for (const member of parsed.castList) {
            const hl = highlightMap.get(member.name.toUpperCase());
            store.upsertCharacterProfile(member.name, {
              description: member.description,
              color: hl?.color || '',
              highlighted: hl?.highlighted || false,
            });
            highlightMap.delete(member.name.toUpperCase());
          }
          for (const [, hl] of highlightMap) {
            store.upsertCharacterProfile(hl.name, { color: hl.color, highlighted: hl.highlighted });
          }
        }
      } else if (isScriptExt(ext)) {
        const parsed = parseOdraft(text);
        doc = parsed.content;
        if (parsed.meta.title) {
          setDocumentTitle(parsed.meta.title);
          setShowWelcome(false);
          setCurrentProject(null);
          setCurrentScriptId(null);
          editor.commands.setContent(doc, true);
          clearEditorHistory(editor);
          return;
        }
      } else {
        // .fountain, .txt — parse as Fountain
        doc = parseFountain(text);
      }

      editor.commands.setContent(doc, true);
      clearEditorHistory(editor);
      setDocumentTitle(title);
      setShowWelcome(false);
      // Clear project context — this is a standalone opened file
      setCurrentProject(null);
      setCurrentScriptId(null);
      // Mark as imported so Save As shows the "saved to ScriptCraft library" notice.
      const fmtLabel = ext === 'fdx' ? 'Final Draft (.fdx)'
        : ext === 'fountain' ? 'Fountain (.fountain)'
        : isScriptExt(ext) ? SCRIPT_FORMAT_LABEL
        : ext ? `.${ext}` : 'imported file';
      useEditorStore.getState().setImportedSource({ name: filename, format: fmtLabel });
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      console.error('Failed to open external file:', filePath, detail, err);
      showToast(`Failed to open file: ${detail}`, 'error');
    }
  }, [editor, setDocumentTitle, setCurrentProject, setCurrentScriptId]);

  // The OS hands us a file — hooks/useFileAssociation owns how it arrives.
  useFileAssociation(!!editor, handleExternalFile);

  const handleSaveAsComplete = useCallback(
    async (
      projectId: string,
      _projectName: string,
      scriptId: string,
      scriptTitle: string,
      destination: 'local' | 'cloud',
      draftLabel?: string,
    ) => {
      setSaveAsOpen(false);
      // v1.15: the Draft/Version you typed into Save As is the DRAFT LABEL now, not
      // the script's identity. Apply it, or the fields would look like they did
      // something and quietly do nothing.
      if (draftLabel) useEditorStore.getState().setDraftLabel(draftLabel);
      // Check if there's a deferred action (e.g. "New Script") waiting
      const store = useEditorStore.getState();
      const hasDeferredAction = !!store.postSaveAction;

      // Use the same backend the SaveAsDialog wrote to. Without this branch
      // a cloud-saved script would 404 against the local SQLite getProject
      // and the editor would never finish wiring up to the new file.
      const client = destination === 'cloud' ? cloudApi : api;

      try {
        const project = await client.getProject(projectId);
        if (destination === 'cloud') {
          // Mark BOTH the project and the script as cloud-routed. The script
          // marker keeps subsequent saves dispatching to cloudApi; the
          // project marker makes the project show up under the "Cloud" tab
          // of the project list and routes ProjectView's reads correctly.
          const ps = useProjectStore.getState();
          ps.markCloudProject(projectId);
          ps.markCloudScript(projectId, scriptId);
        }
        setCurrentProject(project);
        setCurrentScriptId(scriptId);
        setDocumentTitle(scriptTitle);
        // Save-as resolved an imported document into a real project script —
        // the "imported file" notice is no longer relevant.
        store.setImportedSource(null);
        const scripts = await client.listScripts(projectId);
        useProjectStore.getState().setScripts(scripts);
        // Only navigate to the project route if there's no deferred action
        // that will reset the editor state (e.g. New Script)
        if (!hasDeferredAction) {
          navigate(`/project/${projectId}/edit/${scriptId}`, { replace: true });
        }
        /* v7.61: Save As writes the script inside SaveAsDialog and never went
           near setSaveStatus, so the footer's readout would have stayed blank
           after the most deliberate save there is. Stamped here, where the
           write has succeeded AND the editor has adopted the new script — the
           id passed is the NEW one, which is what the footer compares against. */
        useEditorStore.getState().markSaved('manual', scriptId);
        showToast(destination === 'cloud' ? 'Saved to cloud' : 'Saved', 'success');
      } catch (err) {
        console.error('Failed to finalize save:', err);
      }
      // Run deferred action (e.g. New Script, Import) that was waiting for save-as
      if (hasDeferredAction) {
        const action = store.postSaveAction;
        store.setPostSaveAction(null);
        if (action) action();
      }
    },
    [setSaveAsOpen, setCurrentProject, setCurrentScriptId, setDocumentTitle, navigate],
  );


  // ── Compare with Version picker callback ──
  const handleCompareVersionSelect = useCallback(
    async (version: VersionInfo) => {
      if (!editor || !currentProject || !currentScriptId) return;
      setCompareVersionOpen(false);
      try {
        const scriptResp = await api.getScriptAtVersion(
          currentProject.id,
          version.hash,
          currentScriptId,
        );
        setTrackChangesEnabled(true);
        setTrackChangesLabel(version.short_hash);
        const { tr } = editor.state;
        tr.setMeta(trackChangesPluginKey, {
          enabled: true,
          baseline: scriptResp.content,
        });
        editor.view.dispatch(tr);
      } catch (err) {
        const msg = err instanceof Error ? err.message : '';
        if (msg.includes('404')) {
          showToast('This script did not exist in that version', 'info');
        } else {
          showToast('Failed to load version for comparison', 'error');
        }
      }
    },
    [editor, currentProject, currentScriptId, setCompareVersionOpen, setTrackChangesEnabled, setTrackChangesLabel],
  );

  const handleCharAutoSelect = useCallback((name: string) => {
    if (!editor) return;
    const { $from } = editor.state.selection;
    const start = $from.start();
    const end = $from.end();
    // v3.44, Derek: scene headings are two-stage. A prefix (INT./EXT.) inserts
    // with a trailing space; once a prefix is present, a picked location keeps
    // that prefix ("INT. THE BRIDGE"). Characters/transitions insert as-is.
    let insert = name;
    if (charAutoState.mode === 'scene') {
      const cur = $from.parent.textContent.trim().toUpperCase();
      const pm = cur.match(/^(INT\.|EXT\.|INT\.\/EXT\.|EST\.)\s+/);
      insert = pm ? `${pm[1]} ${name}` : `${name} `;
    }
    editor.chain().focus()
      .command(({ tr }) => {
        tr.insertText(insert, start, end);
        return true;
      })
      .run();
    setCharAutoState(s => ({ ...s, visible: false }));
  }, [editor, charAutoState.mode]);

  const handleCharAutoDismiss = useCallback(() => {
    setCharAutoState(s => ({ ...s, visible: false }));
    charAutoDismissedRef.current = true;
  }, []);

  // --- Click on script note highlight → open its edit popover (v4.33) ---
  // The popover on the highlight is where note text lives now (the Notes
  // window is general-only). Only intercepts when note highlights are
  // visible (notesVisible); when they're off, clicks pass through as normal
  // editing.
  useEffect(() => {
    if (!editor) return;
    const handleClick = (e: MouseEvent) => {
      const store = useEditorStore.getState();
      if (!store.notesVisible) return;

      const target = e.target as HTMLElement;
      const noteEl = target.closest('.script-note-highlight') as HTMLElement | null;
      if (!noteEl) return;

      const noteId = noteEl.getAttribute('data-note-id');
      if (!noteId) return;

      const note = store.notes.find((n) => n.id === noteId);
      if (!note) return;

      store.setNotePopoverId(noteId);
    };

    const editorEl = editor.view.dom;
    editorEl.addEventListener('click', handleClick);
    return () => editorEl.removeEventListener('click', handleClick);
  }, [editor]);

  // --- Click on a markup highlight → open its popover (v5.25) ---
  // The margin icon is the primary handle; the highlight span is the same
  // door for range markups. Suppressed while markups are hidden so the
  // invisible span can't hijack ordinary editing clicks.
  useEffect(() => {
    if (!editor) return;
    const handleMarkupClick = (e: MouseEvent) => {
      const store = useEditorStore.getState();
      if (!store.markupsVisible || store.previewMode) return;
      const el = (e.target as HTMLElement).closest('.script-markup-highlight') as HTMLElement | null;
      const id = el?.getAttribute('data-markup-id');
      if (!id) return;
      const m = store.markups.find((x) => x.id === id);
      if (!m) return;
      // v5.26/v5.27: an annotation filtered out of the script — by type
      // ("Show" grid) or status (its Open/Complete/All row) — is invisible;
      // its span must not swallow ordinary editing clicks.
      if (store.markupHiddenIcons.includes(m.icon)) return;
      if (store.markupScriptDone !== 'all' && (store.markupScriptDone === 'done') !== m.done) return;
      store.setMarkupEditorId(id);
    };
    const editorEl = editor.view.dom;
    editorEl.addEventListener('click', handleMarkupClick);
    return () => editorEl.removeEventListener('click', handleMarkupClick);
  }, [editor]);

  // --- Click on character element → expand in character panel ---
  useEffect(() => {
    if (!editor) return;
    const handleCharClick = (e: MouseEvent) => {
      const store = useEditorStore.getState();
      if (!store.characterProfilesOpen) return;

      const pos = editor.view.posAtCoords({ left: e.clientX, top: e.clientY });
      if (!pos) return;

      const resolved = editor.state.doc.resolve(pos.pos);
      const node = resolved.parent;

      if (node.type.name === 'character') {
        const base = node.textContent.trim().replace(/\s*\([^)]*\)\s*/g, '').toUpperCase();
        if (base) {
          store.setSelectedCharacter(base);
        }
      }
    };

    const editorEl = editor.view.dom;
    editorEl.addEventListener('click', handleCharClick);
    return () => editorEl.removeEventListener('click', handleCharClick);
  }, [editor]);

  // --- Script context menu (right-click) ---
  useEffect(() => {
    if (!editor) return;
    const isTouchDevice = navigator.maxTouchPoints > 0;
    const handleContextMenu = (e: MouseEvent) => {
      // v5.43, Derek: ONLY the app's menu in the script area. The old guard
      // required the target to be INSIDE editor.view.dom, so right-clicks
      // on page margins, the page-break bands and the annotation icons —
      // all part of the script area but outside the ProseMirror DOM — fell
      // through to WebKit's NATIVE menu (Look Up / Translate / Services).
      const area = (e.target as HTMLElement).closest?.('.editor-main');
      if (!area) return;
      e.preventDefault();
      // No context menu on touch devices — use 3-finger touch instead
      if (isTouchDevice) return;

      // Move cursor to click position only if no text is selected,
      // or if the click is outside the current selection
      const pos = editor.view.posAtCoords({ left: e.clientX, top: e.clientY });
      if (pos) {
        const { from, to } = editor.state.selection;
        const clickInSelection = pos.pos >= from && pos.pos <= to && from !== to;
        if (!clickInSelection) {
          editor.commands.setTextSelection(pos.pos);
        }
      }

      // Check if clicked on a misspelled word
      let spellInfo: { word: string; from: number; to: number; suggestions: string[] } | null = null;
      const target = e.target as HTMLElement;
      if (target.classList.contains('spell-error') || target.closest('.spell-error')) {
        const spellEl = target.classList.contains('spell-error') ? target : target.closest('.spell-error');
        if (spellEl && pos) {
          // Find the decoration range by examining the spell error text
          const pluginState = spellCheckPluginKey.getState(editor.state) as { decorations: import('@tiptap/pm/view').DecorationSet; enabled: boolean } | undefined;
          if (pluginState?.enabled) {
            const decos = pluginState.decorations.find(pos.pos, pos.pos);
            if (decos.length > 0) {
              const deco = decos[0];
              const word = editor.state.doc.textBetween(deco.from, deco.to);
              spellInfo = {
                word,
                from: deco.from,
                to: deco.to,
                suggestions: spellChecker.suggest(word),
              };
            }
          }
        }
      }

      // Check if clicked on a grammar issue.
      let grammarInfo:
        | { from: number; to: number; ruleId: string; message: string; severity: 'style' | 'grammar'; suggestions: string[] }
        | null = null;
      if (pos && (target.classList.contains('grammar-issue') || target.closest('.grammar-issue'))) {
        const ps = grammarPluginKey.getState(editor.state) as { enabled: boolean; issues: import('../plugins/registry').GrammarIssue[] } | undefined;
        if (ps?.enabled && Array.isArray(ps.issues)) {
          const hit = ps.issues.find((i) => pos.pos >= i.from && pos.pos <= i.to);
          if (hit) {
            grammarInfo = {
              from: hit.from,
              to: hit.to,
              ruleId: hit.ruleId,
              message: hit.message,
              severity: hit.severity,
              suggestions: hit.suggestions ?? [],
            };
          }
        }
      }

      setCtxMenuState({
        visible: true,
        position: { x: e.clientX, y: e.clientY },
        spellInfo,
        grammarInfo,
      });
    };

    // v5.43: DOCUMENT-level so every right-click in the script area is
    // caught — the old parentElement binding missed the overlays and
    // margins that sit beside the ProseMirror DOM.
    document.addEventListener('contextmenu', handleContextMenu);
    return () => document.removeEventListener('contextmenu', handleContextMenu);
  }, [editor]);

  const handleCtxMenuClose = useCallback(() => {
    setCtxMenuState(s => ({ ...s, visible: false }));
  }, []);

  // --- Spell check: open modal when toggled on (or from menu) ---
  // The modal is opened via the Tools menu or spellCheckEnabled toggle.

  const zoomScale = zoomLevel / 100;

  // Compute last-page footer position so the last page shows its full extent
  const lastPageEnd = useMemo(() => {
    const m = getPageMetrics(pageLayout);
    if (overlays.length > 0) {
      const lastOverlay = overlays[overlays.length - 1];
      return lastOverlay.top + m.sepHeightPx + m.pageContentPx;
    }
    // Single page: content starts after top padding
    const topMarginPx = (pageLayout.topMargin / 72) * 96;
    return topMarginPx + m.pageContentPx;
  }, [overlays, pageLayout]);

  return (
    <div className={`app-container${isHistoryMode ? ' history-mode' : ''}`}>
      {/* v7.62: it mounts unconditionally and renders nothing until it has
          something to say — the check has to run whether or not a banner ever
          appears, and this is also what Help ▸ Check for Updates… talks to. */}
      <UpdateBanner />
      {isHistoryMode && (
        <div className="history-banner">
          <span className="history-banner-icon">&#128337;</span>
          <span className="history-banner-text">
            Viewing version <strong>{historyVersionLabel}</strong> — Read Only
          </span>
          <button
            className="history-banner-back"
            onClick={() => {
              if (urlProjectId && urlScriptId) {
                navigate(`/project/${urlProjectId}/edit/${urlScriptId}`);
              } else {
                navigate(-1);
              }
            }}
          >
            Back to Current Version
          </button>
        </div>
      )}
      {saveStatus === 'error' && currentProject && currentScriptId && (
        <div className="save-failure-banner">
          <span className="save-failure-icon">&#9888;</span>
          <span className="save-failure-text">
            Auto-save failed{saveError ? `: ${saveError}` : ''}. Your changes may not be saved.
          </span>
          <button className="save-failure-btn" onClick={() => {
            const content = buildSaveContent();
            if (!content || !currentProject || !currentScriptId) return;
            setSaveStatus('saving');
            scriptApi.saveScript(currentProject.id, currentScriptId, { content }).then(() => {
              lastSavedJsonRef.current = JSON.stringify(content);
              // v7.61: 'manual' — he pressed Retry. The failure it retries came
              // from an autosave, but the save that succeeded is his.
              useEditorStore.getState().markSaved('manual', currentScriptId);
              showToast('Saved successfully', 'success');
            }).catch((err) => {
              const msg = err instanceof Error ? err.message : String(err);
              setSaveStatus('error', msg);
            });
          }}>
            Retry
          </button>
          <button className="save-failure-btn" onClick={() => {
            useEditorStore.getState().setSaveAsOpen(true);
          }}>
            Save As
          </button>
          <button className="save-failure-btn" onClick={() => {
            const content = buildSaveContent();
            if (!content) return;
            const blob = new Blob([JSON.stringify(content, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = scriptFileName(`${useEditorStore.getState().documentTitle || 'backup'}_backup`);
            a.click();
            URL.revokeObjectURL(url);
            showToast('Backup exported', 'success');
          }}>
            Export Backup
          </button>
          <button className="save-failure-dismiss" onClick={() => setSaveStatus('unsaved')}>
            &times;
          </button>
        </div>
      )}
      {/* v3.09, Derek: the Quick Access Toolbar row (macOS overlay titlebar).
          Rendered in EVERY mode — the traffic lights float over the webview
          now, so something draggable must always occupy that strip. */}
      <TitleBar editor={editor} />
      {/* v2.94: the Big Button SECTION is gone — the Toolbar renders two
          rows itself (Row 1 formatting, Row 2 tools/app functions, where a
          token's big! flag makes it a large launcher). */}
      {!isHistoryMode && (
      /* v2.29, Derek: everything above the editor acts as ONE while
         resizing — drag the strip at the bottom of this block and the menu
         bar, toolbar and outline bar all scale proportionally. */
      <div className="fs-top-chrome" ref={topChromeRef}>
      <div className="chrome-stack">
        <div className="chrome-bars">
      {<MenuBar editor={editor} />}
      {<Toolbar editor={editor} />}
        </div>
      </div>
      {/* v2.31: this strip scales the menu bar + toolbar together.
          v4.3, Derek: it's ALWAYS in the layout now (a real, grabbable 6px bar),
          just invisible + inert when locked — so toggling the lock never shifts
          anything and there's a visible handle on the ribbon's bottom edge to
          drag its height. (The v3.86 zero-height ::before hit-area couldn't be
          grabbed.) */}
      <div
        className={`fs-top-chrome-resize${uiResizeLocked ? ' locked' : ''}`}
        title={uiResizeLocked ? undefined : 'Drag to resize'}
        onPointerDown={uiResizeLocked ? undefined : startBarsResize}
      />
      {/* v1.75: Outline Bar — FD-style outline lanes directly under the toolbar. */}
      {outlineBarShown && <OutlineBar editor={editor} />}
      {/* …and the bottom-most edge scales the outline bar's rows alone. */}
      {outlineBarShown && (
        <div
          className={`fs-top-chrome-resize${uiResizeLocked ? ' locked' : ''}`}
          title={uiResizeLocked ? undefined : 'Drag to resize the outline toolbar'}
          onPointerDown={uiResizeLocked ? undefined : startOutlineBarResize}
        />
      )}
      </div>
      )}
      <div className={`editor-layout${previewMode ? " preview-mode" : " hide-title-page"}${!isHistoryMode && fullscreenTool ? " editor-layout-fs" : ""}`}>
      {previewMode && <PreviewSidebar editor={editor} />}
        {!isHistoryMode && navigatorOpen && <ToolDock side="left" editor={editor} scrollContainer={editorMainEl} />}
        {/* v3.07, Derek: the collapsed panel leaves a slim expand strip at its
            edge (Obsidian-style counterpart to the collapse button). */}
        {!isHistoryMode && !navigatorOpen && !previewMode && (
          <button
            className="fs-panel-expand fs-panel-expand-left"
            title="Expand the left panel"
            onClick={toggleNavigator}
          ><DoubleChevronIcon towards="right" /></button>
        )}
        <div className="editor-center">
          {/* v1.96: the Notebook writing surface takes over the editor area
              while its panel window is open ("Return to editor" ends it). */}
          {/* v6.74, Derek: "the compare feature will open in the main
              editor window." The Snapshots tool sets scriptCompare; the
              diff owns the editor area — INSIDE the app chrome, so its
              controls can never collide with the ribbon the way the old
              fixed overlay's did. */}
          {!isHistoryMode && scriptCompare ? (
            <div className="fs-tool-takeover fs-compare-takeover">
              <ScriptDiffView
                docA={scriptCompare.docA as JSONContent}
                docB={scriptCompare.docB as JSONContent}
                labelA={scriptCompare.labelA}
                labelB={scriptCompare.labelB}
                onClose={() => useProjectStore.getState().setScriptCompare(null)}
              />
            </div>
          ) : !isHistoryMode && notebookOpen ? (
            <NotebookSurface />
          ) : !isHistoryMode && fullscreenTool ? (
            /* v4.35 batch-v9 #4: ONE takeover for every tool — same chrome
               registry, same body renderer as the window (ToolDock). */
            <ToolFullscreenTakeover editor={editor} scrollContainer={editorMainEl} />
          ) : !isHistoryMode && statisticsOpen && editor ? (
            <ScriptStatistics editor={editor} />
          ) : !isHistoryMode && beatBoardOpen ? (
            <BeatBoard />
          ) : (
            <>
            {/* v5.51, Derek: the pick-to-place banner — a strip pinned above
                the scroll area (editor-main is a flex ROW; a child there
                lands beside the page), centered, up until text is selected
                or Escape cancels. */}
            {markupCreatePick && (
              <div className="markup-pick-banner">
                <span className="markup-pick-banner-pill">
                  Select text in the script to add the annotation — Esc cancels
                </span>
              </div>
            )}
            <div className="editor-main" ref={attachEditorMain}>
              {/* v5.25: markup icons ride the scroll content (abs children of
                  the scroller move with it). v6.67: their positions are
                  MEASURED off the rendered page, so they recompute on zoom
                  and on any resize too — not on doc change only. */}
              {!isHistoryMode && <MarkupIconLayer editor={editor} container={editorMainEl} />}
              {/* v2.95, Derek: Word-style rulers, toggled in View > Show Rulers */}
              {rulersVisible && <EditorRulers container={editorMainRef} continuous={viewStyle === 'continuous' && !previewMode} />}
              {/* v7.25, Derek: the "Saved" flash sits on the page, an inch
                  under the ruler. Mounted here so it can measure the page it
                  centres on; it portals itself out to the body. */}
              <SavedFlash pageWidthIn={pageLayout.pageWidth} />
              <div
                className="page-sizer"
                style={{
                  width: `calc(${pageLayout.pageWidth}in * ${zoomScale})`,
                  minWidth: `calc(${pageLayout.pageWidth}in * ${zoomScale})`,
                }}
              >
              <div
                className="page-container"
                style={{
                  transform: `scale(${zoomScale})`,
                  transformOrigin: 'top left',
                  width: `${pageLayout.pageWidth}in`,
                  minWidth: `${pageLayout.pageWidth}in`,
                  maxWidth: `${pageLayout.pageWidth}in`,
                }}
              >
                <div
                  className={`page${!tagsVisible || previewMode ? ' tags-hidden' : ''}${previewMode || !notesVisible ? ' notes-hidden' : ''}${isHistoryMode ? ' history-readonly' : ''}${sceneNumbersVisible ? ' show-scene-numbers' : ''}${previewMode || !sectionsVisible ? ' hide-sections' : ''}${previewMode || !markersVisible ? ' hide-markers' : ''}${previewMode || !scriptTodosVisible ? ' hide-script-todos' : ''}${!previewMode && !markupsVisible && !markupEditOpen ? ' markups-hidden' : ''}${previewMode && previewOpts.doubleSpaceHeaders ? ' pv-hdr-double' : ''}${previewMode && !previewOpts.boldHeaders ? ' pv-hdr-plain' : ''}${previewMode && previewOpts.underlineHeaders ? ' pv-hdr-underline' : ''}`}
                  ref={pageRef}
                  style={{
                    fontFamily: `'${fontFamily}', 'Courier New', Courier, monospace`,
                    fontSize: `${fontSize}pt`,
                    width: `${pageLayout.pageWidth}in`,
                    // v4.22, Derek: in continuous view the white page always
                    // extends a full window past the content, so white fills
                    // down to the bottom of the editor — you never scroll into
                    // the grey below the last page. (Page view keeps discrete
                    // page heights.)
                    minHeight: (viewStyle === 'continuous' && !previewMode)
                      ? `calc(${lastPageEnd}px + 100vh)`
                      : `${lastPageEnd + (pageLayout.bottomMargin / 72) * 96}px`,
                    paddingTop: `${pageLayout.topMargin}pt`,
                    paddingBottom: `${pageLayout.bottomMargin}pt`,
                    paddingLeft: `${pageLayout.leftMargin}in`,
                    paddingRight: `${pageLayout.rightMargin}in`,
                    // CSS variables for element padding calculations
                    ...{ '--pl': `${pageLayout.leftMargin}in` } as React.CSSProperties,
                    ...{ '--pr': `${pageLayout.rightMargin}in` } as React.CSSProperties,
                    ...{ '--pw': `${pageLayout.pageWidth}in` } as React.CSSProperties,
                    ...{ '--ptop': `${pageLayout.topMargin}pt` } as React.CSSProperties,
                    /* v4.72: the header line (half the top margin) — the page
                       number's resting line, read by .page-sep-header. */
                    ...{ '--phm': `${pageLayout.headerMargin ?? 36}pt` } as React.CSSProperties,
                  }}
                >
                  {/* Page break separators — absolutely positioned, full page width */}
                  {overlays.map((ov) => {
                    const hContent = pageLayout.headerContent || DEFAULT_HEADER_CONTENT;
                    const fContent = pageLayout.footerContent || DEFAULT_FOOTER_CONTENT;
                    const hStart = pageLayout.headerStartPage ?? 2;
                    const fStart = pageLayout.footerStartPage ?? 1;
                    const { documentTitle: docTitle, revisionColor: revColor, pageCount: totalPages } = useEditorStore.getState();
                    // v5.40: a custom page is unnumbered — the break OPENING
                    // one shows no header, and the break AFTER one shows no
                    // footer (there is no number for it to print).
                    const showHeader = ov.pageNumber >= hStart && !ov.isTitlePage && !ov.isCustomPage;
                    // The footer belongs to the page BEFORE this break (ov.pageNumber - 1).
                    // For the title-page break that previous page IS the title page, which
                    // is unnumbered and carries no header/footer.
                    const footerPage = ov.pageNumber - 1;
                    const showFooterForPrev = footerPage >= fStart && !ov.isTitlePage && !ov.afterCustomPage;
                    if (viewStyle === 'continuous' && !previewMode) {
                      return (
                        <div
                          /* v5.40: custom-page breaks share their pageNumber
                             with the next script page — the top makes the
                             key unique */
                          key={`${ov.pageNumber}@${Math.round(ov.top)}`}
                          className="page-sep page-sep-line"
                          style={{ top: `${ov.top}px` }}
                        >
                          <span className="page-sep-line-label">{ov.isCustomPage ? 'Custom Page' : `Page ${ov.pageNumber}`}</span>
                        </div>
                      );
                    }
                    return (
                    <div
                      key={`${ov.pageNumber}@${Math.round(ov.top)}`}
                      className="page-sep"
                      style={{ top: `${ov.top}px` }}
                    >
                      <div className="page-sep-bottom" style={{ height: `${pageLayout.bottomMargin}pt`, position: 'relative' }}>
                        {ov.isDialogueSplit && moresContds.dialogueBreakContd && (
                          <div className="page-sep-more">{moresContds.moreText}</div>
                        )}
                        {showFooterForPrev && (fContent.left || fContent.center || fContent.right) && (
                          <div className="page-sep-footer">
                            <span className="page-sep-hf-left">{resolveHFFields(fContent.left, footerPage, totalPages, docTitle, revColor)}</span>
                            <span className="page-sep-hf-center">{resolveHFFields(fContent.center, footerPage, totalPages, docTitle, revColor)}</span>
                            <span className="page-sep-hf-right">{resolveHFFields(fContent.right, footerPage, totalPages, docTitle, revColor)}</span>
                          </div>
                        )}
                      </div>
                      <div className="page-sep-gap" />
                      <div className="page-sep-top" style={{ height: `${pageLayout.topMargin}pt` }}>
                        {showHeader && (
                          <div className="page-sep-header">
                            <span className="page-sep-hf-left">{resolveHFFields(hContent.left, ov.pageNumber, totalPages, docTitle, revColor)}</span>
                            <span className="page-sep-hf-center">{resolveHFFields(hContent.center, ov.pageNumber, totalPages, docTitle, revColor)}</span>
                            <span className="page-sep-hf-right">{resolveHFFields(hContent.right, ov.pageNumber, totalPages, docTitle, revColor)}</span>
                          </div>
                        )}
                      </div>
                      {ov.isDialogueSplit && ov.characterName && moresContds.dialogueBreakContd && (
                        <div className="page-sep-contd">
                          {ov.characterName} <span style={{ textTransform: 'none' }}>{moresContds.contdText}</span>
                        </div>
                      )}

                    </div>
                    );
                  })}

                  {/* Last page footer — no page break follows the last page, so render its footer separately */}
                  {(() => {
                    const fContent = pageLayout.footerContent || DEFAULT_FOOTER_CONTENT;
                    const fStart = pageLayout.footerStartPage ?? 1;
                    const { documentTitle: docTitle, revisionColor: revColor, pageCount: totalPages } = useEditorStore.getState();
                    const lastPage = overlays.length > 0
                      ? overlays[overlays.length - 1].pageNumber
                      : 1;
                    const showFooter = lastPage >= fStart && (fContent.left || fContent.center || fContent.right);
                    if (!showFooter) return null;
                    return (
                      <div
                        className="page-sep"
                        style={{ top: `${lastPageEnd}px` }}
                      >
                        <div className="page-sep-bottom" style={{ height: `${pageLayout.bottomMargin}pt`, position: 'relative' }}>
                          <div className="page-sep-footer">
                            <span className="page-sep-hf-left">{resolveHFFields(fContent.left, lastPage, totalPages, docTitle, revColor)}</span>
                            <span className="page-sep-hf-center">{resolveHFFields(fContent.center, lastPage, totalPages, docTitle, revColor)}</span>
                            <span className="page-sep-hf-right">{resolveHFFields(fContent.right, lastPage, totalPages, docTitle, revColor)}</span>
                          </div>
                        </div>
                      </div>
                    );
                  })()}

                  <EditorContent editor={editor} />
                </div>
              </div>
              </div>
            </div>
            </>
          )}
        </div>
        {!isHistoryMode && (tagsPanelOpen || locationDatabaseOpen) && (
          <div className="panel-resize-handle" onPointerDown={(e) => handleResizePointerDown('right', e)} style={{ touchAction: 'none' }} />
        )}
        {!isHistoryMode && <TempToolWindow editor={editor} scrollContainer={editorMainEl} />}
        {/* v4.33: the script-note edit popover, anchored on its highlight
            (portalled — renders nothing until notePopoverId is set). */}
        {!isHistoryMode && <ScriptNotePopover editor={editor} />}
        {!isHistoryMode && <MarkupPopover editor={editor} />}
        <DesignPanel />
        {!isHistoryMode && shelfOpen && <ToolDock side="right" editor={editor} scrollContainer={editorMainEl} />}
        {!isHistoryMode && !shelfOpen && !previewMode && (
          <button
            className="fs-panel-expand fs-panel-expand-right"
            title="Expand the right panel"
            onClick={toggleShelf}
          ><DoubleChevronIcon towards="left" /></button>
        )}
        {!isHistoryMode && <LocationDatabase editor={editor} style={{ width: rightPanelWidth, minWidth: rightPanelWidth }} />}
        {!isHistoryMode && pluginRegistry.getPanels('right-sidebar').map((p) => (
          <p.component key={p.id} editor={editor} />
        ))}
      </div>
      {!isHistoryMode && (
        <div style={{ display: 'flex', alignItems: 'center', width: '100%' }}>
          <StatusBar editorDoc={editor?.getJSON()} />
          {pluginRegistry.getPanels('status-bar').map((p) => (
            <p.component key={p.id} />
          ))}
        </div>
      )}
      {!isHistoryMode && <SearchReplace editor={editor} />}
      {!isHistoryMode && <GoToPage onGoToPage={handleGoToPage} />}
      <ZoomPanel />
      {!isHistoryMode && pickerState.visible && (
        <ElementPicker
          position={pickerState.position}
          defaultType={pickerState.defaultType}
          availableTypes={pickerState.availableTypes}
          suggestType={pickerState.suggestType}
          prevScriptType={pickerState.prevScriptType}
          onSelect={handlePickerSelect}
          onDismiss={handlePickerDismiss}
        />
      )}
      {!isHistoryMode && charAutoState.visible && !pickerState.visible && (
        <CharacterAutocomplete
          position={charAutoState.position}
          suggestions={charAutoState.suggestions}
          onSelect={handleCharAutoSelect}
          onDismiss={handleCharAutoDismiss}
        />
      )}
      {/* Context menu on mobile: 3-finger touch only */}
      {!isHistoryMode && ctxMenuState.visible && editor && (
        <ScriptContextMenu
          editor={editor}
          position={ctxMenuState.position}
          spellInfo={ctxMenuState.spellInfo}
          grammarInfo={ctxMenuState.grammarInfo}
          onClose={handleCtxMenuClose}
          onOpenFormatPanel={() => {
            // Block opening if element disallows all format overrides
            if (editor) {
              const tpl = useFormattingTemplateStore.getState().getActiveTemplate();
              if (tpl.mode === 'enforce') {
                const rule = getCurrentElementRule(editor, tpl);
                if (rule && !rule.allowFormatOverride) return;
              }
            }
            setFormatPanelOpen(true);
          }}
          overrideSelection={ctxMenuState.savedSelection}
        />
      )}
      {!isHistoryMode && formatPanelOpen && editor && (
        <FormatPanel editor={editor} onClose={() => setFormatPanelOpen(false)} />
      )}
      {/* Suppressed while the docked Spelling & Grammar panel is mounted — it
          owns the checker; rendering both produced two windows (v0.63 bug). */}
      {!isHistoryMode && spellModalOpen && !spellPanelMounted && editor && (
        <SpellCheckModal
          editor={editor}
          onClose={() => setSpellModalOpen(false)}
        />
      )}
      {/* Same suppression as the spell modal above: the docked panel's
          Suggestions tab owns the checker while mounted (v1.63). */}
      {!isHistoryMode && grammarModalOpen && !grammarPanelMounted && editor && (
        <WritingSuggestionsModal
          editor={editor}
          onClose={() => setGrammarModalOpen(false)}
        />
      )}
      {!isHistoryMode && grammarRulesPanelOpen && (
        <GrammarRulesPanel onClose={() => setGrammarRulesPanelOpen(false)} />
      )}
      {!isHistoryMode && currentProject && <AssetManager projectId={currentProject.id} />}
      {!isHistoryMode && openFileOpen && (
        /* v7.23: no onBrowseLocal — File ▸ Open is the file explorer now, so
           the button this fed is gone from the window. */
        <OpenFile
          onOpen={handleOpenFile}
          onClose={() => setOpenFileOpen(false)}
        />
      )}
      {!isHistoryMode && showWelcome && <WelcomeDialog onChoice={handleWelcomeChoice} />}
      {!isHistoryMode && saveAsOpen && (
        <SaveAsDialog
          /* v1.17: prefill the script's NAME. 'First Draft' was the old model leaking
             through — that's a draft label, not what the work is called. */
          defaultFileName={useEditorStore.getState().documentTitle || 'Untitled'}
          defaultDestination={
            currentProject && useProjectStore.getState().isCloudProject(currentProject.id)
              ? 'cloud'
              : 'local'
          }
          onSaved={handleSaveAsComplete}
          onOpenSaveLocations={() => useEditorStore.getState().openPreferences('saveloc')}
          onClose={() => setSaveAsOpen(false)}
          buildContent={buildSaveContent}
          /* v1.34: Draft is one value everywhere — an edit committed in the
             Save dialog updates the store AND the title page draft line,
             silently (no toast mid-save). */
          onDraftCommitted={async (label) => {
            const { applyDraftNumber } = await import('./SetDraftDialog');
            applyDraftNumber(editor, label, { toast: false });
          }}
        />
      )}
      {!isHistoryMode && compareVersionOpen && (
        <CompareVersionPicker
          onSelect={handleCompareVersionSelect}
          onClose={() => setCompareVersionOpen(false)}
        />
      )}
      {!isHistoryMode && titlePageEditorOpen && editor && (
        <TitlePageEditor
          editor={editor}
          onClose={() => setTitlePageEditorOpen(false)}
        />
      )}
      {!isHistoryMode && moresContdsOpen && (
        <MoresContdsDialog onClose={() => setMoresContdsOpen(false)} />
      )}
      <input
        ref={imageFileInputRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={handleImageFileChange}
      />
    </div>
  );
};

export default ScreenplayEditor;
