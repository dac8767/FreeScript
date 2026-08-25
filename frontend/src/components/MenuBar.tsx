import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import CustomizePanelsDialog from './CustomizePanelsDialog';
import { labelWithNote, NOTE_IN_DEVELOPMENT, NOTE_FORMAT_LOCKED } from '../menu/menuLabel';
import { workspaceIsDirty } from '../stores/slices/workspacesSlice';
import AddCustomPageDialog from './AddCustomPageDialog';
import { MarkupIcon } from './markupIcons';
import { iconLabel as markupIconLabel } from './MarkupPickers';
import EditElementsDialog from './EditElementsDialog';
import { SaveWorkspaceDialog, EditWorkspacesDialog } from './WorkspaceDialogs';
import PreferencesDialog from './PreferencesDialog';
import { PresetsDialog } from './PresetsPanel';
import type { PresetPartId } from '../utils/presets';
import SetDraftDialog from './SetDraftDialog';
import NewScriptDialog, { type NewScriptMeta } from './NewScriptDialog';
import NewScriptLauncher from './NewScriptLauncher';
import GuidedSetupDialog from './GuidedSetupDialog';
import RenameDialog from './RenameDialog';
import HelpReferenceDialog from './HelpReferenceDialog';
import { ALL_TOOLS, availableTools } from './ToolDock';

/** Project menu: script structure / story elements / project management. */
const PROJECT_MENU_GROUPS: string[][] = [
  // v6.14, Derek's menu reorg: the Project menu's window list, his order.
  ['navigator', 'pages', 'scenes', 'locations', 'characters', 'fragments'],
];
/** Tools menu (v6.14, Derek's menu reorg — his order; Spelling & Grammar's
 *  submenu and the Thesaurus are appended after these in the menu itself,
 *  under Help ▸ Developer now). */
const TOOL_MENU_GROUPS: string[][] = [
  ['beatboard', 'sticky', 'notebook', 'markups', 'goals', 'typewriter', 'analytics'],
];
/* (v6.10: the v1.83 Format ▸ Highlighting palette is GONE — highlighting is
   the Annotations tool's job now. The `highlight` MARK stays registered so
   scripts saved with old-style highlights still render them.) */
import { createPortal } from 'react-dom';
import { Editor } from '@tiptap/react';
import { smartUndo, smartRedo, useEditorStore, DEFAULT_PAGE_LAYOUT } from '../stores/editorStore';
import { useProjectStore } from '../stores/projectStore';
import { api } from '../services/api';
import { showToast } from './Toast';
import { DiagnosticsDialog } from './DiagnosticsDialog';
import { AboutDialog } from './AboutDialog';
import { ChangelogDialog } from './ChangelogDialog';
import { useBookmarkStore, bookmarkScriptKey } from '../stores/bookmarkStore';
import { openInBrowser, DONATE_URL } from '../services/external';
import { downloadFDX } from '../utils/fdxExporter';
import { downloadFountain } from '../utils/fountainExporter';
import { exportPDF } from '../utils/pdfExporter';
import { downloadDocx } from '../utils/docxExporter';
import { downloadOdraft } from '../utils/odraftFormat';
import { SCRIPT_EXT } from '../utils/scriptFileExt';
import { trackChangesPluginKey } from '../editor/trackChanges';
import PageSetupDialog from './PageSetupDialog';
import TemplateSelectDialog from './TemplateSelectDialog';
import ScriptFormatPickerDialog from './ScriptFormatPickerDialog';
import { useFormattingTemplateStore } from '../stores/formattingTemplateStore';
import { applyScriptFormat } from '../utils/applyScriptFormat';
import { getCurrentElementRule, getLockedFormatting } from '../utils/effectiveFormatting';
import { pluginRegistry } from '../plugins/registry';
import { LuSearch, LuZoomIn } from 'react-icons/lu';
import { MENU_ICONS, CirclePlusIcon, CircleMinusIcon, GearIcon } from './uiIcons';
import { useScrapbookMenus } from './NotebookTool';
import { FaTable, FaImage as FaImageIcon, FaChevronRight, FaChevronDown } from 'react-icons/fa';
import { chromePx, chromeScaleFactor } from './chromeSizes';
import GapHandle from './GapHandle';
import { syncNativeMenu, uninstallNativeMenu } from '../menu/nativeMenuSync';
import { isTauri as isTauriEnv } from '../services/platform';
import { eventToCombo, COMMAND_BY_ID, formatCombo } from './shortcuts';
import { useShortcutStore } from '../stores/shortcutStore';
import { useThemeStore } from '../stores/themeStore';
import { BUILTIN_THEMES } from './themes';
import { mirrorSnapshot } from '../services/saveLocations';
import { useSettingsStore } from '../stores/settingsStore';
import { clearEditorHistory } from '../editor/clearHistory';
import { importWorkspacesFromFile } from '../utils/workspaceImport';
import { reportSaveError } from '../stores/saveErrorStore';
import type { MenuSection as PluginMenuSection } from '../plugins/registry';
import {
  FaExternalLinkAlt,
  FaFile,
  FaFileImport,
  FaFolderOpen,
  FaSave,
  FaFileExport,
  FaFileCode,
  FaFilePdf,
  FaFileWord,
  FaCodeBranch,
  FaPrint,
  FaUndo,
  FaRedo,
  FaCut,
  FaCopy,
  FaPaste,
  FaMousePointer,
  FaTextHeight,
  FaHashtag,
  FaSpellCheck,
  FaListOl,
  FaBold,
  FaItalic,
  FaUnderline,
  FaStrikethrough,
  FaAlignLeft,
  FaAlignCenter,
  FaAlignRight,
  FaAlignJustify,
  FaColumns,
  FaFileAlt,
  FaImage,
  FaAdjust,
  FaBars,
  FaInfoCircle,
  FaArrowUp,
  FaKeyboard,
  FaStethoscope,
  FaSlidersH,   // v7.33: Help ▸ Developer ▸ Design… — the same icon the tool rail gives it
  FaUpload,
  FaHistory,
  FaExchangeAlt,
  FaListUl,
  FaToggleOn,
  FaLock,
  FaFileSignature,
  FaRegClone, FaStream,   FaEdit, FaRegEdit,
  FaTags,
  FaMarker, FaRegEyeSlash, FaRegEye, FaCheck, FaWrench,
  FaBug,
  FaRulerHorizontal,
  FaPencilAlt, FaCoffee, FaBoxOpen,
  FaRegFileAlt,
  FaClock,
} from 'react-icons/fa';
import { useScriptImport } from '../hooks/useScriptImport';
import { requestUpdateCheck } from './UpdateBanner';
import { useSaveGuard } from '../hooks/useSaveGuard';

/** v2.98: the Help-menu form links, shared by the menu items and the
 *  ribbon-pinnable commands — one place for each URL. */

/* v3.08, Derek: the donation link at the end of Help. Opens the Buy Me a
 * Coffee page in the DEFAULT browser — the BMC widget script is a remote
 * CDN embed, which a native menu can't render and the desktop app
 * shouldn't load (same rule as the dictionary CDN in §open items).
 * v3.12: opener + URL live in services/external.ts, shared with the
 * titlebar's donate button. */

interface MenuBarProps {
  editor: Editor | null;
}

/**
 * v7.58, Derek: "for these grayed out items, show 'This feature is still in
 * development' when hovering over them with the cursor."
 *
 * ONE sentence, so the three items that share this reason cannot drift into
 * three wordings. It is only for a feature that ISN'T BUILT YET. An item
 * greyed because the document is in the wrong state — Lock Scene Numbers with
 * scene numbers turned off — is not in development, and telling the reader it
 * is would send them away from a setting they could turn on right now. Those
 * say what state they need instead.
 */
export const IN_DEVELOPMENT = 'This feature is still in development.';

/**
 * The other reason a menu item sits gray: the script's format template is in
 * Enforce mode and this element does not allow overrides. v7.58 — with hover
 * restored, these were the items left silent while the ones beside them
 * explained themselves, and "why is Bold gray" is the question they invite.
 */
export const FORMAT_LOCKED = '';


interface MenuItem {
  label: string;
  shortcut?: string;
  action?: () => void;
  separator?: boolean;
  disabled?: boolean;
  /** v7.06: hover text. Its reason for existing is a DISABLED item that should
   *  say why it is disabled rather than just sitting there gray.
   *
   *  v7.58: it finally SHOWS — the disabled CSS carried pointer-events: none,
   *  so the browser never delivered the hover a native tooltip needs, and not
   *  one of these had ever been seen.
   *
   *  Named `tooltip`, not `title`. On a DOM element `title` means hover text;
   *  on a data object it almost always means a HEADING — two of the fourteen
   *  `title:` sites in this file are the document's name. The helper-text
   *  harvester has to tell the two apart to list these in the Helper Text
   *  window, and a name that means one thing is how it does that. */
  tooltip?: string;
  /** v7.68 — the reason, SHORT, shown in the label itself.
   *
   *  `tooltip` is hover text, and hover text does not exist in a native macOS
   *  menu: nativeMenuSync hands Tauri a text/enabled/accelerator/checked
   *  triple and Tauri's menu API has no tooltip field to hand it (NSMenuItem
   *  has toolTip; Tauri does not expose it). So on Derek's Mac — which runs
   *  the NATIVE menu — every disabled item has been grey and mute since v7.06,
   *  no matter how many render paths passed `title` through. He reported it
   *  twice.
   *
   *  A label is the only channel both menus share, so the reason goes there.
   *  Keep it to two or three words: it renders as "Revision Mode (in
   *  development)". The fuller `tooltip` still shows on hover in-app. */
  note?: string;
  children?: MenuItem[];
  /** v2.62: custom submenu content (e.g. the Scrapbook's table-size grid).
   *  Rendered inside the submenu flyout instead of a children list; `close`
   *  shuts the whole menu after the content commits its action. */
  render?: (close: () => void) => React.ReactNode;
  icon?: React.ReactNode;
  /** v3.05, Derek: checkable items set this (true OR false) instead of
   *  prefixing '✓ ' to the label. Any list containing a checkable item
   *  reserves a left check column so labels stay aligned (macOS style);
   *  the native bar renders these as real CheckMenuItems. */
  checked?: boolean;
}

interface MenuSection {
  label: string;
  items: MenuItem[];
}

const MenuBar: React.FC<MenuBarProps> = ({ editor }) => {
  const [activeMenu, setActiveMenu] = useState<string | null>(null);
  const [openSubmenu, setOpenSubmenu] = useState<string | null>(null);
  // v4.28, Derek: the menus ALWAYS live in the macOS menu bar on desktop —
  // the in-window menu system and its setting are gone; there is no other
  // option. A plain-browser session (dev) still renders the in-window bar,
  // because there is no native bar for it to live in.
  const nativeMenus = isTauriEnv();
  const menuRef = useRef<HTMLDivElement>(null);
  // Platform-aware modifier key symbol for shortcut labels
  const mod = /mac|iphone|ipad|ipod/i.test(navigator.platform || navigator.userAgent) ? '⌘' : 'Ctrl+';
  const {
    menuBarOrder, menuBarHidden,
    previewMode,
    outlineBarOpen, setOutlineBarOpen,
    rulersVisible,
    markupsVisible, setMarkupsVisible,
    markupHiddenIcons, setMarkupHiddenIcons,
    markupScriptDone, setMarkupScriptDone,
    viewStyle, setViewStyle,
    /* v7.06: Revision Mode is disabled in the menu (in development), so the
       store bindings are not read here any more. */
    documentTitle,
    pageLayout,
    setSearchOpen,
    setGoToPageOpen,
    spellCheckEnabled,
    toggleSpellCheck,
    setSpellModalOpen,
    grammarCheckEnabled,
    toggleGrammarCheck,
    setGrammarModalOpen,
    setGrammarRulesPanelOpen,
    setOpenFileOpen,
    setSaveAsOpen,
    theme,
    setTheme,
    workspaces,
    workspaceOrder,
    workspacesHidden,
    activeWorkspace,
    saveWorkspace,
    applyWorkspace,
    menuMode,
    chromeCustomPx,
    chromeGapPx,
    navigatorOpen,
    toggleNavigator,
    shelfOpen,
    toggleShelf,
    uiResizeLocked,
    zoomLevel,
    setZoomLevel,
    navPanelWidth,
    trackChangesEnabled,
    setTrackChangesEnabled,
    setTrackChangesLabel,
    setCompareVersionOpen,
    sceneNumbersVisible,
    setSceneNumbersVisible,
    sceneNumbersLocked,
    setSceneNumbersLocked,
  } = useEditorStore();
  /* v7.65: the SAME dirty test the Workspaces tool reads, so the menu's two
     workspace actions and the tool's two buttons can never disagree about
     whether there is anything to save or reset. */
  const workspaceDirty = useEditorStore(workspaceIsDirty);

  // v5.28: the View ▸ Annotations submenu lists only types the script uses
  // (plus any already-hidden pick, so it can always be turned back on).
  const markupList = useEditorStore((s) => s.markups);
  const annotationTypesInUse = useMemo(
    () => [...new Set([...markupList.map((m) => m.icon), ...markupHiddenIcons])],
    [markupList, markupHiddenIcons],
  );

  const {
    currentProject,
    currentScriptId,
    setCurrentProject,
    setCurrentScriptId,
    setScripts,
  } = useProjectStore();

  /* v7.43: Save, Save As and the unsaved-changes guard moved to
     hooks/useSaveGuard — one unit because the three only make sense together,
     and it reads the stores itself rather than being handed state MenuBar
     would only be subscribing to in order to pass on. */
  const {
    buildSaveContent, handleSave, handleSaveAs, confirmOrRun,
    discardConfirmOpen, handleDiscardConfirmSave,
    handleDiscardConfirmDiscard, handleDiscardConfirmCancel,
  } = useSaveGuard(editor);

  // ── Page Setup ──
  const [pageSetupOpen, setPageSetupOpen] = useState(false);
  // v6.05: Insert ▸ Custom Page… asks WHERE (the caret lied — see the item).
  const [addPageOpen, setAddPageOpen] = useState(false);
  const [customizeOpen, setCustomizeOpen] = useState(false);
  // v4.79: the Presets window (File ▸ Import/Export ▸ Presets…).
  /* v7.28: the preset window's open state is the STORE's request bus, not a
     local flag — every export door in the app opens this one window, and a
     door in another component cannot reach a useState in here. (Same lesson
     as v7.24's prefsOpen: two sources meant nothing outside could close it.) */
  const presetExportRequest = useEditorStore((s) => s.presetExportRequest);
  // v6.02, Derek: no tab passed = the window opens on its remembered last
  // tab. Only the targeted doors (Customize Themes…, …Elements…, the
  // context-menu door) still steer it.
  const [customizeTab, setCustomizeTab] =
    useState<'toolbar' | 'panels' | 'elements' | 'themes' | 'context' | null>(null);
  const openCustomize = (tab?: NonNullable<typeof customizeTab>) => {
    setCustomizeTab(tab ?? null);
    setCustomizeOpen(true);
  };
  /* v6.83, Derek: Settings ▸ Customize ▸ Toolbar hands over to THIS window
     (the live on-ribbon editing needs the bar visible; the Settings modal
     covers it). The event carries the tab to land on. */
  useEffect(() => {
    const onOpenCustomize = (e: Event) => {
      const tab = (e as CustomEvent).detail as NonNullable<typeof customizeTab> | undefined;
      setCustomizeTab(tab ?? null);
      setCustomizeOpen(true);
    };
    window.addEventListener('scriptcraft:open-customize', onOpenCustomize);
    return () => window.removeEventListener('scriptcraft:open-customize', onOpenCustomize);
  }, []);
  /* v7.24: the Settings window's open state is ONE thing — the store's
     preferencesRequest. It used to be two (a local prefsOpen OR'd with the
     request bus), which is why nothing outside this component could close
     Settings: clearing the bus left the local flag holding it open. */
  const preferencesRequest = useEditorStore((s) => s.preferencesRequest);
  const closePreferences = useEditorStore((s) => s.closePreferences);
  // v1.34: unfinished features (Collaboration, Lock Pages) hide from the menus
  // unless the Developer toggle shows them.
  const showUnreleasedTools = useEditorStore((s) => s.showUnreleasedTools);
  const setShowUnreleasedTools = useEditorStore((s) => s.setShowUnreleasedTools);
  const [draftDialogOpen, setDraftDialogOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [saveWorkspaceOpen, setSaveWorkspaceOpen] = useState(false);
  const [editWorkspacesOpen, setEditWorkspacesOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [knowledgeBaseOpen, setKnowledgeBaseOpen] = useState(false);
  const [templateSelectOpen, setTemplateSelectOpen] = useState(false);

  // ── Script-format preferences (multi-select) and per-script picker ──
  /* v7.81, Derek: "a new script will always show all options." The
     multi-select Script Format Preferences dialog (and its first-run gate)
     configured which formats the picker offered; with the filter gone it
     configured nothing, so the dialog, its menu door, its toolbar command and
     the enabledScriptFormats gate are all removed. The stored key stays in
     localStorage, unread — deleting it breaks nobody's saved backup. */
  const [formatPickerOpen, setFormatPickerOpen] = useState(false);

  // ── Per-attribute locking from active template ──
  const activeTemplate = useFormattingTemplateStore((s) => s.getActiveTemplate());
  // v0.71: element visibility/order come from the user's persisted overrides
  // applied over the active template (system templates are immutable).
  const pickableElements = useFormattingTemplateStore((st) => st.getPickableElements)();
  useFormattingTemplateStore((st) => st.elementHidden);   // re-render on change
  useFormattingTemplateStore((st) => st.elementOrder);
  const isEnforceMode = activeTemplate.mode === 'enforce';
  const editorRule = editor ? getCurrentElementRule(editor, activeTemplate) : null;
  const locked = getLockedFormatting(editorRule, isEnforceMode);

  // ── About / What's New ──
  const [aboutOpen, setAboutOpen] = useState(false);

  // ── Diagnostics (Help menu) — the dialog collects its own report on mount.
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);

  // ── Check in (git commit) ──
  const [changelogOpen, setChangelogOpen] = useState(false);
  const [editElementsOpen, setEditElementsOpen] = useState(false);
  const [checkinOpen, setCheckinOpen] = useState(false);
  const [checkinMessage, setCheckinMessage] = useState('');
  const [checkinSaving, setCheckinSaving] = useState(false);
  const checkinInputRef = useRef<HTMLInputElement>(null);

  const handleCheckinOpen = useCallback(() => {
    if (!currentProject) {
      showToast('This script hasn\'t been saved yet. Save it first.', 'error');
      return;
    }
    setCheckinMessage('');
    setCheckinOpen(true);
    setTimeout(() => checkinInputRef.current?.focus(), 100);
  }, [currentProject]);

  /* v6.72: the Snapshots window's Take Snapshot button arms a store flag —
     the dialog lives here, so it opens from here (one dialog, one flow). */
  const takeSnapshotRequest = useEditorStore((s) => s.takeSnapshotRequest);
  useEffect(() => {
    if (!takeSnapshotRequest) return;
    useEditorStore.getState().setTakeSnapshotRequest(false);
    handleCheckinOpen();
  }, [takeSnapshotRequest, handleCheckinOpen]);

  const handleCheckinSubmit = useCallback(async () => {
    if (!currentProject || !checkinMessage.trim()) return;
    setCheckinSaving(true);
    // Save first so the latest content is on disk
    if (editor && currentScriptId) {
      try {
        const content = buildSaveContent();
        await api.saveScript(currentProject.id, currentScriptId, { content });
      } catch (err) {
        console.error('Auto-save before checkin failed:', err);
        reportSaveError(err, 'manual-save');
        // Don't proceed with the check-in if we couldn't persist the latest
        // content — committing stale data would be worse than the failure.
        setCheckinSaving(false);
        return;
      }
    }
    try {
      const result = await api.checkin(currentProject.id, checkinMessage.trim());
      if (result.hash) {
        showToast(`Snapshot saved: ${result.short_hash}`, 'success');
        // v6.73: the open Snapshots window reloads on this tick — taking a
        // snapshot FROM that window must show it without close-and-reopen.
        useProjectStore.getState().bumpVersionsTick();
        const snapContent = buildSaveContent();
        if (snapContent) {
          void mirrorSnapshot({
            projectId: currentProject.id,
            projectName: currentProject.name,
            title: documentTitle || 'Untitled',
            content: snapContent,
            message: checkinMessage.trim(),
          });
        }
      } else {
        showToast(result.message || 'No changes since the last snapshot', 'success');
      }
    } catch (err) {
      showToast(`Snapshot failed: ${err instanceof Error ? err.message : 'unknown error'}`, 'error');
    } finally {
      setCheckinSaving(false);
      setCheckinOpen(false);
    }
  }, [editor, currentProject, currentScriptId, checkinMessage, buildSaveContent]);

  // ── Track Changes ──
  const clearTrackChanges = useCallback(() => {
    if (!trackChangesEnabled) return;
    setTrackChangesEnabled(false);
    setTrackChangesLabel('');
    if (editor) {
      const { tr } = editor.state;
      tr.setMeta(trackChangesPluginKey, { enabled: false, baseline: null });
      editor.view.dispatch(tr);
    }
  }, [editor, trackChangesEnabled, setTrackChangesEnabled, setTrackChangesLabel]);

  const handleTrackChangesToggle = useCallback(async () => {
    if (trackChangesEnabled) {
      clearTrackChanges();
      return;
    }

    if (!currentProject || !currentScriptId) {
      showToast('Save your script to a project first', 'error');
      return;
    }

    try {
      const versions = await api.getVersions(currentProject.id);
      if (versions.length === 0) {
        showToast('No snapshots yet — use File > Script History > Take Snapshot first', 'info');
        return;
      }

      const latest = versions[0];
      let scriptResp;
      try {
        scriptResp = await api.getScriptAtVersion(
          currentProject.id,
          latest.hash,
          currentScriptId,
        );
      } catch (innerErr) {
        // Script didn't exist at the last check-in (created after the last commit)
        const msg = innerErr instanceof Error ? innerErr.message : '';
        if (msg.includes('404')) {
          showToast('This script has no snapshot yet — use File > Script History > Take Snapshot first', 'info');
        } else {
          showToast('Could not load the latest snapshot. Try taking a snapshot first.', 'error');
        }
        return;
      }

      setTrackChangesEnabled(true);
      setTrackChangesLabel(latest.short_hash);

      if (editor) {
        const { tr } = editor.state;
        tr.setMeta(trackChangesPluginKey, {
          enabled: true,
          baseline: scriptResp.content,
        });
        editor.view.dispatch(tr);
      }
    } catch (err) {
      showToast('Could not load the snapshot history. Make sure the backend is running.', 'error');
    }
  }, [
    editor,
    currentProject,
    currentScriptId,
    trackChangesEnabled,
    setTrackChangesEnabled,
    setTrackChangesLabel,
  ]);

  // Pinned toolbar commands (Customize > Toolbar Layout) dispatch
  // 'scriptcraft:command'; the dialogs live here, so route them here.
  useEffect(() => {
    const onCmd = (e: Event) => {
      const id = (e as CustomEvent).detail as string;
      switch (id) {
        case 'customize': openCustomize(); break;   // v6.02: remembered tab
        case 'customizeContextMenu': openCustomize('context'); break;
        // v4.30 #3: hotkeys live in Settings now
        case 'customizeShortcuts': useEditorStore.getState().openPreferences('keys'); break;
        case 'setDraft': setDraftDialogOpen(true); break;
        case 'rename': setRenameOpen(true); break;
        case 'takeSnapshot': handleCheckinOpen(); break;
        case 'snapshots': useEditorStore.getState().openTool('history'); break;   // v6.74: the tool, not the old sidebar
        case 'compareSnapshot': setCompareVersionOpen(true); break;
        case 'trackChanges': handleTrackChangesToggle(); break;
        case 'spellCheck': setSpellModalOpen(true); break;
        case 'writingSuggestions': setGrammarModalOpen(true); break;
        // fitPage/fitWidth are OWNED by ScreenplayEditor's listener on this
        // same event — falling through to the map would re-dispatch the
        // event and recurse until the stack blows. Explicit no-ops here.
        case 'fitPage': case 'fitWidth': break;
        // v2.97, Derek: EVERY menu action is pinnable to the ribbon — any
        // command id the actions map knows resolves here, so the ribbon,
        // the menus and the keyboard all run the same closure. (Safe for
        // system-owned ids like selectAll: the KEYBOARD handler still
        // bails on owner==='system' before reaching the map.)
        default: shortcutActionsRef.current[id]?.(); break;
      }
    };
    window.addEventListener('scriptcraft:command', onCmd);
    return () => window.removeEventListener('scriptcraft:command', onCmd);
  }, [handleCheckinOpen, handleTrackChangesToggle]);

  const dropdownRef = useRef<HTMLDivElement | null>(null);

  // Capture the portal dropdown element via a callback ref on the portal
  useEffect(() => {
    if (activeMenu) {
      // The portal dropdown is the last .menu-dropdown in the body
      dropdownRef.current = document.body.querySelector(':scope > .menu-dropdown');
    } else {
      dropdownRef.current = null;
    }
  }, [activeMenu]);

  useEffect(() => {
    if (!activeMenu) return;
    // Only listen for outside clicks when a menu is open.
    // Delay registration so the opening click/touch doesn't immediately close it.
    let active = true;
    const timerId = setTimeout(() => {
      if (!active) return;
      const handleClose = (e: MouseEvent | TouchEvent) => {
        const target = e.target as Node;
        const inMenu = menuRef.current?.contains(target);
        const inDropdown = dropdownRef.current?.contains(target);
        if (!inMenu && !inDropdown) {
          setActiveMenu(null);
          setOpenSubmenu(null);
        }
      };
      document.addEventListener('mousedown', handleClose);
      document.addEventListener('touchstart', handleClose);
      cleanup = () => {
        document.removeEventListener('mousedown', handleClose);
        document.removeEventListener('touchstart', handleClose);
      };
    }, 10);
    let cleanup: (() => void) | null = null;
    return () => {
      active = false;
      clearTimeout(timerId);
      cleanup?.();
    };
  }, [activeMenu]);

  const setElement = (type: string) => {
    if (!editor) return;
    editor.chain().focus().setNode(type).run();
  };

  /* v7.44: the four import doors moved to hooks/useScriptImport — they share
     the same document-replacing reset, and an importer added beside only some
     of them is how one door forgets to clear something. The guard and
     clearTrackChanges are passed IN so there is one of each per screen. */
  const {
    handleImport, handleImportDocx, handleImportPdf,
    docxImportWarningOpen, setDocxImportWarningOpen, handleConfirmDocxImport,
  } = useScriptImport(editor, confirmOrRun, clearTrackChanges);

  /** Resets all per-script session state for a fresh new-screenplay,
   *  but does NOT seed editor content — caller picks the format and content. */
  /* v1.50: what the New Script dialog collected, applied when the reset runs.
     A ref (not state) because the format-picker flow between the dialog and
     the reset is asynchronous; every entry to New Script overwrites it. */
  const pendingNewScriptMeta = useRef<NewScriptMeta | null>(null);
  const [newScriptOpen, setNewScriptOpen] = useState(false);
  // v4.80: the four-way launcher, and the Guided wizard it can open.
  const [launcherOpen, setLauncherOpen] = useState(false);
  const [guidedOpen, setGuidedOpen] = useState(false);

  const resetForNewScreenplay = useCallback(() => {
    if (!editor) return;
    clearTrackChanges();
    clearEditorHistory(editor);
    setCurrentProject(null);
    setCurrentScriptId(null);
    setScripts([]);
    const store = useEditorStore.getState();
    const meta = pendingNewScriptMeta.current;
    pendingNewScriptMeta.current = null;
    store.setDocumentTitle(meta?.name || 'Untitled Script');
    store.setDraftLabel(meta?.draft || useSettingsStore.getState().defaultDraftLabel);
    store.setSpellCheckEnabled(useSettingsStore.getState().spellCheckByDefault);   // v1.60
    store.setSpellCheckChoice(null);   // v4.77: a new script starts unchosen
    store.setVersionLabel(meta?.version || '');
    store.setBeats([]);
    store.setBeatColumns([]);
    store.resetOutlineTabs();   // v2.30: start over on a single tab
    store.setBeatArrangeMode('auto');
    store.setNotes([]);
    store.setTags([]);
    store.setTagCategories([]);
    store.setCharacterProfiles([]);
    store.setCharacterRelationships([]);
    store.setReferredTags({});
    store.setScanResults(null);
    store.setScenes([]);
    store.setPageLayout({ ...DEFAULT_PAGE_LAYOUT });
    if (window.location.pathname !== '/') {
      window.history.replaceState(null, '', '/');
    }
  }, [editor, clearTrackChanges, setCurrentProject, setCurrentScriptId, setScripts]);

  /** Picker mode: 'reset' clears project context (top-level New Script);
   *  'apply-only' just applies the template, leaving the current project intact
   *  (used by ProjectView so the new script stays in the current project). */
  const [formatPickerMode, setFormatPickerMode] = useState<'reset' | 'apply-only'>('reset');

  /** Apply the chosen format (sets active template + seeds starter content). */
  const finishNewScreenplayWithFormat = useCallback((templateId: string, mode: 'reset' | 'apply-only' = 'reset') => {
    if (mode === 'reset') resetForNewScreenplay();
    applyScriptFormat(editor, templateId);
  }, [editor, resetForNewScreenplay]);

  /** Run the format-selection flow. Mode 'reset' is the global New Script
   *  action; 'apply-only' is invoked from in-project script creation, where the
   *  caller has already wired up project context. */
  const promptForNewScreenplayFormat = useCallback((mode: 'reset' | 'apply-only') => {
    if (!editor) return;
    setFormatPickerMode(mode);
    // v7.81: straight to the picker, which always offers every format.
    setFormatPickerOpen(true);
  }, [editor]);

  // v1.57: launch found nothing to open — show the New Script prompt.
  // No unsaved-work guard: this only fires on a fresh, empty session.
  const newScriptPromptRequest = useEditorStore((s) => s.newScriptPromptRequest);
  useEffect(() => {
    if (!newScriptPromptRequest || !editor) return;
    useEditorStore.getState().setNewScriptPromptRequest(false);
    setLauncherOpen(true);
  }, [newScriptPromptRequest, editor]);

  const handleNewScreenplay = useCallback(() => {
    // v1.50: New Script… asks for name/draft/version first; Create hands off
    // to the existing format flow. confirmOrRun is the existing unsaved-work
    // guard — it prompts to save before any of this if the doc is dirty.
    // v4.80, Derek: the LAUNCHER comes first — manual / guided / open /
    // import — and hands off to the right one.
    confirmOrRun(() => setLauncherOpen(true));
  }, [confirmOrRun]);

  // ProjectView sets pendingFormatPromptInProject=true before navigating into
  // the editor for a fresh in-project script. Consume it once on mount (or
  // when it becomes true) and prompt for a script format without touching the
  // project context ProjectView already wired up.
  const pendingFormatPromptInProject = useEditorStore((s) => s.pendingFormatPromptInProject);
  useEffect(() => {
    if (!pendingFormatPromptInProject || !editor) return;
    useEditorStore.getState().setPendingFormatPromptInProject(false);
    promptForNewScreenplayFormat('apply-only');
  }, [pendingFormatPromptInProject, editor, promptForNewScreenplayFormat]);

  // ── Global keyboard shortcuts (registry-driven, v0.77) ──
  // What each command DOES. The registry (shortcuts.ts) owns the key bindings;
  // this owns the behavior. Held in a ref so the capture-phase listener below
  // can be registered once and still call the current closures.
  /* v3.08/v3.25: Last Edit Location — shared by the Edit menu, the
   * keyboard map and the ribbon's pinned command. */
  const bookmarkKey = bookmarkScriptKey(currentScriptId);
  const jumpToLastEdit = () => {
    if (!editor) return;
    const pos = useBookmarkStore.getState().lastEdit[bookmarkKey];
    if (pos == null) { showToast('No edits recorded yet.', 'info'); return; }
    const max = editor.state.doc.content.size;
    const at = Math.max(1, Math.min(pos, max - 1));
    editor.chain().focus().setTextSelection(at).run();
    // Center the last-edit line in the viewport — Tiptap's own scrollIntoView
    // only nudges it barely into view. domAtPos → nearest element → center.
    requestAnimationFrame(() => {
      const { node } = editor.view.domAtPos(at);
      const el = (node instanceof HTMLElement ? node : node.parentElement) as HTMLElement | null;
      el?.scrollIntoView({ block: 'center', inline: 'nearest' });
    });
  };
  const shortcutActions: Record<string, () => void> = {
    lastEditLocation: jumpToLastEdit,
    newScreenplay: () => { handleNewScreenplay(); },
    openFile: () => { confirmOrRun(() => setOpenFileOpen(true)); },
    importLocal: () => { confirmOrRun(handleImport); },
    save: () => { handleSave(); },
    saveAs: () => { handleSaveAs(); },
    print: () => { void handlePrint(); },
    preview: () => useEditorStore.getState().setPreviewMode(true),
    exportPDF: () => { void handleExportPDF(); },
    exportFDX: () => { void handleExportFDX(); },
    exportFountain: () => { void handleExportFountain(); },
    exportDocx: () => { void handleExportDocx(); },
    rename: () => setRenameOpen(true),
    settings: () => useEditorStore.getState().openPreferences(),

    find: () => setSearchOpen(true),
    goToPage: () => setGoToPageOpen(true),

    zoomIn: () => setZoomLevel(Math.min(300, useEditorStore.getState().zoomLevel + 10)),
    zoomOut: () => setZoomLevel(Math.max(50, useEditorStore.getState().zoomLevel - 10)),
    actualSize: () => setZoomLevel(100),
    fitPage: () => window.dispatchEvent(new CustomEvent('scriptcraft:command', { detail: 'fitPage' })),
    fitWidth: () => window.dispatchEvent(new CustomEvent('scriptcraft:command', { detail: 'fitWidth' })),
    // v6.02, Derek: the ribbon Customize button opens on the remembered
    // last-used tab (superseding v4.22's fixed Editor-tab landing).
    customize: () => openCustomize(),

    bold: () => editor?.chain().focus(undefined, { scrollIntoView: false }).toggleBold().run(),
    italic: () => editor?.chain().focus(undefined, { scrollIntoView: false }).toggleItalic().run(),
    underline: () => editor?.chain().focus(undefined, { scrollIntoView: false }).toggleUnderline().run(),
    dualDialogue: () => (editor as unknown as { commands?: { toggleDualDialogue?: () => void } })?.commands?.toggleDualDialogue?.(),

    spellCheck: () => setSpellModalOpen(true),
    writingSuggestions: () => setGrammarModalOpen(true),
    takeSnapshot: () => handleCheckinOpen(),
    scriptHistory: () => useEditorStore.getState().openTool('history'),
    trackChanges: () => { void handleTrackChangesToggle(); },
    // v2.97: ribbon-pinnable Edit actions. Their SHORTCUTS stay with the OS
    // (the keyboard handler bails on system-owned ids); these closures run
    // only via menu clicks and ribbon buttons.
    cut: () => document.execCommand('cut'),
    copy: () => document.execCommand('copy'),
    paste: () => document.execCommand('paste'),
    selectAll: () => editor?.chain().focus().selectAll().run(),
    // v2.98, Derek: the REST of the menus — every remaining action becomes
    // ribbon-pinnable through the same bus. Pickers and dialogs with their
    // own flows (Workspaces, Theme, Element) stay menu-only.
    importDocx: () => { handleImportDocx(); },
    importPdf: () => { handleImportPdf(); },
    exportOdraft: () => { void handleExportOdraft(); },
    insertImage: () => useEditorStore.getState().imageInsertHandler?.(),
    insertMarker: () => insertOutlineLine('⚑ '),
    showRulers: () => { const s = useEditorStore.getState(); s.setRulersVisible(!s.rulersVisible); },
    grammarSettings: () => setGrammarRulesPanelOpen(true),
    about: () => setAboutOpen(true),
    keyboardShortcuts: () => setShortcutsOpen(true),
    knowledgeBase: () => setKnowledgeBaseOpen(true),
    changelog: () => setChangelogOpen(true),
    feedback: () => useEditorStore.getState().openTool('feedback'),
  };
  const shortcutActionsRef = useRef(shortcutActions);
  // Menu items display the EFFECTIVE binding, so a rebound (or cleared)
  // shortcut is reflected in the menus instead of showing a stale default.
  const keyBindings = useShortcutStore((st) => st.bindings);

  // View > Theme is driven by the theme store: user order, hidden themes
  // removed, custom themes included alongside the built-ins.
  const customThemes = useThemeStore((st) => st.customThemes);
  const hiddenThemes = useThemeStore((st) => st.hiddenThemes);
  const allThemeIds = useThemeStore((st) => st.allThemeIds);
  const visibleThemes = allThemeIds()
    .filter((id) => !hiddenThemes.includes(id))
    .map((id) => ({
      id,
      label: BUILTIN_THEMES.find((b) => b.id === id)?.label
        ?? customThemes.find((c) => c.id === id)?.label
        ?? id,
    }));
  const sc = (id: string) => formatCombo(keyBindings[id] ?? null) || undefined;

  shortcutActionsRef.current = shortcutActions;
  const editorRef = useRef(editor);
  editorRef.current = editor;

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const combo = eventToCombo(e);
      if (!combo) return;

      // Which command owns this combo right now (default or user-rebound)?
      const bindings = useShortcutStore.getState().bindings;
      const id = Object.keys(bindings).find((k) => bindings[k] === combo);
      if (!id) return;

      const cmd = COMMAND_BY_ID[id];
      /* v6.77, Derek: "using Undo button or ctrl+Z / cmd+Z should undo
         changes made in windows as well." Outside a text field NOTHING
         handled ⌘Z in the browser build (TipTap only sees it with editor
         focus; the desktop's native Edit menu already routes to smartUndo)
         — so the reset he tried to take back was unreachable. Route it to
         smartUndo/smartRedo, which pick the newest lane: window action,
         beat edit, or the script. Inside inputs, textareas and the editor
         itself the native/TipTap pipeline keeps the key. */
      if (id === 'undo' || id === 'redo') {
        const t = e.target as HTMLElement | null;
        if (t && t.closest('input, textarea, [contenteditable="true"]')) return;
        e.preventDefault();
        e.stopPropagation();
        if (id === 'undo') smartUndo(editorRef.current); else smartRedo(editorRef.current);
        return;
      }
      // Cut/Copy/Paste/Select All belong to the OS and the browser's
      // native edit pipeline — let them through untouched.
      if (!cmd || cmd.owner === 'system') return;

      const run = shortcutActionsRef.current[id];
      if (!run) return;

      // Editor-owned commands (Bold, etc.) also live in TipTap's keymap. We run
      // in the CAPTURE phase and stop propagation so exactly one handler fires:
      // without this, a rebound Bold would still respond to the old Mod+B (via
      // TipTap) *and* the new combo, and on the default key both would run.
      e.preventDefault();
      e.stopPropagation();
      run();
    };
    window.addEventListener('keydown', handler, true);   // capture: beat TipTap
    return () => window.removeEventListener('keydown', handler, true);
  }, []);

  const handleExportFDX = useCallback(async () => {
    if (!editor) return;
    try {
      const s = useEditorStore.getState();
      await downloadFDX(editor.getJSON(), documentTitle, s.characterProfiles, s.tagCategories, s.tags, s.beats, s.beatColumns, s.pageLayout);
    } catch (err) {
      console.error('FDX export failed:', err);
      showToast(`Export failed: ${err instanceof Error ? err.message : String(err)}`, 'error');
    }
  }, [editor, documentTitle]);

  const handleExportFountain = useCallback(async () => {
    if (!editor) return;
    try {
      await downloadFountain(editor.getJSON(), documentTitle);
    } catch (err) {
      console.error('Fountain export failed:', err);
      showToast(`Export failed: ${err instanceof Error ? err.message : String(err)}`, 'error');
    }
  }, [editor, documentTitle]);

  /* v6.29, Derek: Print renders the SAME exact-layout PDF the exporter
     makes and opens it with the print dialog queued — window.print() let
     the OS shrink the page inside its own printer margins (WKWebView
     ignores our zero @page margins). Falls back to window.print() only if
     the PDF path itself throws. */
  const handlePrint = useCallback(async () => {
    if (!editor) { window.print(); return; }
    try {
      const store = useEditorStore.getState();
      await exportPDF(editor.getJSON(), documentTitle, pageLayout, {
        sceneNumbersVisible: store.sceneNumbersVisible,
        documentTitle: store.documentTitle,
        revisionColor: store.revisionMode ? store.revisionColor : '',
        print: true,
      });
    } catch (err) {
      console.error('Print via PDF failed:', err);
      window.print();
    }
  }, [editor, documentTitle, pageLayout]);

  const handleExportPDF = useCallback(async () => {
    if (!editor) return;
    try {
      const store = useEditorStore.getState();
      await exportPDF(editor.getJSON(), documentTitle, pageLayout, {
        sceneNumbersVisible: store.sceneNumbersVisible,
        documentTitle: store.documentTitle,
        revisionColor: store.revisionMode ? store.revisionColor : '',
      });
    } catch (err) {
      console.error('PDF export failed:', err);
      showToast(`Export failed: ${err instanceof Error ? err.message : String(err)}`, 'error');
    }
  }, [editor, documentTitle, pageLayout]);

  const handleExportDocx = useCallback(async () => {
    if (!editor) return;
    try {
      const store = useEditorStore.getState();
      await downloadDocx(editor.getJSON(), documentTitle, pageLayout, {
        documentTitle: store.documentTitle,
        revisionColor: store.revisionMode ? store.revisionColor : '',
      });
    } catch (err) {
      console.error('Word export failed:', err);
      showToast(`Export failed: ${err instanceof Error ? err.message : String(err)}`, 'error');
    }
  }, [editor, documentTitle, pageLayout]);

  const handleExportOdraft = useCallback(async () => {
    if (!editor) return;
    try {
      const store = useEditorStore.getState();
      const meta = {
        id: '', title: documentTitle, author: '', format: 'json',
        created_at: '', updated_at: '', page_count: store.pageCount,
        size_bytes: 0, color: '', pinned: false, sort_order: 0, preview: '',
      };
      // Ship the custom themes inside the project so another ScriptCraft can
      // import them (Customize > Themes > Import Themes from a Project).
      await downloadOdraft(meta, editor.getJSON(), useThemeStore.getState().customThemes);
    } catch (err) {
      console.error('ScriptCraft export failed:', err);
      showToast(`Export failed: ${err instanceof Error ? err.message : String(err)}`, 'error');
    }
  }, [editor, documentTitle]);

  // v4.35 batch-v9 #8: the import flow moved to utils/workspaceImport so the
  // Workspaces WINDOW offers it too \u2014 one implementation, two entry points.
  const handleImportWorkspaces = importWorkspacesFromFile;

  const handleMenuClick = (label: string) => {
    setActiveMenu((prev) => (prev === label ? null : label));
    setOpenSubmenu(null);
  };

  const handleItemClick = (item: MenuItem, e: React.MouseEvent) => {
    e.stopPropagation();
    /* v7.58: a disabled item swallows the click whole — it used to be
       unreachable because the CSS set pointer-events: none, which is also why
       its explanatory tooltip never appeared. With hover restored the click
       arrives here, and closing the menu on it would take the explanation away
       at the exact moment the reader went to look for it. */
    if (item.disabled) return;
    if (item.action) item.action();
    setActiveMenu(null);
    setOpenSubmenu(null);
  };

  // Mouse: hover switches submenu (desktop) — no pointerleave to avoid layout shift
  const handleSubmenuPointerEnter = (label: string, e: React.PointerEvent) => {
    if (e.pointerType === 'mouse') setOpenSubmenu(label);
  };
  /** Submenu keys are scoped to their parent menu so a stale open submenu can
   *  never render under a different top-level menu (the "Analytics in the
   *  File menu" glitch). */
  const submenuKey = (menuLabel: string, itemLabel: string, index?: number) =>
    `${menuLabel}:${index ?? ''}:${itemLabel}`;
  const handleItemPointerEnter = (e: React.PointerEvent) => {
    if (e.pointerType === 'mouse') setOpenSubmenu(null);
  };
  // Touch: tap toggles submenu (mobile)
  const handleSubmenuTouchEnd = (label: string, e: React.TouchEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setOpenSubmenu((prev) => (prev === label ? null : label));
  };

  /** Insert an outline-style General line at the caret (Section '# ',
   *  Marker '⚑ ', To-Do '[ ] ') — the Navigator recognizes these. */
  const insertOutlineLine = (prefix: string) => {
    if (!editor) return;
    editor.chain().focus().insertContent({ type: 'general', content: [{ type: 'text', text: prefix }] }).run();
  };

  const menus: MenuSection[] = [
    {
      label: 'File',
      items: [
        {
          icon: <span className="menu-txt-icon" aria-hidden="true">+</span>,
          label: 'New Script…',
          shortcut: sc('newScreenplay'),
          action: handleNewScreenplay,
        },
        { separator: true, label: '' },
        /* v7.23, Derek: "clicking Open in the File menu should take you
           straight to the file explorer" — so Open IS the native file dialog
           now, the same importer Browse This Computer… used to run. The
           window that lists your own scripts moved down one line and became
           Open Recent…, which is what it always was. */
        {
          icon: <FaFolderOpen />, label: 'Open…', shortcut: sc('openFile'),
          action: () => confirmOrRun(handleImport),
        },
        {
          icon: <FaClock />, label: 'Open Recent…',
          action: () => confirmOrRun(() => setOpenFileOpen(true)),
        },
        { separator: true, label: '' },
        { icon: <FaSave />, label: 'Save', shortcut: sc('save'), action: handleSave },
        {
          /*
           * v1.17: Save As opens the SAVE AS DIALOG.
           *
           * It was bound to handleExportOdraft — an EXPORT, which writes a .odraft file
           * and is already sitting in File > Export > ScriptCraft (.odraft). So the
           * Name/Draft/Version window could only ever be reached by saving a file that
           * had never been saved; picking "Save As" on a saved script exported it
           * instead. Same word, two different jobs, and the wrong one wired up.
           */
          icon: <FaSave />, label: 'Save As…', shortcut: sc('saveAs'),
          action: () => setSaveAsOpen(true),
        },
        { icon: <FaEdit />, label: 'Rename…', action: () => setRenameOpen(true) },
        { separator: true, label: '' },
        /* v3.24 reorg #4: Preview left File — it duplicates
           View > Editor > Preview; view modes belong to View. */
        /* v4.79, Derek: Import sits NEXT TO Export (it lived up by New/Open),
           and both submenus gain Presets… — one combined window. */
        {
          icon: <FaFileImport />, label: 'Import',
          children: [
            { icon: <FaFileCode />, label: 'Final Draft / Fountain / ScriptCraft…', action: () => confirmOrRun(handleImport) },
            { icon: <FaFileWord />, label: 'Microsoft Word (.docx)…', action: handleImportDocx },
            { icon: <FaFilePdf />, label: 'PDF (.pdf)…', action: handleImportPdf },
            { icon: <FaBoxOpen />, label: 'Presets…', action: () => useEditorStore.getState().openPresetExport() },
          ],
        },
        {
          icon: <FaFileExport />, label: 'Export',
          children: [
            { icon: <FaFileCode />, label: 'Final Draft (.fdx)…', action: handleExportFDX },
            { icon: <FaFileAlt />, label: 'Fountain (.fountain)…', action: handleExportFountain },
            { icon: <FaFilePdf />, label: 'PDF…', action: handleExportPDF },
            { icon: <FaFileWord />, label: 'Microsoft Word (.docx)…', action: handleExportDocx },
            { icon: <FaFile />, label: `ScriptCraft (.${SCRIPT_EXT})…`, action: handleExportOdraft },
            { icon: <FaBoxOpen />, label: 'Presets…', action: () => useEditorStore.getState().openPresetExport() },
          ],
        },
        { icon: <FaPrint />, label: 'Print…', shortcut: sc('print'), action: () => { void handlePrint(); } },
        // v5.46, Derek: Asset Manager and Script History moved here from the
        // Project menu — they manage the FILE's belongings and its history.
        { separator: true, label: '' },
        ...(() => {
          const t = ALL_TOOLS.find((x) => x.id === 'assets');
          return t ? [{ icon: t.icon, label: t.label, action: () => useEditorStore.getState().openTool('assets') }] : [];
        })(),
        {
          icon: <FaCodeBranch />, label: 'Script History',
          children: [
            { icon: <FaUpload />, label: 'Take Snapshot…', action: handleCheckinOpen },
            { icon: <FaHistory />, label: 'Snapshots', action: () => useEditorStore.getState().openTool('history') },
            { separator: true, label: '' },
            {
              icon: <FaExchangeAlt />,
              label: trackChangesEnabled
                ? '✓ Track Changes'
                : 'Track Changes Since Last Snapshot',
              action: handleTrackChangesToggle,
            },
            { icon: <FaFileSignature />, label: 'Compare with Snapshot…', action: () => setCompareVersionOpen(true) },
          ],
        },
      ],
    },
    {
      label: 'Edit',
      items: [
        // v2.36: smart routing — a just-edited beat undoes before the script.
        { icon: <FaUndo />, label: 'Undo', shortcut: sc('undo'), action: () => smartUndo(editor) },
        { icon: <FaRedo />, label: 'Redo', shortcut: sc('redo'), action: () => smartRedo(editor) },
        { separator: true, label: '' },
        { icon: <FaCut />, label: 'Cut', shortcut: sc('cut'), action: () => document.execCommand('cut') },
        { icon: <FaCopy />, label: 'Copy', shortcut: sc('copy'), action: () => document.execCommand('copy') },
        { icon: <FaPaste />, label: 'Paste', shortcut: sc('paste'), action: () => document.execCommand('paste') },
        { icon: <FaMousePointer />, label: 'Select All', shortcut: sc('selectAll'), action: () => editor?.chain().focus().selectAll().run() },
        { separator: true, label: '' },
        { icon: <LuSearch />, label: 'Find & Replace…', shortcut: sc('find'), action: () => setSearchOpen(true) },
        /* v3.25: bookmarks removed (markers cover them); Last Edit Location
           survives here — it's navigation, like Go to Page. */
        { icon: <FaHashtag />, label: 'Go to Page…', shortcut: sc('goToPage'), action: () => setGoToPageOpen(true) },
        { icon: <FaPencilAlt />, label: 'Go to Last Edited', action: () => shortcutActionsRef.current.lastEditLocation?.() },
        { separator: true, label: '' },
        // v6.14, Derek: the Insert menu is GONE — its document-level
        // inserts live here now.
        { icon: <FaImage />, label: 'Insert Image…', action: () => useEditorStore.getState().imageInsertHandler?.() },
        {
          icon: <FaListOl />, label: 'Insert Element',
          children: [
            // Dual Dialogue lives inside the Element list, immediately after
            // Dialogue (v0.62) — it's an element choice, not a separate insert.
            ...pickableElements
              .flatMap((r) => {
                const shortcuts: Record<string, string> = {
                  sceneHeading: `${mod}1`, action: `${mod}2`, character: `${mod}3`, dialogue: `${mod}4`,
                  parenthetical: `${mod}5`, transition: `${mod}6`, general: `${mod}7`, shot: `${mod}8`,
                };
                // Dual Dialogue arrives from the canonical list like any other
                // element; it just runs a command instead of setting a node.
                if (r.id === 'dualDialogue') {
                  return [{
                    icon: <FaColumns />,
                    label: r.label,
                    shortcut: sc('dualDialogue'),
                    action: () => (editor as any)?.commands?.toggleDualDialogue(),
                  }];
                }
                // v2.04: every menu item wears an icon (Derek's audit).
                return [{ icon: <FaTextHeight />, label: r.label, shortcut: shortcuts[r.id], action: () => setElement(r.id as any) }];
              }),
            { separator: true, label: '' },
            { icon: <FaWrench />, label: 'Customize Elements…', action: () => openCustomize('elements') },
          ],
        },
      ],
    },
    {
      label: 'View',
      items: [
        {
          icon: <FaColumns />, label: 'Workspaces',
          children: [
            /* v7.73, Derek: "add an option to hide workspaces from the menu."
               The eye lives in Edit Workspaces…, which still lists every one —
               so this filter can never leave a workspace unreachable. */
            ...workspaceOrder.filter((n) => workspaces[n] && !workspacesHidden.includes(n)).map((name) => ({
              icon: <FaColumns />,
              label: activeWorkspace === name ? `\u2713 ${name}` : name,
              action: () => applyWorkspace(name),
            })),
            ...(Object.keys(workspaces).length > 0 ? [{ separator: true, label: '' }] : []),
            { icon: <FaColumns />, label: 'Save as New Workspace…', action: () => setSaveWorkspaceOpen(true) },
            /* v7.65, Derek: dead when the layout still matches what was
               saved. The SAME workspaceIsDirty the Workspaces tool reads —
               these two lists of actions have to agree, and the way they
               agree is by asking one function. */
            { icon: <FaColumns />, label: 'Save Changes to this Workspace', action: () => {
              if (activeWorkspace && workspaceDirty) saveWorkspace(activeWorkspace);
            }, disabled: !activeWorkspace || !workspaceDirty },
            { icon: <FaColumns />, label: 'Reset to Saved Layout', action: () => {
              if (activeWorkspace && workspaceDirty) applyWorkspace(activeWorkspace);
            }, disabled: !activeWorkspace || !workspaceDirty },
            { icon: <FaColumns />, label: 'Edit Workspaces…', action: () => setEditWorkspacesOpen(true) },
            { separator: true, label: '' },
            { icon: <FaFileImport />, label: 'Import Workspaces from a Project…', action: handleImportWorkspaces },
          ],
        },
        { separator: true, label: '' },

        {
          icon: <FaColumns />, label: 'Editor',
          children: [
            { icon: <FaRegClone />, label: !previewMode && viewStyle === 'page' ? '\u2713 Page' : 'Page', action: () => { useEditorStore.getState().setPreviewMode(false); setViewStyle('page'); } },
            { icon: <FaStream />, label: !previewMode && viewStyle === 'continuous' ? '\u2713 Continuous' : 'Continuous', action: () => { useEditorStore.getState().setPreviewMode(false); setViewStyle('continuous'); } },
            { icon: <FaRegEye />, label: previewMode ? '\u2713 Preview' : 'Preview', action: () => useEditorStore.getState().setPreviewMode(true) },
          ],
        },
        // v3.16, Derek: the surface toggles group under one Toolbars submenu
        // (they were flat View items since v1.75/v2.29), as check items.
        {
          icon: <FaColumns />, label: 'Toolbars',
          children: [
            { icon: <FaColumns />, label: 'Left Panel', checked: navigatorOpen, action: () => toggleNavigator() },
            { icon: <FaColumns />, label: 'Right Panel', checked: shelfOpen, action: () => toggleShelf() },
            { icon: <FaStream />, label: 'Outline Toolbar', checked: outlineBarOpen, action: () => setOutlineBarOpen(!outlineBarOpen) },
          ],
        },
        // v2.95, Derek: Word/Docs-style rulers on the editor's top and left.
        // v5.42, Derek: no "Show" prefix — the checkmark says the state.
        {
          icon: <FaRulerHorizontal />,
          label: 'Rulers',
          checked: rulersVisible,
          action: () => useEditorStore.getState().setRulersVisible(!rulersVisible),
        },
        {
          // v4.22, Derek: moved here from Project. v4.86: a CHECK item, like
          // Rulers above it — see the note on Working Notes below.
          icon: <FaListUl />,
          label: 'Scene Numbers',
          checked: sceneNumbersVisible,
          action: () => setSceneNumbersVisible(!sceneNumbersVisible),
        },
        { separator: true, label: '' },
        /* v3.24 reorg #5: Lock All / Reset All Sizing moved into the
           Customize window. v6.16, Derek: the Working Notes submenu is gone
           too — the per-kind Show-in-Script toggles live with their tools;
           the annotation set keeps its submenu below. */
        {
          /* v5.28, Derek: the annotation view options as a submenu — the
             same state the Annotations window's Show button drives (status
             + per-type script visibility + the master toggle). Types are
             only the ones the script actually uses. */
          icon: <FaMarker />, label: 'Annotations',
          children: [
            {
              icon: <FaMarker />,
              label: 'Show Annotations in Script',
              checked: markupsVisible,
              action: () => setMarkupsVisible(!markupsVisible),
            },
            { separator: true, label: '' },
            ...(['open', 'done', 'all'] as const).map((d) => ({
              icon: <FaCheck style={{ opacity: 0 }} />,
              label: d === 'open' ? 'Open Only' : d === 'done' ? 'Complete Only' : 'All Statuses',
              checked: markupScriptDone === d,
              action: () => setMarkupScriptDone(d),
            })),
            ...(annotationTypesInUse.length ? [{ separator: true as const, label: '' }] : []),
            ...annotationTypesInUse.map((ic) => ({
              icon: <MarkupIcon icon={ic} />,
              label: `Show “${markupIconLabel(ic)}”`,
              checked: !markupHiddenIcons.includes(ic),
              action: () => setMarkupHiddenIcons(
                markupHiddenIcons.includes(ic)
                  ? markupHiddenIcons.filter((x) => x !== ic)
                  : [...markupHiddenIcons, ic],
              ),
            })),
            ...(annotationTypesInUse.length ? [
              { separator: true as const, label: '' },
              { icon: <FaRegEye />, label: 'Show All Types', action: () => setMarkupHiddenIcons([]) },
              { icon: <FaRegEyeSlash />, label: 'Hide All Types', action: () => setMarkupHiddenIcons(annotationTypesInUse) },
            ] : []),
          ],
        },
        { separator: true, label: '' },
        {
          icon: <FaAdjust />, label: 'Themes',
          children: [
            // Built-ins and custom themes, in the user's order, minus hidden ones.
            ...visibleThemes.map(({ id, label }) => ({
              icon: <FaAdjust />,
              label: theme === id ? `\u2713 ${label}` : label,
              action: () => setTheme(id),
            })),
            { separator: true, label: '' },
            { icon: <FaWrench />, label: 'Customize Themes…', action: () => openCustomize('themes') },
          ],
        },
        { separator: true, label: '' },
        {
          icon: <CirclePlusIcon />, label: `Zoom (${zoomLevel}%)`,
          children: [
            { icon: <CirclePlusIcon />, label: 'Zoom In', shortcut: sc('zoomIn'), action: () => setZoomLevel(Math.min(300, zoomLevel + 10)) },
            { icon: <CircleMinusIcon />, label: 'Zoom Out', shortcut: sc('zoomOut'), action: () => setZoomLevel(Math.max(50, zoomLevel - 10)) },
            // v2.57, Derek: as big as the page can get in the current editor
            // width (the sidebars decide how much room there is). The
            // measurement lives in the Toolbar; the command event reaches it.
            { icon: <LuZoomIn />, label: 'Scale to Max Width', shortcut: sc('fitWidth'), action: () => window.dispatchEvent(new CustomEvent('scriptcraft:command', { detail: 'fitWidth' })) },
            { separator: true, label: '' },
            { icon: <CirclePlusIcon />, label: zoomLevel === 50 ? '\u2713 50%' : '50%', action: () => setZoomLevel(50) },
            { icon: <CirclePlusIcon />, label: zoomLevel === 75 ? '\u2713 75%' : '75%', action: () => setZoomLevel(75) },
            { icon: <CirclePlusIcon />, label: zoomLevel === 100 ? '\u2713 100%' : '100%', action: () => setZoomLevel(100) },
            { icon: <CirclePlusIcon />, label: zoomLevel === 125 ? '\u2713 125%' : '125%', action: () => setZoomLevel(125) },
            { icon: <CirclePlusIcon />, label: zoomLevel === 150 ? '\u2713 150%' : '150%', action: () => setZoomLevel(150) },
            { icon: <CirclePlusIcon />, label: zoomLevel === 200 ? '\u2713 200%' : '200%', action: () => setZoomLevel(200) },
            { icon: <CirclePlusIcon />, label: zoomLevel === 300 ? '\u2713 300%' : '300%', action: () => setZoomLevel(300) },
          ],
        },
      ],
    },
    {
      label: 'Format',
      items: [
        // v0.87: Style and Alignment were submenus in a menu with barely anything
        // else in it — two clicks to reach Bold. Their contents are promoted to
        // the top of Format and the wrapper submenus are gone.
        { icon: <FaBold />, label: 'Bold', shortcut: sc('bold'), action: () => editor?.chain().focus(undefined, { scrollIntoView: false }).toggleBold().run(), disabled: locked.bold, tooltip: locked.bold ? FORMAT_LOCKED : undefined, note: locked.bold ? NOTE_FORMAT_LOCKED : undefined },
        { icon: <FaItalic />, label: 'Italic', shortcut: sc('italic'), action: () => editor?.chain().focus(undefined, { scrollIntoView: false }).toggleItalic().run(), disabled: locked.italic, tooltip: locked.italic ? FORMAT_LOCKED : undefined, note: locked.italic ? NOTE_FORMAT_LOCKED : undefined },
        { icon: <FaUnderline />, label: 'Underline', shortcut: sc('underline'), action: () => editor?.chain().focus(undefined, { scrollIntoView: false }).toggleUnderline().run(), disabled: locked.underline, tooltip: locked.underline ? FORMAT_LOCKED : undefined, note: locked.underline ? NOTE_FORMAT_LOCKED : undefined },
        { icon: <FaStrikethrough />, label: 'Strikethrough', action: () => editor?.chain().focus(undefined, { scrollIntoView: false }).toggleStrike().run(), disabled: locked.strikethrough, tooltip: locked.strikethrough ? FORMAT_LOCKED : undefined, note: locked.strikethrough ? NOTE_FORMAT_LOCKED : undefined },
        /* v3.24 reorg #3: Subscript/Superscript removed — screenplay
           format never uses them (same call as the v3.19 palette cull).
           The editor marks still exist for imported documents. */
        { separator: true, label: '' },
        // v1.95: the four alignment actions fold into one submenu.
        {
          icon: <FaAlignLeft />, label: 'Alignment',
          children: [
            { icon: <FaAlignLeft />, label: 'Align Left', action: () => editor?.chain().focus(undefined, { scrollIntoView: false }).setTextAlign('left').run(), disabled: locked.textAlign, tooltip: locked.textAlign ? FORMAT_LOCKED : undefined, note: locked.textAlign ? NOTE_FORMAT_LOCKED : undefined },
            { icon: <FaAlignCenter />, label: 'Align Center', action: () => editor?.chain().focus(undefined, { scrollIntoView: false }).setTextAlign('center').run(), disabled: locked.textAlign, tooltip: locked.textAlign ? FORMAT_LOCKED : undefined, note: locked.textAlign ? NOTE_FORMAT_LOCKED : undefined },
            { icon: <FaAlignRight />, label: 'Align Right', action: () => editor?.chain().focus(undefined, { scrollIntoView: false }).setTextAlign('right').run(), disabled: locked.textAlign, tooltip: locked.textAlign ? FORMAT_LOCKED : undefined, note: locked.textAlign ? NOTE_FORMAT_LOCKED : undefined },
            { icon: <FaAlignJustify />, label: 'Justify', action: () => editor?.chain().focus(undefined, { scrollIntoView: false }).setTextAlign('justify').run(), disabled: locked.textAlign, tooltip: locked.textAlign ? FORMAT_LOCKED : undefined, note: locked.textAlign ? NOTE_FORMAT_LOCKED : undefined },
          ],
        },
        { separator: true, label: '' },
        { icon: <FaFileAlt />, label: `Formatting Template (${activeTemplate.name})...`, action: () => setTemplateSelectOpen(true) },
        /* v4.86 removed Customize from View; v6.14 put it back there at Derek's
           ask; v7.65, Derek: "move customize from the view menu to format
           menu". It sits with the other two doors that configure how the app
           looks rather than what the script says. Opens on the remembered
           last-used tab (the v6.02 generic door). */
        { separator: true, label: '' },
        { icon: <FaWrench />, label: 'Customize…', action: () => openCustomize() },
      ],
    },
    {
      label: 'Project',
      items: [
        ...PROJECT_MENU_GROUPS.filter((group) => group.length > 0).flatMap((group, gi) => [
          ...(gi > 0 ? [{ separator: true, label: '' }] : []),
          ...group
            /* v7.05: availableTools() — a gated tool (uninstalled add-on,
               or dev-only) simply isn't found, and the filter drops it. */
            .map((id) => availableTools().find((t) => t.id === id))
            .filter((t): t is typeof ALL_TOOLS[number] => !!t)
            .map((t) => ({
              icon: t.icon,
              label: t.label,
              action: () => useEditorStore.getState().openTool(t.id),
            })),
        ]),
        { separator: true, label: '' },
        /* v6.14, Derek's menu reorg: the Project menu ends with the
           document-level items, his order — Set Draft Number, Title Page
           (v5.67: the Pages window's tab — set the tab FIRST so the window
           opens already on it), Custom Page (the v6.05 "where?" dialog,
           ex-Insert). Spelling & Grammar moved to Tools; Revision Mode and
           the locks moved to the NEW Production menu below. */
        { icon: <FaFileSignature />, label: 'Set Draft Number…', action: () => setDraftDialogOpen(true) },
        { icon: <FaFileAlt />, label: 'Title Page', action: () => { const st = useEditorStore.getState(); st.setPagesTab('title'); st.openTool('pages'); } },
        { icon: <FaRegFileAlt />, label: 'Custom Page…', action: () => { if (editor) setAddPageOpen(true); } },
      ],
    },
    {
      label: 'Tools',
      items: [
        ...TOOL_MENU_GROUPS.flatMap((group, gi) => [
          ...(gi > 0 ? [{ separator: true, label: '' }] : []),
          ...group
            /* v7.05: availableTools() — a gated tool (uninstalled add-on,
               or dev-only) simply isn't found, and the filter drops it. */
            .map((id) => availableTools().find((t) => t.id === id))
            .filter((t): t is typeof ALL_TOOLS[number] => !!t)
            .map((t) => ({
              icon: t.icon,
              label: t.label,
              action: () => useEditorStore.getState().openTool(t.id),
            })),
        ]),
        { separator: true, label: '' },
        {
          icon: <FaSpellCheck />, label: 'Spelling & Grammar',
          children: [
            { icon: <FaSpellCheck />, label: 'Spell Check Panel', action: () => useEditorStore.getState().openTool('spelling') },
            { separator: true, label: '' },
            { icon: <FaSpellCheck />, label: 'Auto Spell Check', checked: spellCheckEnabled, action: toggleSpellCheck },
            { icon: <FaSpellCheck />, label: 'Spell Check…', shortcut: 'F7', action: () => setSpellModalOpen(true) },
            { separator: true, label: '' },
            { icon: <FaSpellCheck />, label: 'Auto Writing Suggestions', checked: grammarCheckEnabled, action: toggleGrammarCheck },
            { icon: <FaSpellCheck />, label: 'Writing Suggestions…', shortcut: '⇧F7', action: () => setGrammarModalOpen(true) },
            /* v3.24 reorg #6: Grammar & Spelling Settings moved to the
               Settings dialog (it's configuration, not workflow). */
          ],
        },
        ...ALL_TOOLS.filter((t) => t.id === 'thesaurus').map((t) => ({
          icon: t.icon, label: t.label, action: () => useEditorStore.getState().openTool(t.id),
        })),
      ],
    },
    {
      label: 'Production',
      items: [
        // v6.14, Derek's menu reorg: Production stands on its own again
        // (the v3.24 merge into Project is undone), his order.
        /* v7.06, Derek: "keep Revision Mode and Production Tags in the
           Production menu, but gray them out. clicking them does nothing.
           hovering shows 'This feature is in development.'" Both keep their
           place and their icon; neither carries an action, so the shared
           handleItemClick already refuses to fire (it checks `disabled`). */
        { icon: <FaToggleOn />, label: 'Revision Mode', disabled: true, tooltip: IN_DEVELOPMENT, note: NOTE_IN_DEVELOPMENT },
        { icon: <FaTags />, label: 'Production Tags', disabled: true, tooltip: IN_DEVELOPMENT, note: NOTE_IN_DEVELOPMENT },
        {
          icon: <FaLock />,
          label: 'Lock Scene Numbers',
          checked: sceneNumbersLocked,
          action: () => setSceneNumbersLocked(!sceneNumbersLocked),
          disabled: !sceneNumbersVisible,
          /* v7.58: greyed for a STATE reason, not an unbuilt one — there is
             nothing to lock until scene numbers are on. Saying "in
             development" here would send Derek away from a switch he can
             throw in the next menu along. */
          tooltip: sceneNumbersVisible ? undefined
            : 'Turn scene numbers on first',
          note: sceneNumbersVisible ? undefined : 'scene numbers off',
        },
        // v1.34: Lock Pages is UNRELEASED — same Developer toggle as Help's.
        ...(showUnreleasedTools
          ? [{ icon: <FaLock />, label: 'Lock Pages', disabled: true, tooltip: IN_DEVELOPMENT, note: NOTE_IN_DEVELOPMENT }]
          : []),
      ],
    },
  ];

  // Help menu rendered separately as a 3-dot overflow on the right
  const helpMenu: MenuSection = {
    label: 'Help',
    items: [
      /* v3.15, Derek: About lives in the ScriptCraft app menu, not Help —
         but ONLY native mode has an app menu, so the in-window Help keeps
         it (removing it there would leave About unreachable). v6.95 (Derek,
         via the feedback form): Settings… sits directly BELOW About with a
         divider on each side — it LEFT File for this spot. Native mode keeps
         the macOS convention (About + Settings… in the app menu). */
      ...(nativeMenus ? [] : [
        { icon: <FaInfoCircle />, label: 'About ScriptCraft', action: () => setAboutOpen(true) },
        { separator: true, label: '' },
        /* v7.12, Derek ("use a different gear icon for settings"): Settings had
           been borrowing FaWrench — the same icon the Tools MENU and every
           Customize… item wear, so three different things read alike.
           v7.13: and it is the gear Derek drew for it (uiIcons.GearIcon),
           at full strength rather than the muted icon colour. */
        { icon: <GearIcon />, label: 'Settings…', shortcut: sc('settings'), action: () => useEditorStore.getState().openPreferences() },
        { separator: true, label: '' },
      ]),
      {
        icon: <FaKeyboard />,
        label: 'Keyboard Shortcuts',
        action: () => setShortcutsOpen(true),
      },
      {
        icon: <FaInfoCircle />,
        label: 'Knowledge Base',
        action: () => setKnowledgeBaseOpen(true),
      },
      {
        /* v7.62: the check the user ASKED for. Unlike the silent one on
           launch, this one always answers — up to date, or why it could not
           find out. A question that gets silence back cannot be told apart
           from a broken feature. */
        icon: <FaArrowUp />,
        label: 'Check for Updates…',
        action: () => requestUpdateCheck(),
      },
      /* v3.24 reorg #7: Changelog folded into About ("What's New"). */
      { separator: true, label: '' },
      {
        icon: <FaExternalLinkAlt />,
        label: 'Feedback…',
        // v6.84: the native Feedback tool (no more Airtable iframe modal)
        action: () => useEditorStore.getState().openTool('feedback'),
      },
      { separator: true, label: '' },
      {
        /*
         * v1.13: Developer collects the app's own diagnostic tools.
         *
         * NOTE THE ONE THING THAT IS *NOT* DEV-ONLY HERE. Diagnostics ships. It's
         * what a user runs when something breaks and what support would ask them
         * for, so burying it behind import.meta.env.DEV would delete it from every
         * release build — a real loss dressed up as tidying. So the Developer group
         * always ships. (v3.25: the Dev Picker that used to live here is gone.)
         */
        icon: <FaBug />, label: 'Developer',
        children: [
          {
            icon: <FaStethoscope />,
            label: 'Diagnostics',
            action: () => setDiagnosticsOpen(true),
          },
          {
            // v6.22, Derek: the Helper Text editor's own window. v6.52: a
            // real tool now — dockable into a side panel like any window.
            icon: <FaRegEdit />,
            label: 'Helper Text…',
            action: () => useEditorStore.getState().openTool('helpertext'),
          },
          {
            /* v7.33, Derek: "design tool is not in the dev menu like it
               should be." It never was. Design is devOnly, and devOnly means
               ToolDock filters it out of BOTH the tool rail and Customize ▸
               Panels — so with no menu entry it had no door at all: a window
               that exists, is reachable from nothing, and can only be opened
               by a test. That is the same shape as a control that writes into
               the void, just from the other side. */
            icon: <FaSlidersH />,
            label: 'Design…',
            action: () => useEditorStore.getState().openTool('design'),
          },
          /* v1.34: the switch for features that exist but aren't finished
           * (Lock Pages; Collaboration until v6.40 removed it). One flag,
           * read wherever an unreleased item renders. */
          {
            icon: <FaToggleOn />,
            label: 'Show Unreleased Tools',
            checked: showUnreleasedTools,
            action: () => setShowUnreleasedTools(!showUnreleasedTools),
          },
        ],
      },
      { separator: true, label: '' },
      /* v3.08, Derek: donation link — last item of Help. */
      {
        icon: <FaCoffee />,
        label: 'Buy Me a Coffee',
        action: () => openInBrowser(DONATE_URL),
      },
    ],
  };

  menus.push(helpMenu);

  // Customize > Menu Bar: apply user order + hidden set (File never hides;
  // menus not in the saved order — e.g. added in later versions — keep their
  // natural position at the end of the ordered ones).

  // v2.13: the Scrapbook's contextual menus (Table / Picture) — [] unless
  // the Scrapbook is open. They render AFTER a divider + tag, never join
  // orderedMenus, and can't be customized or hidden.
  const scrapbookMenus = useScrapbookMenus() as unknown as MenuSection[];

  /* v7.69, Derek: "hide the entire production menu for now." Behind the same
     Developer toggle that already gated Lock Pages, rather than deleted — "for
     now" says it comes back, and a menu that still builds is a menu that has
     not rotted while it waited. Three of its four items were unbuilt anyway;
     the fourth, Lock Scene Numbers, keeps its other door as an addable ribbon
     button (toolbarCommands' lockSceneNumbers), so nothing working is
     orphaned by this. */
  const visibleMenus = menus.filter((m) => (
    (m.label === 'File' || !menuBarHidden.includes(m.label))
    && (m.label !== 'Production' || showUnreleasedTools)
  ));
  const orderIdxOf = (label: string) => {
    const i = menuBarOrder.indexOf(label);
    return i === -1 ? 100 + menus.findIndex((m) => m.label === label) : i;
  };
  const orderedMenus = [...visibleMenus].sort((a, b) => orderIdxOf(a.label) - orderIdxOf(b.label));

  // Append plugin menu items to each section (supports nested submenus)
  const pluginCtx = { editor };
  const mapPluginChildren = (children: any[]): MenuItem[] =>
    children.map((c) => ({
      label: c.label || '',
      shortcut: c.shortcut,
      action: c.action ? () => c.action!(pluginCtx) : undefined,
      disabled: typeof c.disabled === 'function' ? c.disabled(pluginCtx) : c.disabled,
      separator: c.separator,
      children: c.children ? mapPluginChildren(c.children) : undefined,
    }));
  for (const menu of menus) {
    const pluginItems = pluginRegistry.getMenuItems(menu.label as PluginMenuSection);
    if (pluginItems.length > 0) {
      menu.items.push({ separator: true, label: '' });
      for (const p of pluginItems) {
        menu.items.push({
          label: p.label,
          shortcut: p.shortcut,
          action: p.action ? () => p.action!(pluginCtx) : undefined,
          disabled: typeof p.disabled === 'function' ? p.disabled(pluginCtx) : p.disabled,
          children: p.children ? mapPluginChildren(p.children) : undefined,
        });
      }
    }
  }

  // Track the active menu item's position for the portal dropdown
  const menuItemRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const [dropdownPos, setDropdownPos] = useState<{ top?: number; bottom?: number; left: number }>({ top: 0, left: 0 });

  useEffect(() => {
    if (!activeMenu) return;
    const el = menuItemRefs.current[activeMenu];
    if (el) {
      const rect = el.getBoundingClientRect();
      const dropdownWidth = 260; // min-width of .menu-dropdown
      const left = Math.min(rect.left, window.innerWidth - dropdownWidth - 8);

      // In floating mode, position relative to the panel edges (not individual items)
      // so the dropdown clears the rounded, padded floating menu panel.
      if (menuMode === 'hidden' && menuRef.current) {
        const panelRect = menuRef.current.getBoundingClientRect();
        if (panelRect.bottom > window.innerHeight * 0.55) {
          setDropdownPos({ bottom: window.innerHeight - panelRect.top + 4, left, top: undefined });
        } else {
          setDropdownPos({ top: panelRect.bottom + 4, left, bottom: undefined });
        }
      } else {
        setDropdownPos({ top: rect.bottom, left, bottom: undefined });
      }
    }
  }, [activeMenu, menuMode]);

  // Floating menu toggle (hidden mode)
  const [floatingMenuOpen, setFloatingMenuOpen] = useState(false);
  const [showHiddenModeIntro, setShowHiddenModeIntro] = useState(false);
  const [hiddenModeDontShow, setHiddenModeDontShow] = useState(true);

  // Draggable FAB position — persisted to localStorage
  const FAB_POS_KEY = 'opendraft:fabPosition';
  const FAB_SIZE = 36;
  const [fabPos, setFabPos] = useState<{ x: number; y: number } | null>(() => {
    try {
      const s = localStorage.getItem('opendraft:fabPosition');
      if (s) {
        const p = JSON.parse(s);
        return {
          x: Math.max(0, Math.min(p.x, window.innerWidth - 36)),
          y: Math.max(0, Math.min(p.y, window.innerHeight - 36)),
        };
      }
    } catch {}
    return null;
  });
  const fabDragRef = useRef<{ startX: number; startY: number; originX: number; originY: number; isDrag: boolean } | null>(null);
  const fabWasDragRef = useRef(false);
  const fabX = fabPos?.x ?? (navPanelWidth + 14);
  const fabY = fabPos?.y ?? 10;
  // On Android the WebView extends behind the (transparent) status bar, so a
  // FAB rendered at top: 10px sits in the system-bar touch region and never
  // receives taps. Clamp the rendered top below the status bar (28dp fallback
  // when env() reports 0, otherwise the real inset).
  const isAndroidWebView = typeof document !== 'undefined'
    && document.documentElement.classList.contains('android');
  const fabTopStyle = isAndroidWebView
    ? `max(${fabY}px, calc(max(env(safe-area-inset-top), 28px) + 8px))`
    : `max(${fabY}px, calc(env(safe-area-inset-top, 0px) + 8px))`;

  // Desktop: pointer events with capture for mouse drag
  const handleFabPointerDown = useCallback((e: React.PointerEvent) => {
    if (e.pointerType === 'touch') return; // Touch handled separately below
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch {}
    fabDragRef.current = {
      startX: e.clientX, startY: e.clientY,
      originX: fabPos?.x ?? (navPanelWidth + 14),
      originY: fabPos?.y ?? 10,
      isDrag: false,
    };
  }, [fabPos, navPanelWidth]);

  const handleFabPointerMove = useCallback((e: React.PointerEvent) => {
    if (e.pointerType === 'touch') return;
    const d = fabDragRef.current;
    if (!d) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    if (!d.isDrag && Math.abs(dx) + Math.abs(dy) > 5) {
      d.isDrag = true;
      setFloatingMenuOpen(false);
    }
    if (d.isDrag) {
      setFabPos({
        x: Math.max(0, Math.min(window.innerWidth - FAB_SIZE, d.originX + dx)),
        y: Math.max(0, Math.min(window.innerHeight - FAB_SIZE, d.originY + dy)),
      });
    }
  }, [FAB_SIZE]);

  const handleFabPointerUp = useCallback((e: React.PointerEvent) => {
    if (e.pointerType === 'touch') return;
    const d = fabDragRef.current;
    fabDragRef.current = null;
    if (!d) return;
    fabWasDragRef.current = true;
    if (d.isDrag) {
      const pos = {
        x: Math.max(0, Math.min(window.innerWidth - FAB_SIZE, d.originX + (e.clientX - d.startX))),
        y: Math.max(0, Math.min(window.innerHeight - FAB_SIZE, d.originY + (e.clientY - d.startY))),
      };
      setFabPos(pos);
      localStorage.setItem(FAB_POS_KEY, JSON.stringify(pos));
    } else {
      setFloatingMenuOpen(prev => !prev);
    }
  }, [FAB_POS_KEY, FAB_SIZE]);

  // Touch: native listeners on the FAB element via ref (WKWebView + Android WebView)
  const fabElRef = useRef<HTMLDivElement>(null);
  const fabPosRef = useRef(fabPos);
  fabPosRef.current = fabPos;
  const navPanelWidthRef = useRef(navPanelWidth);
  navPanelWidthRef.current = navPanelWidth;

  useEffect(() => {
    const el = fabElRef.current;
    if (!el) return;

    const onTouchStart = (e: TouchEvent) => {
      e.stopPropagation(); // Prevent swipe handlers on parent elements
      const t = e.touches[0];
      const pos = fabPosRef.current;
      fabDragRef.current = {
        startX: t.clientX, startY: t.clientY,
        originX: pos?.x ?? (navPanelWidthRef.current + 14),
        originY: pos?.y ?? 10,
        isDrag: false,
      };
    };
    const onTouchMove = (e: TouchEvent) => {
      const d = fabDragRef.current;
      if (!d) return;
      const t = e.touches[0];
      const dx = t.clientX - d.startX;
      const dy = t.clientY - d.startY;
      if (!d.isDrag && Math.abs(dx) + Math.abs(dy) > 5) {
        d.isDrag = true;
        setFloatingMenuOpen(false);
      }
      if (d.isDrag) {
        e.preventDefault();
        e.stopPropagation();
        setFabPos({
          x: Math.max(0, Math.min(window.innerWidth - FAB_SIZE, d.originX + dx)),
          y: Math.max(0, Math.min(window.innerHeight - FAB_SIZE, d.originY + dy)),
        });
      }
    };
    const onTouchEnd = (e: TouchEvent) => {
      const d = fabDragRef.current;
      fabDragRef.current = null;
      if (!d) return;
      if (d.isDrag) {
        fabWasDragRef.current = true;
        // Reset after a short delay so the flag doesn't block future taps
        // (onClick may not fire on mobile after a drag to reset it)
        setTimeout(() => { fabWasDragRef.current = false; }, 400);
        const t = e.changedTouches[0];
        const pos = {
          x: Math.max(0, Math.min(window.innerWidth - FAB_SIZE, d.originX + (t.clientX - d.startX))),
          y: Math.max(0, Math.min(window.innerHeight - FAB_SIZE, d.originY + (t.clientY - d.startY))),
        };
        setFabPos(pos);
        localStorage.setItem(FAB_POS_KEY, JSON.stringify(pos));
      }
    };

    el.addEventListener('touchstart', onTouchStart, { passive: false });
    document.addEventListener('touchmove', onTouchMove, { passive: false });
    document.addEventListener('touchend', onTouchEnd);
    return () => {
      el.removeEventListener('touchstart', onTouchStart);
      document.removeEventListener('touchmove', onTouchMove);
      document.removeEventListener('touchend', onTouchEnd);
    };
  }, [FAB_POS_KEY, FAB_SIZE, menuMode]);

  // Click: fallback for tap (works everywhere)
  const handleFabClick = useCallback(() => {
    if (fabWasDragRef.current) {
      fabWasDragRef.current = false;
      return;
    }
    setFloatingMenuOpen(prev => !prev);
  }, []);

  // Icon map for menu labels

  // Find the active menu's items (search both main menus and help)
  const activeMenuData = activeMenu
    ? menus.find(m => m.label === activeMenu)
      || scrapbookMenus.find(m => m.label === activeMenu)
      || (activeMenu === 'Help' ? helpMenu : null)
    : null;

  // Close floating menu when clicking outside (but not on the dropdown portal or FAB)
  useEffect(() => {
    if (!floatingMenuOpen) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (menuRef.current && !menuRef.current.contains(target)) {
        // Don't close if clicking inside the dropdown portal or a submenu
        if (target.closest('.menu-dropdown') || target.closest('.menu-fab')) return;
        setFloatingMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [floatingMenuOpen]);

  // v0.72: 'custom' sizes the bar from the user's slider (half-compact …
  // double-comfortable). Contents scale with it via --chrome-scale so a taller
  // bar isn't just empty space around tiny text.
  const menuBarClass =
    menuMode === 'comfortable' ? 'menu-bar chrome-comfortable'
    : menuMode === 'custom' ? 'menu-bar chrome-custom'
    : 'menu-bar';
  const menuCustomH = chromePx('menu', 'custom', chromeCustomPx.menu);
  const menuBarStyle: React.CSSProperties | undefined = menuMode === 'custom'
    ? ({
        height: menuCustomH,
        ['--chrome-scale' as string]: String(chromeScaleFactor('menu', menuCustomH)),
      } as React.CSSProperties)
    : undefined;

  // v2.35: dragging the line before "Scrapbook" slides that menu group.
  const scrapbookSepDrag = useRef<{ x: number; offset: number } | null>(null);

  const renderMenuItems = () => (
    <>
      {orderedMenus.map((menu) => (
        <div
          key={menu.label}
          ref={(el) => { menuItemRefs.current[menu.label] = el; }}
          className={`menu-item ${activeMenu === menu.label ? 'active' : ''}`}
          onClick={() => handleMenuClick(menu.label)}
          onMouseEnter={() => {
            if (activeMenu && activeMenu !== menu.label) { setActiveMenu(menu.label); setOpenSubmenu(null); }
          }}
        >
          {MENU_ICONS[menu.label] && <span className="menu-icon">{MENU_ICONS[menu.label]}</span>}
          <span className="menu-label">{menu.label}</span>
        </div>
      ))}
      {/* v2.13: the Scrapbook's contextual menus — divider, tag, then Table /
          Picture (Word's model) and the way back. Only while it's open. */}
      {scrapbookMenus.length > 0 && (<>
        {/* v2.35, Derek: grab this line to slide the whole Scrapbook menu
            group left or right (the offset persists). */}
        <span
          className={`menu-scrapbook-sep${uiResizeLocked ? '' : ' menu-scrapbook-sep-drag'}`}
          style={{ marginLeft: chromeGapPx.scrapbook }}
          title={uiResizeLocked ? undefined : 'Drag to move the Scrapbook menus'}
          onPointerDown={(e) => {
            // v2.55: the sizing lock freezes this slide too.
            if (useEditorStore.getState().uiResizeLocked) return;
            e.preventDefault();
            (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
            scrapbookSepDrag.current = { x: e.clientX, offset: chromeGapPx.scrapbook };
          }}
          onPointerMove={(e) => {
            const d = scrapbookSepDrag.current;
            if (d) useEditorStore.getState().setChromeGap('scrapbook', d.offset + (e.clientX - d.x));
          }}
          onPointerUp={() => { scrapbookSepDrag.current = null; }}
        />
        <span className="menu-section-tag">Scrapbook</span>
        {scrapbookMenus.map((menu) => (
          <div
            key={menu.label}
            ref={(el) => { menuItemRefs.current[menu.label] = el; }}
            className={`menu-item ${activeMenu === menu.label ? 'active' : ''}`}
            onClick={() => handleMenuClick(menu.label)}
            onMouseEnter={() => {
              if (activeMenu && activeMenu !== menu.label) { setActiveMenu(menu.label); setOpenSubmenu(null); }
            }}
          >
            <span className="menu-icon">{menu.label === 'Table' ? <FaTable /> : <FaImageIcon />}</span>
            <span className="menu-label">{menu.label}</span>
          </div>
        ))}
      </>)}
      {/* v2.32, Derek: the spacing grip sits right after the LAST menu item —
          Help usually, the Scrapbook menus when they're open. ("Return to
          Editor" went back to the Scrapbook surface's corner.) */}
      <GapHandle bar="menu" />
      <div className="menu-spacer" />
    </>
  );

  // v2.93, Derek: the menus can live in the REAL macOS menu bar. Same
  // MenuSection data, mirrored natively; the in-window bar (and its
  // dropdown portal) stays unrendered while native mode is on — but the
  // component itself stays mounted: it owns the dialogs, the shortcut
  // handler, and the menu data the native bar mirrors.
  useEffect(() => {
    if (nativeMenus) {
      void syncNativeMenu([...orderedMenus, ...scrapbookMenus] as never);
    } else {
      void uninstallNativeMenu();
    }
  });

  /** v3.05: a list reserves the left check column when ANY of its items is
   *  checkable — so toggling doesn't shift the labels sideways. */
  const hasChecks = (items?: MenuItem[]) => !!items?.some((it) => it.checked !== undefined);

  return (
    <>
    {nativeMenus ? null : menuMode === 'hidden' ? (
      createPortal(
        <>
          <div
            ref={fabElRef}
            className={`menu-fab ${floatingMenuOpen ? 'menu-fab--open' : ''}`}
            style={{ left: fabX, top: fabTopStyle }}
            onPointerDown={handleFabPointerDown}
            onPointerMove={handleFabPointerMove}
            onPointerUp={handleFabPointerUp}
            onClick={handleFabClick}
            onMouseDown={(e) => e.nativeEvent.stopImmediatePropagation()}
            title="Menu (drag to reposition)"
          >
            <FaBars />
          </div>
          {floatingMenuOpen && (() => {
            const fabInBottom = fabY > window.innerHeight * 0.55;
            const fabInRight = fabX > window.innerWidth * 0.5;
            const mStyle: React.CSSProperties = {};
            if (fabInBottom) {
              mStyle.bottom = window.innerHeight - fabY + 8;
            } else {
              mStyle.top = fabY + FAB_SIZE + 8;
            }
            if (fabInRight) {
              mStyle.right = window.innerWidth - fabX - FAB_SIZE;
            } else {
              mStyle.left = fabX;
            }
            return (
              <div className="menu-bar chrome-comfortable menu-bar--floating" style={mStyle} ref={menuRef}>
                {renderMenuItems()}
              </div>
            );
          })()}
        </>,
        document.body,
      )
    ) : (
      <div
        className={menuBarClass}
        style={{ ...(menuBarStyle ?? {}), gap: chromeGapPx.menu }}
        ref={menuRef}
      >
        {renderMenuItems()}
      </div>
    )}
    {!nativeMenus && activeMenuData && createPortal(
      <div
        className={`menu-dropdown${menuMode === 'comfortable' ? ' menu-dropdown--comfortable' : ''}${dropdownPos.bottom != null ? ' menu-dropdown--above' : ''}`}
        style={{ top: dropdownPos.top, bottom: dropdownPos.bottom, left: dropdownPos.left }}
      >
        {activeMenuData.items.map((item, i) =>
          item.separator ? (
            <div key={i} className="menu-separator" onPointerEnter={handleItemPointerEnter} />
          ) : item.children || item.render ? (
            <div
              key={`${i}:${item.label}`}
              className={`menu-dropdown-item has-children ${item.disabled ? 'disabled ' : ''}${openSubmenu === submenuKey(activeMenuData.label, item.label!, i) ? 'submenu-open' : ''}`}
              /* v7.58: and the submenu PARENT — the third render of a menu
                 item, and the third place `title` had to be repeated. All
                 three now pass it, so an item can explain itself wherever it
                 happens to sit. */
              title={item.tooltip}
              onPointerEnter={(e) => { if (!item.disabled) handleSubmenuPointerEnter(submenuKey(activeMenuData.label, item.label!, i), e); }}
              onTouchEnd={(e) => { if (!item.disabled) handleSubmenuTouchEnd(submenuKey(activeMenuData.label, item.label!, i), e); }}
              onClick={(e) => { e.stopPropagation(); if (!item.disabled) setOpenSubmenu(submenuKey(activeMenuData.label, item.label!, i)); }}
            >
              {hasChecks(activeMenuData.items) && <span className="menu-check" />}
              {item.icon && <span className="menu-dropdown-icon">{item.icon}</span>}
              <span>{labelWithNote(item.label, item.note)}</span>
              <span className="menu-submenu-arrow">{openSubmenu === submenuKey(activeMenuData.label, item.label!, i) ? <FaChevronDown /> : <FaChevronRight />}</span>
              <div
                className={`menu-submenu ${openSubmenu === submenuKey(activeMenuData.label, item.label!, i) ? 'submenu-visible' : ''}`}
                ref={(el) => {
                  if (el && openSubmenu === submenuKey(activeMenuData.label, item.label!, i)) {
                    const rect = el.getBoundingClientRect();
                    if (rect.right > window.innerWidth) {
                      el.classList.add('submenu-flip');
                    } else {
                      el.classList.remove('submenu-flip');
                    }
                    if (rect.bottom > window.innerHeight) {
                      el.classList.add('submenu-flip-y');
                    } else {
                      el.classList.remove('submenu-flip-y');
                    }
                  }
                }}
              >
                {item.render ? item.render(() => { setActiveMenu(null); setOpenSubmenu(null); }) : item.children!.map((child, j) =>
                  child.separator ? (
                    <div key={j} className="menu-separator" />
                  ) : (
                    <div
                      key={`${j}:${child.label}`}
                      className={`menu-dropdown-item ${child.disabled ? 'disabled' : ''}`}
                      /* v7.58: a submenu child carries its hover text too. This
                         render dropped `title` on the floor, so the Align items
                         could be given one and it would never appear — the same
                         silent no-op as the pointer-events rule, one level in. */
                      title={child.tooltip}
                      onTouchEnd={(e) => e.stopPropagation()}
                      onClick={(e) => handleItemClick(child, e)}
                    >
                      {hasChecks(item.children) && <span className="menu-check">{child.checked ? <FaCheck /> : ''}</span>}
                      {child.icon && <span className="menu-dropdown-icon">{child.icon}</span>}
                      <span>{child.label}</span>
                      {child.shortcut && (
                        <span className="menu-shortcut">{child.shortcut}</span>
                      )}
                    </div>
                  )
                )}
              </div>
            </div>
          ) : (
            <div
              key={`${i}:${item.label}`}
              className={`menu-dropdown-item ${item.disabled ? 'disabled' : ''}`}
              /* v7.06, Derek: a disabled item can say WHY (hover text) instead
                 of just being gray and mute. */
              title={item.tooltip}
              onPointerEnter={handleItemPointerEnter}
              onClick={(e) => handleItemClick(item, e)}
            >
              {hasChecks(activeMenuData.items) && <span className="menu-check">{item.checked ? <FaCheck /> : ''}</span>}
              {item.icon && <span className="menu-dropdown-icon">{item.icon}</span>}
              <span>{labelWithNote(item.label, item.note)}</span>
              {item.shortcut && (
                <span className="menu-shortcut">{item.shortcut}</span>
              )}
            </div>
          )
        )}
      </div>,
      document.body,
    )}
    {showHiddenModeIntro && createPortal(
      <div className="dialog-overlay" onClick={() => setShowHiddenModeIntro(false)}>
        <div className="hidden-mode-intro" onClick={(e) => e.stopPropagation()}>
          <div className="dialog-header">Hidden Mode</div>
          <div className="hidden-mode-intro-body">
            <div className="hidden-mode-intro-icon">
              <svg width="40" height="40" viewBox="0 0 40 40" fill="none" stroke="var(--fd-accent)" strokeWidth="1.5">
                <circle cx="20" cy="20" r="18" fill="var(--fd-overlay-subtle)" />
                <line x1="14" y1="14" x2="14" y2="26" strokeWidth="2.5" strokeLinecap="round" />
                <line x1="20" y1="14" x2="20" y2="26" strokeWidth="2.5" strokeLinecap="round" />
                <line x1="26" y1="14" x2="26" y2="26" strokeWidth="2.5" strokeLinecap="round" />
              </svg>
            </div>
            <p>The menu bar is now hidden. A <strong>floating menu button</strong> has been placed on screen to access all menus.</p>
            <p>You can <strong>drag the button</strong> to reposition it anywhere on screen. Your preferred position will be remembered.</p>
            <p>To restore the menu bar, tap the button and go to <strong>View &gt; Menu &amp; Toolbar</strong>.</p>
          </div>
          <div className="dialog-footer" style={{ flexDirection: 'column', gap: '12px', alignItems: 'stretch' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: 'var(--fd-text-secondary)', cursor: 'pointer' }}>
              <input type="checkbox" checked={hiddenModeDontShow} onChange={(e) => setHiddenModeDontShow(e.target.checked)} />
              Don't show this again
            </label>
            <button className="dialog-btn dialog-btn-primary" onClick={() => {
              if (hiddenModeDontShow) localStorage.setItem('opendraft:hiddenModeIntroShown', '1');
              setShowHiddenModeIntro(false);
            }}>Got it</button>
          </div>
        </div>
      </div>,
      document.body,
    )}
    {checkinOpen && (
      <div className="dialog-overlay" onClick={() => setCheckinOpen(false)}>
        <div className="dialog-box" onClick={(e) => e.stopPropagation()}>
          <div className="dialog-header">Take Snapshot</div>
          <div className="dialog-body">
            <div className="dialog-row">
              <label>Snapshot Description</label>
              <input
                ref={checkinInputRef}
                value={checkinMessage}
                onChange={(e) => setCheckinMessage(e.target.value)}
                placeholder="Describe what changed..."
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && checkinMessage.trim()) handleCheckinSubmit();
                  if (e.key === 'Escape') setCheckinOpen(false);
                }}
              />
            </div>
          </div>
          <div className="dialog-actions">
            <button onClick={() => setCheckinOpen(false)}>Cancel</button>
            <button
              className="dialog-btn dialog-btn-primary"
              onClick={handleCheckinSubmit}
              disabled={checkinSaving || !checkinMessage.trim()}
            >
              {checkinSaving ? 'Saving...' : 'Take Snapshot'}
            </button>
          </div>
        </div>
      </div>
    )}
    <CustomizePanelsDialog open={customizeOpen} category={customizeTab ?? undefined} onClose={() => setCustomizeOpen(false)} />
    {addPageOpen && editor && <AddCustomPageDialog editor={editor} onClose={() => setAddPageOpen(false)} />}
    <PresetsDialog
      open={presetExportRequest.open}
      preCheck={presetExportRequest.parts as PresetPartId[] | undefined}
      onClose={() => useEditorStore.getState().closePresetExport()}
    />
    <SaveWorkspaceDialog open={saveWorkspaceOpen} onClose={() => setSaveWorkspaceOpen(false)} />
    <EditWorkspacesDialog open={editWorkspacesOpen} onClose={() => setEditWorkspacesOpen(false)} />
    <PreferencesDialog
      open={preferencesRequest.open}
      openTab={preferencesRequest.tab}
      onClose={closePreferences}
      editor={editor}
    />
    <SetDraftDialog open={draftDialogOpen} onClose={() => setDraftDialogOpen(false)} editor={editor} />
    {/* v4.80, Derek: the launcher fronts New Script — the unsaved-work guard
        already ran on the way in, so its branches act directly. */}
    <NewScriptLauncher
      open={launcherOpen}
      onClose={() => setLauncherOpen(false)}
      onChoose={(choice) => {
        setLauncherOpen(false);
        if (choice === 'manual') setNewScriptOpen(true);
        else if (choice === 'guided') setGuidedOpen(true);
        else if (choice === 'open') useEditorStore.getState().setOpenFileOpen(true);
        else handleImport();
      }}
    />
    <GuidedSetupDialog
      open={guidedOpen}
      onClose={() => setGuidedOpen(false)}
      onBack={() => { setGuidedOpen(false); setLauncherOpen(true); }}
      onCreate={(meta) => {
        pendingNewScriptMeta.current = meta;
        setGuidedOpen(false);
        finishNewScreenplayWithFormat(meta.templateId, 'reset');
      }}
    />
    <NewScriptDialog
      open={newScriptOpen}
      onClose={() => setNewScriptOpen(false)}
      onBack={() => { setNewScriptOpen(false); setLauncherOpen(true); }}
      onCreate={(meta) => {
        pendingNewScriptMeta.current = meta;
        setNewScriptOpen(false);
        // v1.88: the format is a dropdown ON the dialog now — apply it
        // directly instead of routing through the "Choose script format"
        // window. (promptForNewScreenplayFormat still serves in-project
        // creation, which has no New Script dialog.)
        finishNewScreenplayWithFormat(meta.templateId, 'reset');
      }}
    />
    <RenameDialog open={renameOpen} onClose={() => setRenameOpen(false)} />
    <HelpReferenceDialog kind="shortcuts" open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
    <HelpReferenceDialog kind="knowledge" open={knowledgeBaseOpen} onClose={() => setKnowledgeBaseOpen(false)} />
    {pageSetupOpen && (
      <PageSetupDialog onClose={() => setPageSetupOpen(false)} />
    )}
    {templateSelectOpen && (
      <TemplateSelectDialog editor={editor} onClose={() => setTemplateSelectOpen(false)} />
    )}
    {formatPickerOpen && (
      <ScriptFormatPickerDialog
        onPick={(id) => {
          setFormatPickerOpen(false);
          finishNewScreenplayWithFormat(id, formatPickerMode);
        }}
        onCancel={() => setFormatPickerOpen(false)}
      />
    )}
    <ChangelogDialog open={changelogOpen} onClose={() => setChangelogOpen(false)} />
    {editElementsOpen && (
      <EditElementsDialog open onClose={() => setEditElementsOpen(false)} />
    )}
    {aboutOpen && <AboutDialog onClose={() => setAboutOpen(false)} onShowChangelog={() => { setAboutOpen(false); setChangelogOpen(true); }} />}
    {diagnosticsOpen && <DiagnosticsDialog onClose={() => setDiagnosticsOpen(false)} />}
    {discardConfirmOpen && (
      <div className="dialog-overlay" onClick={handleDiscardConfirmCancel}>
        <div className="dialog-box" onClick={(e) => e.stopPropagation()}>
          <div className="dialog-header">Unsaved Changes</div>
          <div className="dialog-body">
            <p style={{ margin: 0, fontSize: 14, color: 'var(--fd-text)' }}>
              You have unsaved changes. Would you like to save before proceeding?
            </p>
          </div>
          <div className="dialog-actions">
            <button onClick={handleDiscardConfirmCancel}>Cancel</button>
            <button onClick={handleDiscardConfirmDiscard}>Discard</button>
            <button className="dialog-btn dialog-btn-primary" onClick={handleDiscardConfirmSave}>Save &amp; Continue</button>
          </div>
        </div>
      </div>
    )}
    {docxImportWarningOpen && (
      <div className="dialog-overlay" onClick={() => setDocxImportWarningOpen(false)}>
        <div className="dialog-box" onClick={(e) => e.stopPropagation()}>
          <div className="dialog-header">Import from Word — Best-Effort Formatting</div>
          <div className="dialog-body">
            <p style={{ margin: '0 0 8px 0', fontSize: 14, color: 'var(--fd-text)' }}>
              ScriptCraft will detect script element types (scene heading, action,
              character, dialogue, parenthetical, transition, etc.) from the
              Word document&apos;s formatting.
            </p>
            <p style={{ margin: '0 0 8px 0', fontSize: 14, color: 'var(--fd-text)' }}>
              Detection is <strong>best-effort</strong> and depends on consistent
              formatting being applied throughout the document. Results will be
              accurate if you used:
            </p>
            <ul style={{ margin: '0 0 8px 18px', fontSize: 13, color: 'var(--fd-text)' }}>
              <li>Final Draft, Fade In, Trelby, or Highland style names, OR</li>
              <li>Standard Final Draft indents (Action 1.5&quot;, Character 3.5&quot;, Dialogue 2.5&quot;, Parenthetical 3.0&quot;), OR</li>
              <li>Conventional text patterns (INT./EXT., ALL-CAPS character cues, &quot;CUT TO:&quot; transitions).</li>
            </ul>
            <p style={{ margin: 0, fontSize: 13, color: 'var(--fd-text-muted, #888)' }}>
              Anything that can&apos;t be classified will be imported as Action and
              listed in a post-import notice for you to review.
            </p>
          </div>
          <div className="dialog-actions">
            <button onClick={() => setDocxImportWarningOpen(false)}>Cancel</button>
            <button className="dialog-btn dialog-btn-primary" onClick={handleConfirmDocxImport}>Continue</button>
          </div>
        </div>
      </div>
    )}
    </>
  );
};

export default MenuBar;
