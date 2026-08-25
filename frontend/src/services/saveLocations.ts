/**
 * saveLocations — the Save Locations engine (Settings → Save Locations).
 *
 * Manual Save / Save As always writes to the script's home and then FANS
 * OUT to every additional enabled destination:
 *   - Local folders — the chosen device folder(s), as real .odraft files.
 *   - Google Drive— the document JSON written to a ScriptCraft folder
 *                   (drive.file scope: the app only ever sees its own files).
 *   - OneDrive    — same, via Microsoft Graph path addressing.
 * (v6.42: the account-backed "Cloud" mirror is gone with the account UI.)
 *
 * Snapshots can additionally be copied to one chosen destination.
 * Failures never block the primary save; each failing destination is
 * reported through the blocking acknowledge modal (per Derek's spec).
 */
import { useSettingsStore } from '../stores/settingsStore';
import { useEditorStore } from '../stores/editorStore';
// Static on purpose: MenuBar/ScreenplayEditor already import odraftFormat
// statically, so a dynamic import here could never split a chunk — it only
// produced a build warning on every run (v4.62 audit).
import { exportOdraft } from '../utils/odraftFormat';
import { scriptFileName } from '../utils/scriptFileExt';
import { reportSaveError } from '../stores/saveErrorStore';
import { errText } from '../utils/errText';
import {
  connect, getAccessToken, tokensPresent, clearTokens, type ProviderConfig,
} from './oauthPkce';

/* ── Provider configs ──────────────────────────────────────────────────── */

export function gdriveConfig(): ProviderConfig {
  return {
    storageKey: 'opendraft:gdriveTokens',
    authEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenEndpoint: 'https://oauth2.googleapis.com/token',
    clientId: useSettingsStore.getState().gdriveClientId,
    scope: 'https://www.googleapis.com/auth/drive.file',
    extraAuthParams: { access_type: 'offline', prompt: 'consent' },
  };
}

export function onedriveConfig(): ProviderConfig {
  return {
    storageKey: 'opendraft:onedriveTokens',
    authEndpoint: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    tokenEndpoint: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    clientId: useSettingsStore.getState().onedriveClientId,
    scope: 'Files.ReadWrite offline_access openid',
  };
}

export const connectGDrive = () => connect(gdriveConfig());
export const connectOneDrive = () => connect(onedriveConfig());
// v7.90 (D9): the connected-check reads the sync presence marker, not the token
// itself (the secret now lives in the async keychain). disconnect clears the
// keychain entry (async, fire-and-forget — the UI flips immediately).
export const gdriveConnected = () => tokensPresent('opendraft:gdriveTokens');
export const onedriveConnected = () => tokensPresent('opendraft:onedriveTokens');
export const disconnectGDrive = () => { void clearTokens('opendraft:gdriveTokens'); };
export const disconnectOneDrive = () => { void clearTokens('opendraft:onedriveTokens'); };

/* ── Small persistent maps (mirror IDs / remote file IDs) ──────────────── */

function mapGet(key: string): Record<string, string> {
  try { return JSON.parse(localStorage.getItem(key) || '{}'); } catch { return {}; }
}
function mapSet(key: string, m: Record<string, string>): void {
  try { localStorage.setItem(key, JSON.stringify(m)); } catch { /* ignore */ }
}

const GDRIVE_MAP = 'opendraft:saveloc:gdriveFiles';

function safeName(s: string): string {
  return (s || 'Untitled').replace(/[\\/:*?"<>|]/g, '-').slice(0, 120);
}

/* ── Google Drive ──────────────────────────────────────────────────────── */

async function driveFetch(token: string, url: string, init?: RequestInit): Promise<any> {
  const res = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...(init?.headers || {}) },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Google Drive ${res.status}: ${text.slice(0, 160)}`);
  }
  return res.status === 204 ? null : res.json();
}

async function driveEnsureFolder(token: string, name: string, parentId?: string): Promise<string> {
  const q = encodeURIComponent(
    `name = '${name.replace(/'/g, "\\'")}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false` +
    (parentId ? ` and '${parentId}' in parents` : ''),
  );
  const list = await driveFetch(token, `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id)`);
  if (list.files?.length) return list.files[0].id;
  const created = await driveFetch(token, 'https://www.googleapis.com/drive/v3/files?fields=id', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name, mimeType: 'application/vnd.google-apps.folder',
      ...(parentId ? { parents: [parentId] } : {}),
    }),
  });
  return created.id;
}

async function driveUpload(token: string, fileName: string, json: string, folderId: string, existingId?: string): Promise<string> {
  const metadata = existingId
    ? { name: fileName }
    : { name: fileName, parents: [folderId] };
  const boundary = 'fd_boundary_7f3a';
  const body =
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\nContent-Type: application/json\r\n\r\n${json}\r\n--${boundary}--`;
  const url = existingId
    ? `https://www.googleapis.com/upload/drive/v3/files/${existingId}?uploadType=multipart&fields=id`
    : 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id';
  const res = await driveFetch(token, url, {
    method: existingId ? 'PATCH' : 'POST',
    headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
    body,
  });
  return res.id;
}

async function saveToGDrive(args: SavePayload): Promise<void> {
  const token = await getAccessToken(gdriveConfig());
  const root = await driveEnsureFolder(token, 'ScriptCraft');
  // v1.15: the file is named after the SCRIPT. It used to be
  // "<container> — <draft>.odraft.json", from when a project was the script —
  // which produced files called "Test — Draft 1 - 07-12-26.odraft.json" and, worse,
  // named a brand-new script after whatever container it landed in.
  /* v7.18: the same file every other copy writes — a real .odraft envelope,
     from the one serializer. This wrote the BARE document under a
     `.odraft.json` name, exactly like the local mirror did, so a script
     fetched back out of Drive would not open either. Updating an existing
     file also renames it (driveUpload sends `name` on PATCH), so the copies
     already up there are corrected on the next save rather than stranded. */
  const fileName = scriptFileName(safeName(args.title));
  const text = await odraftTextFor(args.title, args.content);
  const map = mapGet(GDRIVE_MAP);
  const key = `${args.projectId}/${args.scriptId}`;
  let fileId = map[key];
  try {
    fileId = await driveUpload(token, fileName, text, root, fileId || undefined);
  } catch (err) {
    // Stale file id (deleted in Drive) → create fresh once.
    const msg = err instanceof Error ? err.message : String(err);
    if (map[key] && msg.includes('404')) {
      fileId = await driveUpload(token, fileName, text, root);
    } else throw err;
  }
  map[key] = fileId;
  mapSet(GDRIVE_MAP, map);
}

/* v7.20: a snapshot in the cloud is a SCRIPT — it opens, like every other
   copy. These two wrote the bare document as `.json`, the same fault v7.18
   fixed locally and v7.19 fixed for the cloud SAVES; the snapshot pair was
   missed both times because their name never contained "odraft" to grep for.
   Six writers, one serializer. The label already opens with the script title,
   so the projectName prefix went with it — it only repeated the folder. */
async function snapshotToGDrive(label: string, text: string): Promise<void> {
  const token = await getAccessToken(gdriveConfig());
  const root = await driveEnsureFolder(token, 'ScriptCraft');
  const snaps = await driveEnsureFolder(token, 'Snapshots', root);
  await driveUpload(token, scriptFileName(safeName(label)), text, snaps);
}

/* ── OneDrive (Microsoft Graph, path addressing) ───────────────────────── */

async function onedrivePut(token: string, path: string, json: string): Promise<void> {
  const url = `https://graph.microsoft.com/v1.0/me/drive/root:/${path.split('/').map(encodeURIComponent).join('/')}:/content`;
  const res = await fetch(url, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: json,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`OneDrive ${res.status}: ${text.slice(0, 160)}`);
  }
}

async function saveToOneDrive(args: SavePayload): Promise<void> {
  const token = await getAccessToken(onedriveConfig());
  /* v7.18: see saveToGDrive — same bug, same fix. Path addressing means the
     new name is a new file; the old `.odraft.json` stays put and still opens. */
  const path = `ScriptCraft/${scriptFileName(safeName(args.title))}`;
  await onedrivePut(token, path, await odraftTextFor(args.title, args.content));
}

async function snapshotToOneDrive(label: string, text: string): Promise<void> {
  const token = await getAccessToken(onedriveConfig());
  await onedrivePut(token, `ScriptCraft/Snapshots/${scriptFileName(safeName(label))}`, text);
}

/* ── Orchestration ─────────────────────────────────────────────────────── */

export interface SavePayload {
  projectId: string;
  scriptId: string;
  projectName: string;
  title: string;
  content: Record<string, unknown>;
}

/** Fan a successful primary save out to every enabled secondary location.
 *  Never throws; each failure raises the blocking acknowledge modal. */
/**
 * v1.16 — write a copy into the folder you chose in Save As.
 *
 * "Local System (always on)" means the app's own database, which lives inside
 * Application Support where you will never look for it. If you pick a folder, the
 * script is also written there as a real file you can find, back up and open.
 */
/**
 * THE copy-in-a-folder serializer. Both mirrors use it — the Save As copy
 * here and the auto-save copy below.
 *
 * v7.18, Derek, testing v7.17: "saved on desktop. it saved as Episode
 * X.odraft.json / it will not open in the app." It could not: this mirror
 * wrote the BARE TipTap document, while a real .odraft is an envelope
 * (`format: 'opendraft-script'`, a version, meta, then content). So
 * parseOdraft rejected it as "unrecognized format" — and it never got that
 * far anyway, because the name ends `.json`, which File ▸ Open does not
 * offer and the desktop open-handler does not accept.
 *
 * The auto-save mirror had been doing it correctly since v6.42 — same
 * feature, same folder, two writers, and only one of them right. That is the
 * drift CLAUDE.md warns about, and the v1.16 comment above states the
 * intention this failed: "a real file you can find, back up and open."
 */
export async function odraftTextFor(title: string, content: Record<string, unknown>): Promise<string> {
  const blob = exportOdraft({
    id: '', title, author: '', format: 'json',
    created_at: '', updated_at: '', page_count: 0,
    size_bytes: 0, color: '', pinned: false, sort_order: 0, preview: '',
  }, content);
  return blob.text();
}

/** Where the copy lands. Exported because two test files had each written
 *  their OWN copy of this rule and asserted against that — so both kept
 *  passing while the app wrote a file nobody could open (v7.18). A test that
 *  reimplements the thing it tests proves only that the copy is consistent
 *  with itself. */
export function mirrorPathFor(folder: string, title: string): string {
  const sep = folder.endsWith('/') ? '' : '/';
  return `${folder}${sep}${scriptFileName(safeName(title))}`;
}

async function saveToLocalFolder(args: SavePayload, folder: string): Promise<void> {
  /* v7.17: through the Rust command, like the auto-save mirror eighty lines
     below already did. The fs plugin's scope is $APPDATA now, and this writes
     to a folder the user picked — which is the whole point of the feature. */
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke('save_text_to_path', {
    path: mirrorPathFor(folder, args.title),
    contents: await odraftTextFor(args.title, args.content),
  });
}

export async function mirrorSave(payload: SavePayload): Promise<void> {
  const s = useSettingsStore.getState();
  const jobs: Array<{ name: string; run: () => Promise<void> }> = [];
  if (s.localSaveFolder) {
    jobs.push({ name: 'This device', run: () => saveToLocalFolder(payload, s.localSaveFolder) });
  }
  /* v6.41, Derek: "Local System (backup location)" — a second folder on this
     device. Both the checkbox AND a chosen folder are required; the checkbox
     alone can't silently arm a write into nowhere. */
  if (s.saveToBackupFolder && s.backupSaveFolder) {
    jobs.push({ name: 'Local backup', run: () => saveToLocalFolder(payload, s.backupSaveFolder) });
  }
  if (s.saveToGDrive) jobs.push({ name: 'Google Drive', run: () => saveToGDrive(payload) });
  if (s.saveToOneDrive) jobs.push({ name: 'OneDrive', run: () => saveToOneDrive(payload) });
  if (jobs.length === 0) return;

  const { setMirrorStatus } = useEditorStore.getState();
  const failures: string[] = [];
  await Promise.all(jobs.map(async (j) => {
    setMirrorStatus(j.name, 'saving');
    try {
      await j.run();
      setMirrorStatus(j.name, 'saved');
    } catch (err) {
      setMirrorStatus(j.name, 'error');
      console.error(`Save Locations: ${j.name} failed`, err);
      failures.push(`${j.name}: ${errText(err)}`);
    }
  }));
  if (failures.length > 0) {
    reportSaveError(
      new Error(`The script saved to its home location, but ${failures.length === 1 ? 'a secondary save location' : `${failures.length} secondary save locations`} failed —\n${failures.join('\n')}`),
      'save-location',
    );
  }
}

/**
 * The name a copy gets, for every destination.
 *
 * v7.20, Derek, looking at what auto save produced — "Auto Save — Episode X —
 * Auto save — 08-15-26 23.15.odraft": "the filename shouldnt have spaces
 * either. make autosave filenames in this format:
 * EpisodeX_autosave_08-15-26_23-15.odraft"
 *
 * So: no spaces anywhere, underscores between the parts, hyphens inside the
 * date and the time. Spaces in a name are the kind of thing that survives
 * fine in Finder and then bites in a terminal, a URL or a script.
 *
 * The kind is no longer hard-coded per destination — it comes from the
 * caller's `message`, which is 'autosave' on a tick and whatever the writer
 * typed for File ▸ Take Snapshot. That is why the old local name said it
 * twice AND called a hand-made snapshot an auto save.
 */
export function copyFileBase(title: string, message: string, now: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  const date = `${p(now.getMonth() + 1)}-${p(now.getDate())}-${String(now.getFullYear()).slice(-2)}`;
  const time = `${p(now.getHours())}-${p(now.getMinutes())}`;
  /* safeName's "Untitled" fallback belongs to the TITLE only — applied to the
     kind it turned an empty message into `EpisodeX_Untitled_…`. */
  const part = (v: string) => v.replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, '').slice(0, 120);
  return [part(title) || 'Untitled', part(message), date, time].filter(Boolean).join('_');
}

/** Copy a snapshot to every checked snapshot destination (Settings). */
export async function mirrorSnapshot(args: {
  projectId: string; projectName: string; title: string;
  content: Record<string, unknown>; message: string;
}): Promise<void> {
  const s = useSettingsStore.getState();
  const dests: Array<'gdrive' | 'onedrive' | 'localfolder'> = [];
  if (s.snapToGDrive) dests.push('gdrive');
  if (s.snapToOneDrive) dests.push('onedrive');
  // v2.83, Derek: a chosen folder on this device gets a timestamped .odraft.
  if (s.snapToLocalFolder && s.snapLocalFolder) dests.push('localfolder');
  if (dests.length === 0) return; // local git checkpoint already covers it

  const label = copyFileBase(args.title, args.message, new Date());
  const failures: string[] = [];

  await Promise.all(dests.map(async (loc) => {
    try {
      if (loc === 'gdrive') {
        await snapshotToGDrive(label, await odraftTextFor(args.title, args.content));
      } else if (loc === 'onedrive') {
        await snapshotToOneDrive(label, await odraftTextFor(args.title, args.content));
      } else {
        // v2.83: write an .odraft into the chosen folder (desktop only —
        // the folder path only exists where a native dialog picked it).
        const { isTauri } = await import('./platform');
        if (!isTauri()) throw new Error('Local folder auto saves need the desktop app.');
        const text = await odraftTextFor(args.title, args.content);
        const safe = label.replace(/[/\\:*?"<>|]/g, '-');
        // v6.42, Derek: auto saves land in an "Auto Saves" FOLDER at the
        // chosen location, not loose beside his real files.
        // (save_text_to_path creates the folder if it's missing.)
        /* v7.20, Derek's file: "Auto Save — Episode X — Auto save — 08-15-26
           23.15.odraft". The kind was in the name TWICE — once from this
           prefix and once from `message`, which the label already carries.
           And the prefix was a lie for the other caller: File ▸ Take Snapshot
           goes through mirrorSnapshot too, so a snapshot the writer named
           himself came out labelled "Auto Save — …". The label alone says
           what it is: <title> — <message> — <stamp>. */
        const folder = useSettingsStore.getState().snapLocalFolder.replace(/[/\\]$/, '');
        const { invoke } = await import('@tauri-apps/api/core');
        await invoke('save_text_to_path', { path: `${folder}/Auto Saves/${scriptFileName(safe)}`, contents: text });
      }
    } catch (err) {
      console.error(`Snapshot copy to ${loc} failed:`, err);
      const name = loc === 'gdrive' ? 'Google Drive' : loc === 'onedrive' ? 'OneDrive' : 'Local folder';
      failures.push(`${name}: ${errText(err)}`);
    }
  }));

  if (failures.length > 0) {
    reportSaveError(
      new Error(`The snapshot was saved locally, but ${failures.length === 1 ? 'a snapshot location' : `${failures.length} snapshot locations`} failed —\n${failures.join('\n')}`),
      'save-location',
    );
  }
}
