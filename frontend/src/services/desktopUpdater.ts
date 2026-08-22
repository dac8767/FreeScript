/**
 * desktopUpdater (v7.78) — download the new build, verify it, replace this one.
 *
 * The layer above this (services/updateCheck) answers "is there a newer
 * version", works everywhere, and has done since v7.62. This one answers "can
 * I install it for you", and it only ever can inside the desktop app.
 *
 * IT IS AN ENHANCEMENT, NEVER A REPLACEMENT. Every failure here — no plugin,
 * no signing key configured, no artifact built for this machine, a download
 * that dies halfway — falls back to the download LINK the banner already had.
 * That is not defensiveness for its own sake: the manifest and the signing key
 * are things Derek has to set up, and until he has, `check()` throws. A button
 * saying "Install and Restart" that quietly does nothing on press is precisely
 * the failure this codebase treats as the cardinal sin, and it would be a very
 * easy one to ship here, because the happy path cannot be exercised in a
 * browser or in CI at all.
 *
 * SO THE RULE IS: the button is only rendered when the manifest carries an
 * artifact for THIS machine's target (hasInstallerFor), and pressing it reports
 * every outcome — including the ones that mean "go download it yourself".
 *
 * The plugins are imported DYNAMICALLY. A static import puts the Tauri IPC
 * shims in the browser bundle, where __TAURI_INTERNALS__ does not exist and the
 * module throws on load — taking the whole banner with it.
 */
import { isDesktopTauri } from './platform';

/** Progress, as fractions of the whole download. `total` is 0 when the server
 *  sent no Content-Length, which is common enough to design around: the UI
 *  shows an indeterminate state rather than a bar stuck at zero. */
export interface InstallProgress {
  downloaded: number;
  total: number;
}

export type InstallOutcome =
  /** Installed. The app is about to be relaunched, so nothing follows this. */
  | { kind: 'installed' }
  /** Could not install; the message is for the writer, and the download link
   *  stays on screen behind it. */
  | { kind: 'failed'; message: string };

/**
 * The manifest key for this machine — `darwin-aarch64`, `windows-x86_64`, …
 *
 * Comes from Rust (updater_target in lib.rs) because the webview genuinely
 * cannot tell: WebKit reports "Intel Mac OS X" on Apple Silicon. Returns null
 * off the desktop, or if the command is missing — an older build of the shell
 * running a newer frontend, which happens in dev.
 */
export async function updaterTarget(): Promise<string | null> {
  if (!isDesktopTauri()) return null;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    const target = await invoke<string>('updater_target');
    return typeof target === 'string' && target ? target : null;
  } catch {
    return null;
  }
}

/**
 * Fetch, verify and install the update, then relaunch.
 *
 * `check()` re-reads the manifest through the Rust plugin rather than trusting
 * what the banner already fetched, and that is deliberate: the plugin is what
 * verifies the minisign signature, and a signature check that ran against a
 * different copy of the manifest than the one it downloaded would be theatre.
 * The version this returns is therefore the authority.
 */
export async function installUpdate(
  onProgress?: (p: InstallProgress) => void,
): Promise<InstallOutcome> {
  if (!isDesktopTauri()) {
    return { kind: 'failed', message: 'Updates install from the desktop app.' };
  }
  try {
    const { check } = await import('@tauri-apps/plugin-updater');
    const update = await check();
    if (!update) {
      // The plugin found nothing newer. The banner disagreeing with this means
      // the manifest moved between the two reads — rare, and "already current"
      // is the honest thing to say rather than pretending to install.
      return { kind: 'failed', message: 'No update is available to install right now.' };
    }

    let downloaded = 0;
    let total = 0;
    await update.downloadAndInstall((event) => {
      /* The plugin's event union, not ours: Started carries the length,
         Progress carries a chunk size that has to be ACCUMULATED — reporting
         each chunk as the total is the classic way to build a progress bar
         that flickers near zero forever. */
      if (event.event === 'Started') {
        total = event.data.contentLength ?? 0;
        downloaded = 0;
      } else if (event.event === 'Progress') {
        downloaded += event.data.chunkLength ?? 0;
      } else if (event.event === 'Finished') {
        downloaded = total;
      }
      onProgress?.({ downloaded, total });
    });

    /* The updater swaps the bundle and stops. Relaunching is a separate plugin
       on purpose — and it must come last, because it does not return. */
    const { relaunch } = await import('@tauri-apps/plugin-process');
    await relaunch();
    return { kind: 'installed' };
  } catch (err) {
    return { kind: 'failed', message: describe(err) };
  }
}

/**
 * Turn whatever the plugin threw into something worth reading.
 *
 * The two that will actually happen while this is being set up are a missing
 * or malformed public key and an endpoint that 404s, and Tauri's raw messages
 * for both are opaque enough to send someone hunting in the wrong place.
 */
function describe(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err ?? '');
  if (/pubkey|public key|minisign|signature/i.test(raw)) {
    return 'This build cannot verify updates — its signing key is not configured. Download the new version instead.';
  }
  if (/404|not found/i.test(raw)) {
    return 'The update has not been published yet. Download the new version instead.';
  }
  if (/network|timeout|dns|connect|fetch/i.test(raw)) {
    return 'The download could not be completed. Check your connection, or download the new version instead.';
  }
  return raw ? `The update could not be installed: ${raw}` : 'The update could not be installed.';
}
