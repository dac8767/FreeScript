import React, { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { FolderIcon } from './uiIcons';
import { api } from '../services/api';
import { cloudApi } from '../services/cloudApi';
import { getLibraryId, LIBRARY_NAME } from '../services/scriptLibrary';
import { errText } from '../utils/errText';
import { shortenPathToFit } from '../utils/pathDisplay';
import { formatAppDate } from '../utils/dateFormat';
import { isWeb } from '../services/platform';
import type { ProjectInfo } from '../services/api';
import { useSettingsStore } from '../stores/settingsStore';
import { useEditorStore } from '../stores/editorStore';
import { mirrorSave } from '../services/saveLocations';

export type SaveDestination = 'local' | 'cloud';


interface SaveAsDialogProps {
  defaultFileName: string;
  /** Pre-select the destination tab. Pass 'cloud' when the user came from a
   *  cloud project — otherwise the dialog defaults to 'local' and the
   *  cloud-only project name will not match anything in the local list,
   *  silently filing the new script under a random local project. */
  defaultDestination?: SaveDestination;
  onSaved: (
    projectId: string,
    projectName: string,
    scriptId: string,
    scriptTitle: string,
    destination: SaveDestination,
    draftLabel?: string,
  ) => void;
  onClose: () => void;
  /** Takes you to Settings > Save Locations — the one place copies are configured. */
  onOpenSaveLocations: () => void;
  buildContent: () => Record<string, unknown> | undefined;
  /** v1.34: Draft is ONE value across this dialog, the Title Page, and
   *  Production > Set Draft Number. Called when the user commits an edit to
   *  the Draft field here (blur or Save), so the other two surfaces follow. */
  onDraftCommitted?: (label: string) => void;
}

/** Web is always cloud-backed; the device/cloud toggle would be misleading. */
const WEB_ONLY_CLOUD = isWeb();

/** Banner shown when the user is saving a document that came from an external
 *  file (FDX, Fountain, DOCX, etc.). Clarifies that the save goes into
 *  ScriptCraft's library — it does *not* write back to the source file. */
const ImportedSourceNotice: React.FC = () => {
  const importedSource = useEditorStore((s) => s.importedSource);
  if (!importedSource) return null;
  return (
    <div
      style={{
        padding: '10px 12px',
        margin: '0 0 12px 0',
        border: '1px solid rgba(46,125,215,0.4)',
        background: 'rgba(46,125,215,0.10)',
        borderRadius: 6,
        fontSize: 12,
        color: 'var(--fd-text)',
        lineHeight: 1.45,
      }}
    >
      <strong>Note:</strong> This document was imported from <strong>{importedSource.name}</strong>{' '}
      ({importedSource.format}). Saving creates a new file inside ScriptCraft's library —
      it does <strong>not</strong> overwrite the original source file. To write back to
      the original format, use <em>File → Export</em> after saving.
    </div>
  );
};

/** The switch beside each field: whether that piece joins the composed name.
 *  Script Name's is `locked` — permanently on and disabled, shown at all so
 *  the row doesn't look like the odd one out (v1.26: an empty cell there read
 *  as confusing, not as "always required"). */
const IncludeToggle: React.FC<{
  what: string;
  on: boolean;
  onToggle?: () => void;
  locked?: boolean;
}> = ({ what, on, onToggle, locked }) => (
  <button
    type="button"
    role="switch"
    aria-checked={on}
    disabled={locked}
    aria-label={locked ? `${what} is always included in the name` : `Include ${what} in name`}
    title={locked ? `${what} is always part of the saved name` : 'Include in save filename'}
    className={'fs-toggle' + (on ? ' fs-toggle-on' : '') + (locked ? ' fs-toggle-locked' : '')}
    onClick={locked ? undefined : onToggle}
  >
    <span className="fs-toggle-knob" />
  </button>
);

const SaveAsDialog: React.FC<SaveAsDialogProps> = ({
  defaultFileName,
  defaultDestination,
  onSaved,
  onClose,
  onOpenSaveLocations,
  buildContent,
  onDraftCommitted,
}) => {
  // v0.16: File Name is composed from Draft + Version. Draft autofills from
  // the document's draft label (Edit > Set Draft Number), Version from
  // today's date in MM/DD/YY — both editable.
  const initialDraft = useEditorStore.getState().draftLabel || 'First Draft';
  // v1.59: today's date rendered per Settings > General > Date format.
  const todayStr = formatAppDate(new Date(), useSettingsStore.getState().dateFormat);
  const [draft, setDraft] = useState(initialDraft);
  // v1.50: New Script's Version carries through; today's date is the fallback.
  const [version, setVersion] = useState(useEditorStore.getState().versionLabel || todayStr);
  // v1.22: Draft and Version are optional PARTS OF THE NAME, and the toggles
  // say so. Off means "keep the field's value, just don't write it into the
  // name". Script Name has no toggle — it is the name.
  const [includeDraft, setIncludeDraft] = useState(true);
  const [includeVersion, setIncludeVersion] = useState(true);

  /*
   * v1.15 — THE SCRIPT HAS A NAME AGAIN, and it is the script's own.
   *
   * v1.14 got the model wrong. In the old world the PROJECT carried the name of the
   * script and a "script" was one draft inside it, titled "Draft - Date". So when
   * I removed the project field I removed the only place you could name your work:
   * Save As asked for a draft and a date, filed the script in whatever container was
   * lying around, and the status bar showed that container's name — which is why a
   * brand-new script came back called "Test".
   *
   * Now a ScriptCraft file is one script, so the NAME belongs to the script. Draft and
   * version are what they always should have been: metadata about which draft this
   * is, not the identity of the work.
   */
  const [name, setName] = useState(defaultFileName || 'Untitled');

  // Where copies go — read from Settings, changed in Settings. Shown here so you can
  // see what a save is about to do without having to go and look.
  const localSaveFolder = useSettingsStore((st) => st.localSaveFolder);
  const setLocalSaveFolder = useSettingsStore((st) => st.setLocalSaveFolder);
  const saveToGDrive = useSettingsStore((st) => st.saveToGDrive);
  const saveToOneDrive = useSettingsStore((st) => st.saveToOneDrive);
  const saveToBackupFolder = useSettingsStore((st) => st.saveToBackupFolder);
  const backupSaveFolder = useSettingsStore((st) => st.backupSaveFolder);
  const otherLocations = [
    // v6.41: the backup folder receives a copy too — the chip list must say
    // everything a save is about to do (mirrorSave's gate is the same pair).
    saveToBackupFolder && !!backupSaveFolder && 'Local backup',
    saveToGDrive && 'Google Drive',
    saveToOneDrive && 'OneDrive',
  ].filter(Boolean) as string[];

  const chooseFolder = async () => {
    try {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const picked = await open({ directory: true, multiple: false, title: 'Where should ScriptCraft keep this script?' });
      if (typeof picked !== 'string') return;

      /*
       * v1.18: PROVE we can write there, now, while you're looking at it.
       *
       * The folder was accepted without a check, and the failure surfaced later — at
       * save time, as a frightening "could not save your changes". Whatever the
       * reason (permissions, a read-only volume, an unmounted drive), you should find
       * out when you pick the folder, not when you're trying to save your work.
       *
       * v7.17: the probe runs in RUST (check_folder_writable). It was the only
       * thing here that needed the fs plugin's write + remove permissions, and
       * the capability is now $APPDATA-only — a folder you picked is by
       * definition outside that. v1.20's lesson travelled with it: the probe
       * is not a dotfile, because the plugin's glob scopes did not match
       * leading-dot names and the check invented the failure it looked for.
       */
      const { invoke } = await import('@tauri-apps/api/core');
      try {
        await invoke('check_folder_writable', { folder: picked });
      } catch (err) {
        // Tauri rejects with a STRING, so (err as Error).message was undefined and the
        // real reason — which permission, which path — was lost. errText keeps it.
        console.error('[ScriptCraft] folder write test failed:', err);
        setError(
          `ScriptCraft can't write to that folder — nothing has been changed. ` +
          `Pick another, or check the folder's permissions. (${errText(err)})`,
        );
        return;
      }

      setLocalSaveFolder(picked);
      setError('');
    } catch (err) {
      console.error('[ScriptCraft] folder picker failed:', err);
      setError(`Could not open the folder picker: ${errText(err)}`);
    }
  };
  const fileName = name.trim();
  /** v1.34: push an edited Draft back to the shared value (store + title
   *  page) the moment it's committed — the field stays editable here, but
   *  all three Draft surfaces show the same thing. */
  const commitDraft = () => {
    const d = draft.trim();
    if (d && d !== useEditorStore.getState().draftLabel) onDraftCommitted?.(d);
  };
  const draftLabel = [
    includeDraft ? draft.trim() : '',
    includeVersion ? version.trim() : '',
  ].filter(Boolean).join(' - ');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  /*
   * The script's home: the app's local store on desktop, the cloud on the web where
   * there is no local store. This is no longer a question the dialog asks — copies
   * are what Settings > Save Locations is for.
   */
  const destination: SaveDestination = WEB_ONLY_CLOUD ? 'cloud' : (defaultDestination ?? 'local');
  const fileInputRef = useRef<HTMLInputElement>(null);

  /*
   * v1.43: grab the header, move the dialog — same gesture as the tool
   * windows. The box is flex-centered by its overlay until the first drag,
   * which measures where it actually is, pins it fixed, and follows the
   * pointer from there.
   */
  const boxRef = useRef<HTMLDivElement>(null);
  const startDialogDrag = (e: React.PointerEvent) => {
    const el = boxRef.current;
    if (!el || (e.target as HTMLElement).closest('button, input')) return;
    e.preventDefault();
    const rect = el.getBoundingClientRect();
    const startX = e.clientX;
    const startY = e.clientY;
    const onMove = (ev: PointerEvent) => {
      el.style.position = 'fixed';
      el.style.margin = '0';
      el.style.left = `${rect.left + (ev.clientX - startX)}px`;
      el.style.top = `${Math.max(0, rect.top + (ev.clientY - startY))}px`;
    };
    const onUp = () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  };

  /*
   * v1.23: "Update save locations…" must ROUND-TRIP.
   *
   * It used to close this dialog on the way to Settings, unmounting it — so the
   * name, draft and toggles you'd already filled in were gone when you came
   * back. The dialog now stays mounted and merely hides while Settings is on
   * top; when Settings closes, it reappears exactly as you left it. (The
   * "Additional locations:" line updates by itself — it reads the settings
   * store live.)
   */
  const prefsOpen = useEditorStore((s) => s.preferencesRequest.open);

  /*
   * v1.22: shorten the path at "/" boundaries, not wherever the pixels run out.
   * The old CSS clip (direction: rtl + ellipsis) produced "…s/dcarl/Downloads/",
   * which reads as a folder that doesn't exist. We measure the button's actual
   * width and drop whole leading segments until the rest fits — and re-measure
   * when the (resizable) dialog changes size. Where measurement isn't available
   * (jsdom, a canvas-less WebView), the full path renders and the CSS ellipsis
   * remains the backstop.
   */
  const pathBtnRef = useRef<HTMLButtonElement>(null);
  const [displayPath, setDisplayPath] = useState(localSaveFolder);
  useLayoutEffect(() => {
    const btn = pathBtnRef.current;
    if (!btn || !localSaveFolder) {
      setDisplayPath(localSaveFolder);
      return;
    }
    const recompute = () => {
      const ctx = document.createElement('canvas').getContext('2d');
      if (!ctx) {
        setDisplayPath(localSaveFolder);
        return;
      }
      const style = getComputedStyle(btn);
      ctx.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
      const max = btn.clientWidth;
      setDisplayPath(
        max > 0
          ? shortenPathToFit(localSaveFolder, (s) => ctx.measureText(s).width <= max)
          : localSaveFolder,
      );
    };
    recompute();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(recompute);
    ro.observe(btn);
    return () => ro.disconnect();
  }, [localSaveFolder]);

  // Re-fetch projects when the signed-in user changes. The dialog can open
  // while the user is anonymous (we got a 401 on the initial listProjects),
  // AuthGate then prompts a sign-in, and when the token lands we want to
  // reload the list so a subsequent save doesn't hit 409 on a project the
  // user actually already owns.
  const accessToken = useSettingsStore((s) => s.collabAuth.accessToken);
  const authVerified = useSettingsStore((s) => s.authVerified);
  const signedIn = Boolean(accessToken && authVerified);


  // Focus the file name input once the project name has been auto-populated
  // by the projects-list load. Two guards:
  //  - didInitialFocusRef: only fire once, so clearing & retyping doesn't
  //    yank focus.
  //  - active-element check inside the timer: if the user has already
  //    clicked into the project input (e.g. they were faster than the
  //    list load), don't steal their focus mid-typing.
  const didInitialFocusRef = useRef(false);
  useEffect(() => {
    if (didInitialFocusRef.current) return;
    didInitialFocusRef.current = true;
    // Small delay to let React render the field
    const t = setTimeout(() => {
      // If the user has already focused (or typed into) any input in this
      // dialog, leave them alone — auto-focus is only a convenience when
      // they haven't engaged with the form yet.
      const active = document.activeElement;
      if (active && active.tagName === 'INPUT') return;
      fileInputRef.current?.focus();
      fileInputRef.current?.select();
      // Android: the soft keyboard appears ~150-300ms after focus and the
      // visual viewport shrinks — explicitly scroll the input into view so
      // it's not hidden behind the keyboard, with a follow-up scroll once
      // the IME has finished animating.
      fileInputRef.current?.scrollIntoView({ block: 'center', behavior: 'auto' });
      setTimeout(() => {
        fileInputRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }, 350);
    }, 50);
    return () => clearTimeout(t);
  }, []);


  const handleSave = async () => {
    const trimmedFile = fileName.trim();
    if (!trimmedFile) return;   // a title is the only thing a save needs now

    if (destination === 'cloud' && !signedIn) {
      // AuthGate handles dispatching the login dialog. The user can re-click
      // Save once they're back; the projects list will refresh automatically
      // via the auth-token effect dependency.
      window.dispatchEvent(new CustomEvent('opendraft:auth-required'));
      return;
    }

    commitDraft();
    setSaving(true);
    setError('');

    const client = destination === 'cloud' ? cloudApi : api;

    try {
      /*
       * v1.14: nothing to pick, create or reconcile. A ScriptCraft file is one script,
       * so it goes in the one library. This used to create a project from a typed
       * name, handle the 409 when it already existed, refetch, and then surface
       * "Could not create project" to someone who had merely tried to save their
       * script.
       */
      const project = { id: await getLibraryId(client), name: LIBRARY_NAME } as ProjectInfo;

      // Create script in the project
      const content = buildContent();
      const scriptResp = await client.createScript(project.id, {
        title: trimmedFile,
        content: content || undefined,
      });

      // Fan out to enabled secondary save locations (Settings > Save Locations)
      if (content) {
        void mirrorSave({
          projectId: project.id,
          scriptId: scriptResp.meta.id,
          projectName: LIBRARY_NAME,
          title: trimmedFile,
          content,
        });
      }
      onSaved(project.id, LIBRARY_NAME, scriptResp.meta.id, trimmedFile, destination, draftLabel);
    } catch (err) {
      // AuthGate / QuotaExceededDialog already showed a dialog for these —
      // don't duplicate the raw message inline.
      if (!(err as any)?.handled) {
        setError(err instanceof Error ? err.message : 'Save failed');
      }
      setSaving(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && fileName.trim()) {
      handleSave();
    } else if (e.key === 'Escape') {
      onClose();
    }
  };

  return (
    <div className="dialog-overlay" style={prefsOpen ? { display: 'none' } : undefined} onClick={onClose}>
      <div ref={boxRef} className="dialog-box fs-saveas-dialog" onClick={(e) => e.stopPropagation()} onKeyDown={handleKeyDown}>
        <div className="dialog-header" onPointerDown={startDialogDrag}>Save Script</div>
        <div className="dialog-body">
          <ImportedSourceNotice />

          {/*
            * v1.21 — laid out like an export panel: one column of labels, one column
            * of controls, and the destination shown as a path you can click rather
            * than a text box you can't type into anyway.
            *
            * Order matters here: what the script is CALLED comes first, because that's
            * what you came to this dialog to decide. Where copies of it go is settled
            * once and rarely revisited, so it sits at the bottom.
            */}
          <div className="fs-saveas-grid">

            {/* First grid child: takes the toggle column of an otherwise empty
              * row, so the header sits above the switches it labels. */}
            <span className="fs-saveas-colhead">Include</span>

            <label htmlFor="saveas-name">Script Name:</label>
            <input
              id="saveas-name"
              ref={fileInputRef}
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Script name"
            />
            <IncludeToggle what="Script Name" on locked />

            <label htmlFor="saveas-draft">Draft:</label>
            <input
              id="saveas-draft"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={handleKeyDown}
              onBlur={commitDraft}
              placeholder="First Draft"
            />
            <IncludeToggle what="Draft" on={includeDraft} onToggle={() => setIncludeDraft(!includeDraft)} />

            <label htmlFor="saveas-version">Version:</label>
            <input
              id="saveas-version"
              value={version}
              onChange={(e) => setVersion(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={todayStr}
            />
            <IncludeToggle what="Version" on={includeVersion} onToggle={() => setIncludeVersion(!includeVersion)} />

            {/* v1.48: the name-composition fields end here; locations below.
              * No line any more — just a wider-than-usual breath. */}
            <div className="fs-saveas-sectiongap" aria-hidden="true" />

            {!WEB_ONLY_CLOUD && (
              <>
                <label>Location on this device:</label>
                {/* v1.37: sits in the field column only, so the path box is
                  * exactly as long as the three fields above it. */}
                <div className="fs-saveas-folder">
                  <button
                    type="button"
                    ref={pathBtnRef}
                    className="fs-saveas-path"
                    onClick={chooseFolder}
                    title={localSaveFolder ? `${localSaveFolder} — click to change` : 'Choose a folder'}
                  >
                    {localSaveFolder ? displayPath : 'Choose a folder…'}
                  </button>
                </div>
                {/* v1.42: same action as the path text, in the toggle column. */}
                <button
                  type="button"
                  className="fs-saveas-folderbtn"
                  title="Choose a folder"
                  aria-label="Choose a folder"
                  onClick={chooseFolder}
                ><FolderIcon /></button>
              </>
            )}

            <label>Additional save locations:</label>
            <div className="fs-saveas-locations fs-saveas-span">
              {/* v1.26: one location per line, not a comma run — the list is
                * short and each entry is a place, not a word. */}
              <div className="fs-saveas-locations-list">
                {otherLocations.length
                  ? otherLocations.map((loc) => <span key={loc} className="fs-saveas-loc-chip">{loc}</span>)
                  : <span className="fs-saveas-loc-chip fs-saveas-loc-none">None</span>}
              </div>
              <button
                type="button"
                className="fs-saveas-change"
                onClick={onOpenSaveLocations}
              >Update save locations…</button>
            </div>

          </div>
          {error && (
            <div style={{ color: 'var(--fd-danger)', fontSize: 12, marginTop: 8 }}>{error}</div>
          )}
        </div>
        <div className="dialog-actions">
          {/* v1.30: the composed name lives down here with the buttons that
            * act on it. The flexible gap keeps it clear of Cancel, and the
            * dialog's min-width: fit-content widens the WINDOW rather than
            * clipping a long filename. */}
          <span className="fs-saveas-rowlabel">Saves as:</span>
          <div className="save-as-preview">
            {fileName || '—'}
            {draftLabel && <span className="fs-saveas-draft"> - {draftLabel}</span>}
          </div>
          <span className="fs-saveas-actions-gap" aria-hidden="true" />
          <button onClick={onClose}>Cancel</button>
          <button
            className="dialog-btn dialog-btn-primary"
            onClick={handleSave}
            disabled={saving || !fileName.trim()}
          >
            {saving
              ? 'Saving...'
              : destination === 'cloud' ? 'Save to Cloud' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default SaveAsDialog;
