/**
 * Toolbar command registry (v0.38) — every Production/Tools menu COMMAND that
 * can be pinned to the toolbar as a button. Commands whose UI lives in
 * MenuBar-mounted dialogs run via a window event ('scriptcraft:command') that
 * MenuBar listens for, so no dialog state needs hoisting; commands backed by
 * store setters run directly.
 */
import React from 'react';
import {
  FaFileAlt, FaFileSignature, FaEdit, FaListUl, FaLock, FaToggleOn,
  FaUpload, FaHistory, FaExchangeAlt, FaSpellCheck, FaTags, FaCodeBranch,
  FaFile, FaFolderOpen, FaFileImport, FaSave, FaRegSave, FaPrint,
  FaFilePdf, FaFileExport, FaFileWord, FaCut, FaCopy, FaPaste,
  FaMousePointer, FaColumns, FaImage, FaSearchPlus, FaSearchMinus,
  FaRulerHorizontal, FaInfoCircle, FaKeyboard, FaExternalLinkAlt,
  FaPencilAlt, FaCamera, FaRegEye,
} from 'react-icons/fa';
import { PanelLeftIcon, PanelRightIcon, GearIcon } from './uiIcons';
import { useEditorStore, type EditorState } from '../stores/editorStore';

export interface ToolbarCommand {
  id: string;
  label: string;
  icon: React.ReactNode;
  run: () => void;
  /** v4.71, Derek: commands that TOGGLE something report their on-state so the
   *  ribbon button can highlight while it's on (same .active treatment the
   *  formatting builtins use). A zustand SELECTOR, not a hook — the button
   *  subscribes through it. Omit for one-shot actions. */
  active?: (s: EditorState) => boolean;
}

const emit = (id: string) =>
  window.dispatchEvent(new CustomEvent('scriptcraft:command', { detail: id }));

export const TOOLBAR_COMMANDS: ToolbarCommand[] = [
  { id: 'titlePage', label: 'Title Page', icon: <FaFileAlt />, run: () => useEditorStore.getState().setTitlePageEditorOpen(true) },
  { id: 'setDraft', label: 'Set Draft Number', icon: <FaFileSignature />, run: () => emit('setDraft') },
  { id: 'rename', label: 'Rename', icon: <FaEdit />, run: () => emit('rename') },
  // v3.78, Derek: ONE toggle instead of separate Add / Remove — shows or hides
  // scene numbers from whatever state you're in.
  { id: 'sceneNumbers', label: 'Scene Numbers', icon: <FaListUl />, run: () => { const s = useEditorStore.getState(); s.setSceneNumbersVisible(!s.sceneNumbersVisible); }, active: (s) => s.sceneNumbersVisible },
  { id: 'lockSceneNumbers', label: 'Lock Scene Numbers', icon: <FaLock />, run: () => { const s = useEditorStore.getState(); s.setSceneNumbersLocked(!s.sceneNumbersLocked); }, active: (s) => s.sceneNumbersLocked },
  { id: 'revisionMode', label: 'Revision Mode', icon: <FaToggleOn />, run: () => { const s = useEditorStore.getState(); s.setRevisionMode(!s.revisionMode); }, active: (s) => s.revisionMode },
  { id: 'productionTags', label: 'Production Tags', icon: <FaTags />, run: () => useEditorStore.getState().toggleTool('tags'), active: (s) => s.activeTool === 'tags' || s.activeToolRight === 'tags' || s.tempTool === 'tags' || s.fullscreenTool === 'tags' },
  { id: 'takeSnapshot', label: 'Take Snapshot', icon: <FaUpload />, run: () => emit('takeSnapshot') },
  { id: 'snapshots', label: 'Snapshots', icon: <FaHistory />, run: () => emit('snapshots') },
  { id: 'compareSnapshot', label: 'Compare with Snapshot', icon: <FaCodeBranch />, run: () => emit('compareSnapshot') },
  { id: 'trackChanges', label: 'Track Changes', icon: <FaExchangeAlt />, run: () => emit('trackChanges'), active: (s) => s.trackChangesEnabled },
  { id: 'spellCheck', label: 'Spelling & Grammar', icon: <FaSpellCheck />, run: () => emit('spellCheck') },
  { id: 'writingSuggestions', label: 'Writing Suggestions', icon: <FaSpellCheck />, run: () => emit('writingSuggestions') },
  // v2.97, Derek: EVERY menu action is ribbon-pinnable. These run through
  // the same 'scriptcraft:command' bus, which falls back to MenuBar's
  // shortcut-actions map — one closure per command, three surfaces.
  { id: 'newScreenplay', label: 'New Script', icon: <FaFile />, run: () => emit('newScreenplay') },
  { id: 'openFile', label: 'Open', icon: <FaFolderOpen />, run: () => emit('openFile') },
  { id: 'importLocal', label: 'Import', icon: <FaFileImport />, run: () => emit('importLocal') },
  { id: 'save', label: 'Save', icon: <FaSave />, run: () => emit('save') },
  { id: 'saveAs', label: 'Save As', icon: <FaRegSave />, run: () => emit('saveAs') },
  { id: 'print', label: 'Print', icon: <FaPrint />, run: () => emit('print') },
  { id: 'preview', label: 'Preview', icon: <FaRegEye />, run: () => emit('preview') },
  { id: 'exportPDF', label: 'Export PDF', icon: <FaFilePdf />, run: () => emit('exportPDF') },
  { id: 'exportFDX', label: 'Export FDX', icon: <FaFileExport />, run: () => emit('exportFDX') },
  { id: 'exportFountain', label: 'Export Fountain', icon: <FaFileAlt />, run: () => emit('exportFountain') },
  { id: 'exportDocx', label: 'Export Word (.docx)', icon: <FaFileWord />, run: () => emit('exportDocx') },
    // v7.12/13: Settings' own gear (uiIcons.GearIcon, the shape Derek sent);
  // FaWrench stays with Tools/Customize.
  { id: 'settings', label: 'Settings', icon: <GearIcon />, run: () => emit('settings') },
  // v3.42, Derek: show/hide the side panels from the ribbon (same toggles the
  // panel edge strips use).
  // v4.53, Derek: distinct icons — the filled side is the panel it toggles.
  { id: 'toggleLeftPanel', label: 'Toggle Left Panel', icon: <PanelLeftIcon />, run: () => useEditorStore.getState().toggleNavigator(), active: (s) => s.navigatorOpen },
  { id: 'toggleRightPanel', label: 'Toggle Right Panel', icon: <PanelRightIcon />, run: () => useEditorStore.getState().toggleShelf(), active: (s) => s.shelfOpen },
  { id: 'cut', label: 'Cut', icon: <FaCut />, run: () => emit('cut') },
  { id: 'copy', label: 'Copy', icon: <FaCopy />, run: () => emit('copy') },
  { id: 'paste', label: 'Paste', icon: <FaPaste />, run: () => emit('paste') },
  { id: 'selectAll', label: 'Select All', icon: <FaMousePointer />, run: () => emit('selectAll') },
  { id: 'dualDialogue', label: 'Dual Dialogue', icon: <FaColumns />, run: () => emit('dualDialogue') },
  // v2.98, Derek: the rest of the menus — import variants, the .odraft
  // export, Insert/View/Format/Help actions. fitPage/fitWidth are handled
  // by ScreenplayEditor's listener on the same bus.
  { id: 'importDocx', label: 'Import Word (.docx)', icon: <FaFileWord />, run: () => emit('importDocx') },
  { id: 'importPdf', label: 'Import PDF', icon: <FaFilePdf />, run: () => emit('importPdf') },
  { id: 'exportOdraft', label: 'Export ScriptCraft (.odraft)', icon: <FaFile />, run: () => emit('exportOdraft') },
  { id: 'insertImage', label: 'Insert Image', icon: <FaImage />, run: () => emit('insertImage') },
  { id: 'fitPage', label: 'Scale to Fit Page', icon: <FaSearchPlus />, run: () => emit('fitPage') },
  { id: 'fitWidth', label: 'Scale to Max Width', icon: <FaSearchPlus />, run: () => emit('fitWidth') },
  { id: 'actualSize', label: 'Actual Size (100%)', icon: <FaSearchMinus />, run: () => emit('actualSize') },
  { id: 'showRulers', label: 'Show/Hide Rulers', icon: <FaRulerHorizontal />, run: () => emit('showRulers'), active: (s) => s.rulersVisible },
  // v3.80, Derek: capture the page you're looking at as a PNG (html2canvas is
  // loaded lazily inside the util so it only costs weight when used).
  { id: 'screenshot', label: 'Screenshot', icon: <FaCamera />, run: () => { void import('../utils/screenshot').then((m) => m.captureScreenshot()); } },
  // v3.25: bookmarks removed (markers cover them); Last Edit stays pinnable.
  { id: 'lastEditLocation', label: 'Go to Last Edited', icon: <FaPencilAlt />, run: () => emit('lastEditLocation') },
  // v7.81: 'formatPrefs' removed with the Script Format Preferences dialog —
  // the v6.41 rule discards the token from any saved layout still carrying it.
  { id: 'grammarSettings', label: 'Grammar & Spelling Settings', icon: <FaSpellCheck />, run: () => emit('grammarSettings') },
  { id: 'about', label: 'About ScriptCraft', icon: <FaInfoCircle />, run: () => emit('about') },
  { id: 'keyboardShortcuts', label: 'Keyboard Shortcuts', icon: <FaKeyboard />, run: () => emit('keyboardShortcuts') },
  { id: 'knowledgeBase', label: 'Knowledge Base', icon: <FaInfoCircle />, run: () => emit('knowledgeBase') },
  { id: 'changelog', label: 'Changelog', icon: <FaHistory />, run: () => emit('changelog') },
  { id: 'feedback', label: 'Feedback', icon: <FaExternalLinkAlt />, run: () => emit('feedback') },
];

export const commandDef = (id: string): ToolbarCommand | null =>
  TOOLBAR_COMMANDS.find((c) => c.id === id) || null;
