import type { Editor } from '@tiptap/core';
import React, { useState } from 'react';
import { FaWrench, FaColumns, FaRulerCombined, FaCloudUploadAlt, FaDownload, FaLanguage, FaKeyboard, FaEdit, FaGripHorizontal, FaBolt, FaMousePointer, FaPalette, FaUndo, FaMarker } from 'react-icons/fa';
import PresetsPanel from './PresetsPanel';
import { CUSTOMIZE_RESETS, ResetAllButton, runCustomizeReset, type CustomizeTabId } from './customizeResets';
import { useEditorStore } from '../stores/editorStore';
import { useSettingsStore } from '../stores/settingsStore';
import { DATE_FORMATS, type DateFormatId } from '../utils/dateFormat';
import PageSetupTab from './PageSetupTab';
import CustomizePanelsDialog from './CustomizePanelsDialog';
import { showToast } from './Toast';
import KeyboardShortcutsTab from './KeyboardShortcutsTab';
import { applyBackup, readFileText } from '../utils/settingsBackup';
import { applyPresetFile, readPresetFile } from '../utils/presets';
import { useWindowTabMemory } from '../utils/windowTabMemory';
import { snapshotSettings, restoreSettings } from '../utils/settingsSnapshot';
import { confirmDialog } from './ConfirmDialog';
import { spellChecker, BUILTIN_LANGUAGE } from '../editor/spellchecker';
import { BUILTIN, CATALOG, urlsFor } from '../editor/languageCatalog';
import { useState as useStateReact, useEffect as useEffectReact } from 'react';
import {
  connectGDrive, connectOneDrive, gdriveConnected, onedriveConnected,
  disconnectGDrive, disconnectOneDrive,
} from '../services/saveLocations';
import { redirectUri } from '../services/oauthPkce';
import FloatingWindow from './FloatingWindow';

/* ─────────────────────────────────────────────────────────────────────────
   Settings (File → Settings…)

   One window for the settings that used to be scattered across menus:
   - General            — startup + automatic snapshots
   - Customize Layout   — same live settings as View → Customize Layout
   - Script Formats     — formerly Format → Script Format Preferences…
   - Page Setup         — formerly File → Page Setup…

   (v4.28: Mores & Continueds moved to Customize > Editor.)
   The remaining embeds use the existing dialogs in `embedded` mode, so both entry
   points (where they still exist) edit exactly the same state.
   ───────────────────────────────────────────────────────────────────────── */

type CustomizeCat = 'elements' | 'toolbar' | 'panels' | 'qat' | 'context' | 'markups' | 'themes';
type PrefTab = 'general' | 'saveloc' | 'languages' | 'keys' | 'page' | 'defaults' | 'backup' | `cz-${CustomizeCat}`;

/* v7.00, Derek (via the feedback form): the sidebar is CATEGORIZED —
   System (app behavior), Page (script setup), then Customize. The old
   System tab (Reset only) is GONE — Defaults already compiles it. */
const SYSTEM_TABS: Array<{ id: PrefTab; label: string; icon: React.ReactNode }> = [
  { id: 'general', label: 'General', icon: <FaWrench /> },
  { id: 'saveloc', label: 'Save Options', icon: <FaCloudUploadAlt /> },
  /* v7.14, Derek: "Delete the downloads tab in settings" — its two sections
     are at the bottom of Save Options now. */
  /* v7.00: broken out of General into its own tab. */
  /* v7.06: renamed Region — language, units and date/time live here. */
  { id: 'languages', label: 'Region', icon: <FaLanguage /> },
  /* v7.14, Derek: "move keyboard above 'Ribbon Toolbar' tab" — it leads the
     customize run below rather than sitting with the system tabs. */
  /* v7.05, Derek: add-ons install here. An add-on contributes nothing to the
     app until installed, so this tab is where it first becomes visible. */
];
const PAGE_TABS: Array<{ id: PrefTab; label: string; icon: React.ReactNode }> = [
  /* v6.99, Derek: Templates and Page Setup are ONE tab. */
  { id: 'page', label: 'Page Setup', icon: <FaRulerCombined /> },
  /* v7.06, Derek: the Editor tab lives under PAGE in Settings. It keeps its
     'cz-elements' id, so the body still renders CustomizePanelsDialog pinned
     to that category and the Defaults tab still finds its resets — only the
     sidebar grouping changed, and only here. */
  { id: 'cz-elements', label: 'Editor', icon: <FaEdit /> },
];

/* v4.64, Derek: the Customize tabs are first-class entries in THIS sidebar —
   the old "Customize" tab wrapped its own inner tab rail, a submenu level
   deeper than it needed to be. Each entry renders CustomizePanelsDialog
   pinned to one tab (soloCategory). */
/* v7.06, Derek: "move the editor tab from customize to the page section. do
   this only in settings. do not change the other customize window." So Editor
   is listed under PAGE in this sidebar (see PAGE_TABS) while still rendering
   the very same CustomizePanelsDialog pinned to soloCategory="elements" — the
   standalone Customize window is untouched. */
/* v7.14, Derek: Keyboard leads this run, "Toolbar" is "Ribbon Toolbar", and
   Defaults then Backup & Restore close the list. */
const TAIL_TABS: Array<{ id: PrefTab; label: string; icon: React.ReactNode }> = [
  { id: 'keys', label: 'Keyboard', icon: <FaKeyboard /> },
];
const END_TABS: Array<{ id: PrefTab; label: string; icon: React.ReactNode }> = [
  { id: 'defaults', label: 'Defaults', icon: <FaUndo /> },
  { id: 'backup', label: 'Backup & Restore', icon: <FaDownload /> },
];
const CUSTOMIZE_TABS: Array<{ id: CustomizeCat; label: string; icon: React.ReactNode }> = [
  { id: 'toolbar', label: 'Ribbon Toolbar', icon: <FaGripHorizontal /> },
  { id: 'panels', label: 'Side Panels', icon: <FaColumns /> },
  { id: 'qat', label: 'Quick Access', icon: <FaBolt /> },
  { id: 'context', label: 'Context Menu', icon: <FaMousePointer /> },
  { id: 'markups', label: 'Annotations', icon: <FaMarker /> },
  { id: 'themes', label: 'Themes', icon: <FaPalette /> },
];

/* v4.71: every openable tab id, for the last-used-tab memory's validity
   check — derived from the two arrays above so it can't drift. */
const ALL_PREF_TAB_IDS: readonly PrefTab[] = [
  ...SYSTEM_TABS.map((t) => t.id),
  ...PAGE_TABS.map((t) => t.id),
  ...TAIL_TABS.map((t) => t.id),
  ...CUSTOMIZE_TABS.map((t) => `cz-${t.id}` as PrefTab),
  ...END_TABS.map((t) => t.id),
];

/* v4.65 → v7.00, Derek: "find a better layout for the default tab… and
   make sure all 'Reset to default' type options from all windows are also
   here." Rows now NAME what comes back (the registry's `what`), grouped
   by area in the standard section boxes; the window resets (Design,
   Helper Text, Keyboard Shortcuts) joined the registry, so this tab truly
   compiles EVERY reset — still through the one warn+undo wrapper. */
function DefaultsTab() {
  const groups: Array<{ id: string; label: string }> = [
    /* v7.06: Editor is listed under PAGE in the sidebar now, so it is no
       longer in CUSTOMIZE_TABS — but its resets are still Customize resets and
       MUST stay compiled here. Moving a tab must never silently drop its
       resets out of Defaults (check-v642 caught exactly that). */
    { id: 'elements', label: 'Editor' },
    ...CUSTOMIZE_TABS.map((t) => ({ id: t.id as string, label: t.label })),
    { id: 'design', label: 'Design Window' },
    { id: 'helper', label: 'Helper Text' },
    { id: 'keys', label: 'Keyboard Shortcuts' },
  ];
  const withActions = groups
    .map((g) => ({ ...g, actions: CUSTOMIZE_RESETS.filter((a) => a.tab === (g.id as CustomizeTabId)) }))
    .filter((g) => g.actions.length > 0);
  return (
    <div className="prefs-general fs-defaults-tab">
      {withActions.map((g) => (
        <section key={g.id}>
          <h3>{g.label}</h3>
          {g.actions.map((a) => (
            <div key={a.id} className="fs-defaults-row">
              <div className="fs-defaults-info">
                <div className="fs-defaults-name">{a.label}</div>
                <div className="fs-defaults-what">Restores {a.what}.</div>
              </div>
              <button className="dialog-btn dialog-btn-sm" onClick={() => runCustomizeReset(a)}>Reset</button>
            </div>
          ))}
        </section>
      ))}
      <section>
        <h3>Everything</h3>
        <div className="fs-defaults-row">
          <div className="fs-defaults-info">
            <div className="fs-defaults-name">Reset All</div>
            <div className="fs-defaults-what">Restores sizes, spacing and layouts app-wide; the areas above keep their own buttons.</div>
          </div>
          <ResetAllButton />
        </div>
      </section>
      {/* v7.11 put Presets here; v7.14, Derek moved it on to the new Backup &
          Restore tab, beside the whole-app settings file. Same PresetsPanel. */}
    </div>
  );
}

function LanguageSection() {
  const [enabled, setEnabled] = useStateReact<string[]>(() => spellChecker.getEnabledLanguages());
  const [loading, setLoading] = useStateReact<string | null>(null);

  useEffectReact(() => {
    // Reflect external changes (per-script language restore on doc switch)
    const off = spellChecker.onChange?.(() => setEnabled(spellChecker.getEnabledLanguages()));
    return () => { if (typeof off === 'function') off(); };
  }, []);

  const toggle = async (code: string, on: boolean) => {
    const current = spellChecker.getEnabledLanguages();
    if (on) {
      const lang = code === BUILTIN.code ? BUILTIN : CATALOG.find((l) => l.code === code);
      if (lang && code !== BUILTIN_LANGUAGE) {
        setLoading(code);
        const { aff, dic } = urlsFor(lang);
        const ok = await spellChecker.loadLanguage(code, { affUrl: aff, dicUrl: dic, label: lang.label, persist: true });
        setLoading(null);
        if (!ok) {
          showToast(`Could not download the ${lang.label} dictionary`, 'error');
          return;
        }
      }
      spellChecker.setEnabledLanguages([...new Set([...current, code])]);
    } else {
      spellChecker.setEnabledLanguages(current.filter((c) => c !== code));
    }
    setEnabled(spellChecker.getEnabledLanguages());
  };

  const all = [BUILTIN, ...CATALOG];
  return (
    <section>
      <h3>Language</h3>
      <p className="prefs-hint" style={{ margin: '0 0 10px' }}>
        Spell-check languages for the current script. Dictionaries download once
        and are kept on this device; the selection saves with the document.
      </p>
      <div className="prefs-lang-list">
        {all.map((l) => (
          <label key={l.code} className="prefs-check-row">
            <input
              type="checkbox"
              checked={enabled.includes(l.code)}
              disabled={loading === l.code || (l.code === BUILTIN_LANGUAGE && enabled.length === 1 && enabled[0] === BUILTIN_LANGUAGE)}
              onChange={(e) => toggle(l.code, e.target.checked)}
            />
            <span>{l.label}{loading === l.code ? ' — downloading…' : ''}</span>
          </label>
        ))}
      </div>
    </section>
  );
}




/* v7.06: DraftNumberRow deleted with its section — File ▸ Set Draft… owns
   the draft label now, and applyDraftNumber still lives in SetDraftDialog. */

/** v2.83: native folder picker — desktop only (a folder path only means
 *  something where the OS dialog picked it). */
async function pickFolder(title = 'Folder for auto save copies'): Promise<string | null> {
  const { isTauri } = await import('../services/platform');
  if (!isTauri()) { showToast('Choosing a local folder needs the desktop app.', 'info'); return null; }
  const { open } = await import('@tauri-apps/plugin-dialog');
  const picked = await open({ directory: true, multiple: false, title });
  return typeof picked === 'string' ? picked : null;
}

function SaveLocationsTab() {
  const {
    downloadFolder, setDownloadFolder,
    screenshotFolder, setScreenshotFolder,
    autoSnapshotMinutes, setAutoSnapshotMinutes,
    localSaveFolder, setLocalSaveFolder,
    saveToGDrive, setSaveToGDrive,
    saveToOneDrive, setSaveToOneDrive,
    saveToBackupFolder, setSaveToBackupFolder,
    backupSaveFolder, setBackupSaveFolder,
    snapToGDrive, setSnapToGDrive,
    snapToOneDrive, setSnapToOneDrive,
    snapToLocalFolder, setSnapToLocalFolder,
    snapLocalFolder, setSnapLocalFolder,
    gdriveClientId, setGdriveClientId,
    onedriveClientId, setOnedriveClientId,
  } = useSettingsStore();
  const lastAutoSaveMinutes = React.useRef(autoSnapshotMinutes > 0 ? autoSnapshotMinutes : 5);
  const [gConnected, setGConnected] = useStateReact(gdriveConnected());
  const [oConnected, setOConnected] = useStateReact(onedriveConnected());
  const [busy, setBusy] = useStateReact<string | null>(null);

  const doConnect = async (which: 'g' | 'o') => {
    setBusy(which);
    try {
      if (which === 'g') { await connectGDrive(); setGConnected(true); showToast('Google Drive connected', 'success'); }
      else { await connectOneDrive(); setOConnected(true); showToast('OneDrive connected', 'success'); }
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Connection failed', 'error');
    } finally { setBusy(null); }
  };

  return (
    <div className="prefs-general">
      <section id="prefs-save-locations">
        <h3>Script Save Locations</h3>
        {/* v6.95 (Derek, via the feedback form): this tab's helper text is
            gone — only the two cloud sections keep their setup notes. */}
        {/* v6.42, Derek: "i should still be able to change the location of
            'Local System (always on)'" — the row now shows and edits the
            device folder that receives the script as a real file: the SAME
            localSaveFolder Save As's "Location on this device" writes (one
            field, two doors). The checkbox stays locked — the app's own
            library copy always saves — but the folder is yours. */}
        <label className="prefs-check-row">
          <input type="checkbox" checked disabled />
          <span>
            Local System (always on)
            {localSaveFolder && <code className="prefs-path-chip">{localSaveFolder}</code>}
          </span>
          <button
            className="dialog-btn dialog-btn-sm prefs-inline-btn"
            onClick={async (e) => {
              e.preventDefault();
              const folder = await pickFolder('Where should ScriptCraft keep this script?');
              if (folder) setLocalSaveFolder(folder);
            }}
          >Choose Folder…</button>
        </label>
        {/* v6.41, Derek: "a second location on the local device" — a folder
            that receives a copy of the script on every save. Checking with no
            folder yet opens the picker (the v2.83 pattern); the checkbox and
            the folder are separate so unchecking keeps the path. */}
        <label className="prefs-check-row">
          <input
            type="checkbox"
            checked={saveToBackupFolder && !!backupSaveFolder}
            onChange={async (e) => {
              if (!e.target.checked) { setSaveToBackupFolder(false); return; }
              let folder = backupSaveFolder;
              if (!folder) folder = (await pickFolder()) || '';
              if (!folder) return;
              setBackupSaveFolder(folder);
              setSaveToBackupFolder(true);
            }}
          />
          <span>
            Local System (backup location)
            {backupSaveFolder && <code className="prefs-path-chip">{backupSaveFolder}</code>}
          </span>
          <button
            className="dialog-btn dialog-btn-sm prefs-inline-btn"
            onClick={async (e) => {
              e.preventDefault();
              const folder = await pickFolder();
              if (folder) { setBackupSaveFolder(folder); setSaveToBackupFolder(true); }
            }}
          >Choose Folder…</button>
        </label>
        {/* v6.41, Derek: "Make the save options always editable." OneDrive was
            checked during document setup (which has no connection guard) and
            this window's `disabled={!connected}` then refused to UNcheck it —
            a checkbox you can see but not change. The guards are gone; the
            label hints still say what a location needs to actually receive
            saves, and an enabled-but-unconnected location reports its failure
            through the save-error surface instead of silently blocking here. */}
        <label className="prefs-check-row">
          <input type="checkbox" checked={saveToGDrive} onChange={(e) => setSaveToGDrive(e.target.checked)} />
          <span>Google Drive{!gConnected ? ' — connect below first' : ''}</span>
        </label>
        <label className="prefs-check-row">
          <input type="checkbox" checked={saveToOneDrive} onChange={(e) => setSaveToOneDrive(e.target.checked)} />
          <span>OneDrive{!oConnected ? ' — connect below first' : ''}</span>
        </label>
      </section>

      <section>
        <h3>Auto Saves</h3>
        {/* v6.95 (Derek, via the feedback form): the timer and the locations
            it writes to are ONE section now. An auto save is a crash-spare
            FILE in the checked locations below — never a snapshot (v6.72;
            ScreenplayEditor's auto-save timer takes no version check-in). */}
        <label className="prefs-check-row" style={{ marginBottom: 10 }}>
          <input
            type="checkbox"
            checked={autoSnapshotMinutes > 0}
            onChange={(e) => {
              if (e.target.checked) {
                setAutoSnapshotMinutes(lastAutoSaveMinutes.current || 5);
              } else {
                if (autoSnapshotMinutes > 0) lastAutoSaveMinutes.current = autoSnapshotMinutes;
                setAutoSnapshotMinutes(0);
              }
            }}
          />
          <span>Automatically save projects</span>
        </label>
        <div className="prefs-field-row prefs-autosave-row" style={{ marginBottom: 12 }}>
          <label htmlFor="prefs-autosnap">Automatically Save Every:</label>
          <input
            id="prefs-autosnap"
            type="number"
            min={1}
            max={720}
            className="prefs-num-input"
            disabled={autoSnapshotMinutes === 0}
            value={autoSnapshotMinutes === 0 ? (lastAutoSaveMinutes.current || 5) : autoSnapshotMinutes}
            onChange={(e) => {
              const v = Math.max(1, parseInt(e.target.value, 10) || 1);
              lastAutoSaveMinutes.current = v;
              if (autoSnapshotMinutes > 0) setAutoSnapshotMinutes(v);
            }}
          />
          <span className="prefs-unit-label">minute(s)</span>
        </div>
        {/* v2.83, Derek: a chosen folder on this device gets a timestamped
            .script on every auto save. Checking with no folder yet opens the
            picker; the path shows beside the row. */}
        <label className="prefs-check-row">
          <input
            type="checkbox"
            checked={snapToLocalFolder && !!snapLocalFolder}
            onChange={async (e) => {
              if (!e.target.checked) { setSnapToLocalFolder(false); return; }
              let folder = snapLocalFolder;
              if (!folder) folder = (await pickFolder()) || '';
              if (!folder) return;
              setSnapLocalFolder(folder);
              setSnapToLocalFolder(true);
            }}
          />
          <span>
            Local device folder
            {snapLocalFolder && <code className="prefs-path-chip">{snapLocalFolder}</code>}
          </span>
          <button
            className="dialog-btn dialog-btn-sm prefs-inline-btn"
            onClick={async (e) => {
              e.preventDefault();
              const folder = await pickFolder();
              if (folder) { setSnapLocalFolder(folder); setSnapToLocalFolder(true); }
            }}
          >Choose Folder…</button>
        </label>
        {/* v6.41: no disabled guards here either — same rule as the script
            save rows above. */}
        <label className="prefs-check-row">
          <input type="checkbox" checked={snapToGDrive} onChange={(e) => setSnapToGDrive(e.target.checked)} />
          <span>Google Drive — Auto Saves folder{!gConnected ? ' — connect below first' : ''}</span>
        </label>
        <label className="prefs-check-row">
          <input type="checkbox" checked={snapToOneDrive} onChange={(e) => setSnapToOneDrive(e.target.checked)} />
          <span>OneDrive — Auto Saves folder{!oConnected ? ' — connect below first' : ''}</span>
        </label>
      </section>

      <section>
        <h3>Google Drive</h3>
        <p className="prefs-hint" style={{ margin: '0 0 8px' }}>
          One-time setup: create an OAuth client (type "Web application") at
          console.cloud.google.com → APIs &amp; Services → Credentials, enable
          the Drive API, add <code>{redirectUri()}</code> as an authorized
          redirect URI, and paste the Client ID here. ScriptCraft only ever sees
          files it created (drive.file scope).
        </p>
        <div className="prefs-field-row">
          <input
            className="dialog-input" style={{ flex: 1 }}
            value={gdriveClientId}
            placeholder="Google OAuth Client ID (…apps.googleusercontent.com)"
            onChange={(e) => setGdriveClientId(e.target.value.trim())}
          />
          {gConnected ? (
            <button className="dialog-btn" onClick={() => { disconnectGDrive(); setGConnected(false); setSaveToGDrive(false); }}>Disconnect</button>
          ) : (
            <button className="dialog-btn dialog-btn-primary" disabled={!gdriveClientId || busy === 'g'} onClick={() => doConnect('g')}>
              {busy === 'g' ? 'Connecting…' : 'Connect'}
            </button>
          )}
        </div>
      </section>

      <section>
        <h3>OneDrive</h3>
        <p className="prefs-hint" style={{ margin: '0 0 8px' }}>
          One-time setup: register an app at portal.azure.com → App
          registrations (single-page application), add
          <code> {redirectUri()}</code> as the SPA redirect URI, grant
          delegated Files.ReadWrite permission, and paste the Application
          (client) ID here.
        </p>
        <div className="prefs-field-row">
          <input
            className="dialog-input" style={{ flex: 1 }}
            value={onedriveClientId}
            placeholder="Azure Application (client) ID"
            onChange={(e) => setOnedriveClientId(e.target.value.trim())}
          />
          {oConnected ? (
            <button className="dialog-btn" onClick={() => { disconnectOneDrive(); setOConnected(false); setSaveToOneDrive(false); }}>Disconnect</button>
          ) : (
            <button className="dialog-btn dialog-btn-primary" disabled={!onedriveClientId || busy === 'o'} onClick={() => doConnect('o')}>
              {busy === 'o' ? 'Connecting…' : 'Connect'}
            </button>
          )}
        </div>
      </section>


      {/* v7.14, Derek: "move the screenshots section in settings > downloads to
          the bottom of the save options tab" + "Delete the downloads tab in
          settings". The download-folder option came with it — deleting the tab
          must not delete the setting, and both of these are "where files land",
          which is what this tab is. Screenshots sits last, as he asked. */}
      {/* v7.35, Derek: "is the download folder option actually doing anything?
          i dont think you can actually 'download' a script. you can export it,
          or save it, but not download."

          It IS doing something — fileOps.saveFileTauri seeds the save dialog's
          defaultPath with it — and he is right that "download" is the wrong
          word for it. Nothing in this app downloads: that folder is where Save
          As and every exporter (PDF, Fountain, Final Draft, Word, .odraft,
          themes, presets) OPEN, which is what it now says. The stored key
          keeps its old name on purpose (opendraft:saveloc:downloadFolder) —
          renaming a key that holds a user's chosen path would silently reset
          it. */}
      {/* v7.65, Derek: "i dont understand the Saving & exporting section. how
          is this different than the chosen save location in the same window?"

          It is genuinely different and the heading was hiding that. SCRIPT
          SAVE LOCATIONS is where the script IS WRITTEN — automatically, on
          every save, to each place that is ticked. This one never writes
          anywhere: it is the folder the Save As and Export WINDOWS are sitting
          in when they open, a starting point you can then navigate away from.
          Two headings that both began "Sav…" for a destination and a starting
          point.

          Named for the windows now, so the contrast is on screen rather than
          in this comment. The stored key keeps its old name on purpose
          (opendraft:saveloc:downloadFolder) — renaming a key that holds a
          user's chosen path would silently reset it. */}
      <section>
        <h3>Save As &amp; Export Windows</h3>
        <div className="prefs-check-row">
          <span>
            These windows open in
            {downloadFolder ? <code className="prefs-path-chip">{downloadFolder}</code> : ' — the last folder you used'}
          </span>
          <button
            className="dialog-btn dialog-btn-sm prefs-inline-btn"
            onClick={async (e) => {
              e.preventDefault();
              const folder = await pickFolder('Folder for saved and exported files');
              if (folder) setDownloadFolder(folder);
            }}
          >Choose Folder…</button>
          {downloadFolder && (
            <button
              className="dialog-btn dialog-btn-sm prefs-inline-btn"
              onClick={(e) => { e.preventDefault(); setDownloadFolder(''); }}
            >Reset</button>
          )}
        </div>
      </section>
      <section>
        <h3>Screenshots</h3>
        {/* v3.95, Derek: where the Screenshot tool writes PNGs. Empty = the
            browser's Downloads folder. A chosen folder needs the desktop app. */}
        <div className="prefs-check-row">
          <span>
            Save screenshots to
            {screenshotFolder
              ? <code className="prefs-path-chip">{screenshotFolder}</code>
              : ' Downloads (default)'}
          </span>
          <button
            className="dialog-btn dialog-btn-sm prefs-inline-btn"
            onClick={async (e) => {
              e.preventDefault();
              const folder = await pickFolder('Folder for screenshots');
              if (folder) setScreenshotFolder(folder);
            }}
          >Choose Folder…</button>
          {screenshotFolder && (
            <button
              className="dialog-btn dialog-btn-sm prefs-inline-btn"
              onClick={(e) => { e.preventDefault(); setScreenshotFolder(''); }}
            >Reset to Downloads</button>
          )}
        </div>
      </section>
    </div>
  );
}

/* v2.35, Derek: the Tools tab is gone — the Scrapbook declutter toggle
   lives on the Scrapbook window, the Typewriter master switch lives in the
   Typewriter window, and restore-cursor went back to General > Startup. */

/* v7.06: no `editor` param — the only thing on this tab that needed it was
   the Draft Number section, now removed. */
/* v7.06, Derek: "rename the languages tab 'Region'. move the measurements and
   'dates & time' sections into that tab." One tab for everything that depends
   on where you are — spelling language, inches vs centimetres, date and time
   format — instead of language here and units over on General. */
function RegionTab() {
  const {
    dateFormat, setDateFormat,
    units, setUnits,
    timeFormat, setTimeFormat,
  } = useSettingsStore();
  return (
    <div className="prefs-general">
      <LanguageSection />
      <section>
        <h3>Measurements</h3>
        <label className="prefs-check-row">
          <span>Units</span>
          <select
            className="prefs-select"
            value={units}
            onChange={(e) => setUnits(e.target.value as 'in' | 'cm')}
          >
            <option value="in">Inches (in)</option>
            <option value="cm">Centimeters (cm)</option>
          </select>
        </label>
        <p className="prefs-hint">
          How Page Setup shows page size and margins. Stored values never
          change — only the display converts.
        </p>
      </section>

      {/* v1.65: "Default draft label" moved into Settings > Save Options —
          the Draft label field there syncs the current script AND can set
          the default for new scripts. One field, one home. */}

      <section>
        <h3>Dates &amp; Times</h3>
        <label className="prefs-check-row">
          <span>Date format</span>
          <select
            className="prefs-select"
            value={dateFormat}
            onChange={(e) => setDateFormat(e.target.value as DateFormatId)}
          >
            {DATE_FORMATS.map((f) => (
              <option key={f.id} value={f.id}>{f.name} ({f.format(new Date())})</option>
            ))}
          </select>
        </label>
        {/* v7.81, Derek: hint removed (helper-text cull). */}
        <label className="prefs-check-row">
          <span>Time format</span>
          <select
            className="prefs-select"
            value={timeFormat}
            onChange={(e) => setTimeFormat(e.target.value as '12h' | '24h')}
          >
            <option value="12h">12-hour (11:30 PM)</option>
            <option value="24h">24-hour (23:30)</option>
          </select>
        </label>
        {/* v7.81, Derek: hint removed (helper-text cull). */}
      </section>
    </div>
  );
}

function GeneralTab() {
  const restoreCursor = useEditorStore((s) => s.typewriterRestoreCursor);
  const setRestoreCursor = useEditorStore((s) => s.setTypewriterRestoreCursor);
  const {
    autoLoadLastScript, setAutoLoadLastScript,
    spellCheckByDefault, setSpellCheckByDefault,
    windowStartup, setWindowStartup,
    smartTypography, setSmartTypography,
    openToLastTab, setOpenToLastTab,
  } = useSettingsStore();

  return (
    <div className="prefs-general">
      {/* v7.06, Derek: the Draft Number section is GONE from General. (The
          draft label itself still lives on File ▸ Set Draft…; only this
          duplicate entry point is removed.) */}
      <section>
        <h3>Startup</h3>
        {/* v2.35: back home after the Tools tab was removed. */}
        <label className="prefs-check-row">
          <input
            type="checkbox"
            checked={restoreCursor}
            onChange={(e) => setRestoreCursor(e.target.checked)}
          />
          <span>Restore the cursor position when opening a script</span>
        </label>
        <label className="prefs-check-row">
          <input
            type="checkbox"
            checked={autoLoadLastScript}
            onChange={(e) => setAutoLoadLastScript(e.target.checked)}
          />
          <span>Open the last edited script when the app starts</span>
        </label>
        <p className="prefs-hint">
          When off, the app starts at the New Script prompt and you open
          scripts from File → Open.
        </p>
        <label className="prefs-check-row">
          <span>Window on launch</span>
          <select
            className="prefs-select"
            value={windowStartup}
            onChange={(e) => setWindowStartup(e.target.value as 'maximized' | 'remember')}
          >
            <option value="maximized">Open maximized</option>
            <option value="remember">Remember last size and position</option>
          </select>
        </label>
        <label className="prefs-check-row">
          <input
            type="checkbox"
            checked={openToLastTab}
            onChange={(e) => setOpenToLastTab(e.target.checked)}
          />
          <span>Reopen windows on their last used tab</span>
        </label>
        {/* v7.81, Derek: hint removed (helper-text cull). */}
      </section>

      {/* v4.26, Derek: "Match the system appearance" moved to Customize >
          Themes (next to the theme picker it overrides); "Menu bar lives in"
          moved to Customize > Menu Bar (it's menu-chrome configuration, and
          the way back from native mode was stranded here). */}

      <section>
        <h3>Editing</h3>
        <label className="prefs-check-row">
          <input
            type="checkbox"
            checked={spellCheckByDefault}
            onChange={(e) => setSpellCheckByDefault(e.target.checked)}
          />
          <span>Check spelling as you type</span>
        </label>
        {/* v7.81, Derek: hint removed (helper-text cull). */}
        {/* v3.24, Derek's menu reorg #6: the rules panel opens from HERE now
            (it left the Project > Spell Check submenu — it's configuration).
            The bus command is the same one the old menu item used. */}
        <div className="prefs-check-row">
          <button
            className="dialog-btn dialog-btn-sm"
            onClick={() => window.dispatchEvent(new CustomEvent('scriptcraft:command', { detail: 'grammarSettings' }))}
          >Grammar &amp; Spelling Settings…</button>
        </div>
        <label className="prefs-check-row">
          <input
            type="checkbox"
            checked={smartTypography}
            onChange={(e) => setSmartTypography(e.target.checked)}
          />
          <span>Replace straight quotes and dashes as you type</span>
        </label>
        <p className="prefs-hint">
          Turns "quotes" into “curly quotes” and two hyphens into an em
          dash (—). Applies immediately; text already typed is untouched.
        </p>
      </section>

      {/* v7.06, Derek: Measurements and Dates & Times moved to REGION. */}
    </div>
  );
}

/* v7.14, Derek: "remove BACKUP & RESTORE from the general tab in settings and
   make it its own tab at the bottom of the list. move the Presets section from
   the Defaults tab to the new 'Backup & Restore' tab." Both of these are
   "carry my setup somewhere else", so they belong together: the whole-app
   backup file, and the per-part preset bundle. */
function BackupRestoreTab() {
  // v4.22, Derek: dev and a release build load from different
  // origins, so their localStorage (all settings/customizations) is separate —
  // export here, import into the other app.
  const fileRef = React.useRef<HTMLInputElement>(null);
  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';               // allow re-picking the same file later
    if (!file) return;
    try {
      const text = await readFileText(file);
      /* v7.28: Export beside this button opens the PRESET window now, so
         this must read what that writes — a preset bundle — as well as the
         backup files written before it. An export/import pair where the
         export's own file will not load is the silent no-op this project
         treats as the cardinal sin. */
      let bundleIds: string[] | null = null;
      try { bundleIds = readPresetFile(text).ids; } catch { bundleIds = null; }
      const ok = await confirmDialog(
        bundleIds
          ? `This preset contains: ${bundleIds.join(', ')}. Importing overrides what you have for each, then reloads. Your scripts are not affected.`
          : 'This replaces this app\'s current settings and customizations with the ones in the file, then reloads. Your scripts are not affected.',
        { title: bundleIds ? 'Import preset?' : 'Import settings?', confirmLabel: 'Import & Reload', danger: true },
      );
      if (!ok) return;
      if (bundleIds) {
        const { applied } = applyPresetFile(text);
        showToast(`Imported ${applied.join(', ')} — reloading…`);
      } else {
        const { imported } = applyBackup(text);
        showToast(`Imported ${imported} settings — reloading…`);
      }
      setTimeout(() => window.location.reload(), 500);
    } catch (err) {
      showToast((err as Error).message || 'Could not import that file.');
    }
  };

  return (
    <div className="prefs-general">
      {/* v7.31, Derek: "remove the old 'backup and restore' section… rename
          the sections currently named 'Presets' to 'Backup'… move the import
          preset button to a new section called 'Restore'."

          The old section was the tail of v7.28: its Export was routed into the
          one preset window, leaving a heading whose only remaining control was
          an Import. Backup is what you WRITE, Restore is what you READ — and
          the checklist is the backup, so there is nothing else for a separate
          settings-only section to be. */}
      <section>
        <h3>Backup</h3>
        {/* v7.81, Derek's pass over this tab: his wording, hints flush with
            the headings (prefs-hint's 26px indent is for hints under a
            checkbox row — these two sit under an h3). */}
        {/* v7.82, Derek: one paragraph — the safety sentence follows "…safe
            keeping" instead of dangling under the checklist. */}
        <p className="prefs-hint prefs-hint-flush">
          Settings and customizations live in this app's local storage, which
          isn't shared between installs. Back them up for safe keeping. Login
          info, cloud tokens, and device identity are left out of the file for
          safety.
        </p>
        <PresetsPanel showImports={false} />
      </section>
      <section>
        <h3>Restore</h3>
        <p className="prefs-hint prefs-hint-flush">
          Load a file saved above. It overrides what you have for whatever the
          file carries, then reloads. Your scripts are not affected.
        </p>
        {/* v7.81, Derek: an empty row between the text and the button. */}
        <div className="prefs-gap-row" />
        <div className="prefs-check-row">
          {/* ONE import door, and it reads both shapes — the preset files the
              Backup section writes and the whole-app settings files written
              before v7.28. Which one it is, is read off the file. */}
          <button className="dialog-btn dialog-btn-sm" onClick={() => fileRef.current?.click()}>
            Restore from a file…
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            style={{ display: 'none' }}
            onChange={handleImportFile}
          />
        </div>
      </section>
    </div>
  );
}

/* v7.06: `editor` is still accepted so every call site keeps working, but no
   tab needs it now that Draft Number is gone — hence the void below. */
export default function PreferencesDialog({ open, onClose, editor, openTab }: {
  open: boolean;
  onClose: () => void;
  editor?: Editor | null;
  /** v1.21: open straight ON a tab — Save As sends you to Save Options. */
  openTab?: PrefTab;
}) {
  // v7.51: Page Setup uses it again — its list can apply a template to the
  // open script now, which needs the editor for the conflict pass and for
  // seeding starter content into an empty document.
  const [tab, setTab] = useState<PrefTab>('general');

  /* v6.99 (Derek, via the feedback form): Save/Cancel footer, Customize-
     style. Settings apply LIVE — Save just closes; Cancel restores the
     open-time snapshot (see utils/settingsSnapshot for why restoration
     goes through the setters). typewriterRestoreCursor is the one
     General-tab field living in editorStore, so it rides alongside. */
  const openSnap = React.useRef<{ settings: Record<string, unknown>; restoreCursor: boolean } | null>(null);
  React.useEffect(() => {
    if (open) {
      openSnap.current = {
        settings: snapshotSettings(),
        restoreCursor: useEditorStore.getState().typewriterRestoreCursor,
      };
    }
  }, [open]);
  const saveAndClose = () => { showToast('Settings saved', 'success'); onClose(); };
  const cancelAndClose = () => {
    const snap = openSnap.current;
    if (snap) {
      let n = restoreSettings(snap.settings);
      if (useEditorStore.getState().typewriterRestoreCursor !== snap.restoreCursor) {
        useEditorStore.getState().setTypewriterRestoreCursor(snap.restoreCursor);
        n++;
      }
      if (n > 0) showToast('Settings changes reverted');
    }
    onClose();
  };

  // v4.71, Derek: reopen on the last-used tab (Settings ▸ General toggle).
  // Runs on the open edge, BEFORE the openTab effect below — a targeted open
  // still lands where it was sent.
  useWindowTabMemory('settings', tab, setTab, 'general', ALL_PREF_TAB_IDS, open);

  // v1.21: land ON the tab you were sent to. Scrolling alone was useless if Settings
  // happened to be sitting on a different tab — the section wasn't even rendered.
  React.useEffect(() => {
    if (open && openTab) setTab(openTab);
  }, [open, openTab]);

  /* v7.24, Derek: "if somehow a window opens while the settings window is
     open, then the settings window should close."
     Watched at the DOM rather than wired into each opener. There are 38
     dialogs — 24 through the Modal shell, 14 still hand-rolling their own
     .dialog-overlay — so a rule inside Modal would have covered two thirds of
     them and looked like it covered all. The overlay is the one thing every
     dialog does have, and this is the WINDOW'S rule about itself, so it lives
     with the window.
     Three exemptions, and each is the same idea — a dialog SETTINGS ITSELF
     raised is Settings talking, not a window opening over it:
       · a confirm renders .fs-confirm-overlay, a different class, so closing
         Settings under its own "are you sure?" cannot happen;
       · an overlay rendered INSIDE this window (Page Setup ▸ View opens the
         real page of fields there) is one of ours — it would otherwise take
         Settings down and itself with it, since Settings renders it;
       · an overlay already MOUNTED when Settings opens never added a node,
         which is what keeps Save As ▸ Save Options working — that dialog
         stays up, hidden, waiting for Settings to close.
     Tool windows are not overlays at all; they close Settings through the
     store's one-window rule (closeOtherFloats). */
  const closeRef = React.useRef(onClose);
  closeRef.current = onClose;
  React.useEffect(() => {
    if (!open) return;
    const isOverlay = (n: Node) => n instanceof HTMLElement
      && (n.classList.contains('dialog-overlay') || !!n.querySelector('.dialog-overlay'));
    const obs = new MutationObserver((records) => {
      const own = document.querySelector('.prefs-window');
      for (const r of records) {
        for (const n of r.addedNodes) {
          if (own?.contains(n)) continue;               // one of ours
          if (isOverlay(n)) { closeRef.current(); return; }
        }
      }
    });
    obs.observe(document.body, { childList: true, subtree: true });
    return () => obs.disconnect();
  }, [open]);

  if (!open) return null;

  return (
    <FloatingWindow
      /* v7.29: remembers the shape it was left in — shrink it out of
         fullscreen and it reopens floating, at the size and place you left
         it. startFullscreen below is now only how it opens the FIRST time. */
      id="settings"
      className="prefs-window"
      /* v7.06, Derek: Settings OPENS full screen over the side panels and the
         editing area; the header's shrink button gives a floating window. */
      startFullscreen
      initial={{ w: 900, h: 660 }}
      min={{ w: 620, h: 420 }}
      onClose={onClose}
      title={<span className="tool-window-title">Settings</span>}
    >
        <div className="prefs-layout">
          {/* v7.11, Derek: "remove the section names for the tabs in the
              settings window. they do not need to be separated into
              sections." One flat list — the three arrays still exist because
              they say what belongs where (and Defaults reads CUSTOMIZE_TABS),
              but the rail renders them end to end with no captions. */}
          <div className="prefs-tabs">
            {SYSTEM_TABS.map((t) => (
              <button
                key={t.id}
                className={`prefs-tab${tab === t.id ? ' active' : ''}`}
                onClick={() => setTab(t.id)}
              >
                <span className="prefs-tab-icon">{t.icon}</span>
                <span>{t.label}</span>
              </button>
            ))}
            {PAGE_TABS.map((t) => (
              <button
                key={t.id}
                className={`prefs-tab${tab === t.id ? ' active' : ''}`}
                onClick={() => setTab(t.id)}
              >
                <span className="prefs-tab-icon">{t.icon}</span>
                <span>{t.label}</span>
              </button>
            ))}
            {TAIL_TABS.map((t) => (
              <button
                key={t.id}
                className={`prefs-tab${tab === t.id ? ' active' : ''}`}
                onClick={() => setTab(t.id)}
              >
                <span className="prefs-tab-icon">{t.icon}</span>
                <span>{t.label}</span>
              </button>
            ))}
            {CUSTOMIZE_TABS.map((t) => (
              <button
                key={t.id}
                className={`prefs-tab${tab === `cz-${t.id}` ? ' active' : ''}`}
                onClick={() => setTab(`cz-${t.id}`)}
              >
                <span className="prefs-tab-icon">{t.icon}</span>
                <span>{t.label}</span>
              </button>
            ))}
            {END_TABS.map((t) => (
              <button
                key={t.id}
                className={`prefs-tab${tab === t.id ? ' active' : ''}`}
                onClick={() => setTab(t.id)}
              >
                <span className="prefs-tab-icon">{t.icon}</span>
                <span>{t.label}</span>
              </button>
            ))}
          </div>
          <div className="prefs-content">
            {tab === 'general' && <GeneralTab />}
            {tab.startsWith('cz-') && (
              <CustomizePanelsDialog
                open
                embedded
                soloCategory={tab.slice(3) as CustomizeCat}
                onClose={() => {}}
              />
            )}
            {tab === 'page' && <PageSetupTab editor={editor} />}
            {tab === 'keys' && <KeyboardShortcutsTab />}
            {tab === 'saveloc' && <SaveLocationsTab />}
            {tab === 'languages' && (
<RegionTab />
            )}
            {tab === 'defaults' && <DefaultsTab />}
            {tab === 'backup' && <BackupRestoreTab />}
          </div>
        </div>
        <div className="prefs-footer">
          <button className="dialog-btn" onClick={cancelAndClose}>Cancel</button>
          <button className="dialog-btn dialog-btn-primary" onClick={saveAndClose}>Save</button>
        </div>
    </FloatingWindow>
  );
}
