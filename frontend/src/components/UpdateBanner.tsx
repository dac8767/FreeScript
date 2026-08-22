/**
 * UpdateBanner (v7.62) — "a newer build exists", and a way to go get it.
 *
 * Derek is about to hand the app to a handful of testers, and the failure mode
 * that matters is not a broken updater — it is a tester quietly running a
 * three-week-old build and reporting bugs that were fixed a fortnight ago.
 * This is the smallest thing that stops that.
 *
 * v7.78: it INSTALLS now, where it can. Derek asked for the full thing, having
 * been told the risk — a macOS bundle that replaces itself while still unsigned
 * is the one failure a tester cannot walk back. The mitigation is that the
 * install path is never the only path: the Download link stays on the banner,
 * and the button that installs is rendered ONLY when the published manifest
 * carries an artifact for this exact machine (hasInstallerFor, whose target
 * comes from Rust because the webview cannot tell an Apple Silicon Mac from an
 * Intel one). Everywhere else — the browser, a platform with no artifact, a
 * build with no signing key — this is exactly the v7.62 banner it has always
 * been. See services/desktopUpdater.ts.
 *
 * TWO CHECKS, TWO DIFFERENT MANNERS — the distinction is the whole design:
 *
 *   The AUTOMATIC one (on launch) is silent unless it has good news. Offline,
 *   DNS down, manifest missing: say nothing. A writer opening a script on a
 *   train has not asked about updates and must not be told the network failed.
 *
 *   The MANUAL one (Help ▸ Check for Updates…) must ALWAYS answer, including
 *   "you're up to date" and including the error. Someone who asked a question
 *   and got silence back cannot tell a working check from a broken one — which
 *   is the same silent no-op this app treats as the cardinal sin, wearing a
 *   network error as a disguise.
 */
import React from 'react';
import { FaTimes, FaArrowUp } from 'react-icons/fa';
import { APP_VERSION } from '../data/changelog';
import {
  checkForUpdate, dismissVersion, shouldAnnounce, hasInstallerFor,
  type UpdateResult,
} from '../services/updateCheck';
import { installUpdate, updaterTarget, type InstallProgress } from '../services/desktopUpdater';
import { showToast } from './Toast';

/** Wait for the app to finish opening before touching the network. */
const STARTUP_DELAY_MS = 4000;
/** Re-check on a long-running session. Testers leave the app open for days. */
const RECHECK_MS = 6 * 60 * 60 * 1000;

let manualCheckHandler: (() => void) | null = null;

/** Help ▸ Check for Updates…. A no-op before the banner mounts, which is the
 *  right answer — there is nothing to report yet either. */
export function requestUpdateCheck(): void {
  manualCheckHandler?.();
}

export default function UpdateBanner() {
  const [found, setFound] = React.useState<UpdateResult | null>(null);
  const [busy, setBusy] = React.useState(false);
  /** This machine's manifest key, from Rust. null off the desktop — and null is
   *  what keeps the Install button off the screen everywhere it cannot work. */
  const [target, setTarget] = React.useState<string | null>(null);
  const [progress, setProgress] = React.useState<InstallProgress | null>(null);

  /** `announce` false = the automatic pass: good news only. */
  const run = React.useCallback(async (announce: boolean) => {
    setBusy(true);
    const result = await checkForUpdate(APP_VERSION);
    setBusy(false);
    if (announce) {
      // Asked for → always answered.
      if (result.kind === 'update') setFound(result);
      else if (result.kind === 'current') showToast(`ScriptCraft ${APP_VERSION} is the latest version.`, 'success');
      else showToast(result.message, 'error');
      return;
    }
    // Unasked → only a version worth mentioning, and only once per version.
    if (shouldAnnounce(result)) setFound(result);
  }, []);

  React.useEffect(() => {
    manualCheckHandler = () => { void run(true); };
    const first = setTimeout(() => { void run(false); }, STARTUP_DELAY_MS);
    const repeat = setInterval(() => { void run(false); }, RECHECK_MS);
    /* Asked once, on mount, not per render — it is a constant for the life of
       the process and it costs an IPC round trip. */
    let alive = true;
    void updaterTarget().then((t) => { if (alive) setTarget(t); });
    return () => {
      alive = false;
      manualCheckHandler = null;
      clearTimeout(first);
      clearInterval(repeat);
    };
  }, [run]);

  /* v7.78: install, with every failure landing back on the download link.
     `installing` is a separate state from `busy` ("checking"), and it is what
     DISABLES the button — downloadAndInstall is not re-entrant, and a second
     press would leave two downloads fighting over one bundle. The early return
     below is belt to that braces: unreachable through the DOM while the button
     is disabled, and the guard if this is ever called any other way.
     Break-tested — removing `disabled` is what turns the assertion red. */
  const installing = progress !== null;
  const doInstall = React.useCallback(async () => {
    if (installing) return;
    setProgress({ downloaded: 0, total: 0 });
    const outcome = await installUpdate((p) => setProgress(p));
    /* 'installed' never gets here — relaunch() does not return. Reaching this
       line at all means it failed, so the banner comes back with its link. */
    setProgress(null);
    if (outcome.kind === 'failed') showToast(outcome.message, 'error');
  }, [installing]);

  if (!found || found.kind !== 'update') return null;

  /* THE ONE CONDITION. Not "are we on the desktop" — that would offer to
     install a build the release does not carry for this machine. The manifest
     must name an artifact for this exact target, and the target comes from
     Rust because WebKit reports Intel on Apple Silicon. */
  const canInstall = hasInstallerFor(found, target);
  const pct = progress && progress.total > 0
    ? Math.min(100, Math.round((progress.downloaded / progress.total) * 100))
    : null;

  return (
    <div className="update-banner" role="status">
      <span className="update-banner-icon"><FaArrowUp /></span>
      <span className="update-banner-text">
        <strong>ScriptCraft {found.version}</strong> is available
        {found.notes ? ` — ${found.notes}` : ''}
        <span className="update-banner-have"> (you have {APP_VERSION})</span>
      </span>
      {canInstall && (
        <button
          className="update-banner-btn update-banner-install"
          disabled={installing}
          title={installing
            ? 'Downloading the new version'
            : 'Download it, replace this copy, and reopen. Your work is saved first.'}
          onClick={() => { void doInstall(); }}
        >
          {installing
            ? (pct === null ? 'Downloading…' : `Downloading ${pct}%`)
            : 'Install and Restart'}
        </button>
      )}
      {/* The link NEVER goes away, even beside the install button. It is the
          way out of every failure the install path can hit, and on an unsigned
          build it is also the way a writer keeps control of what replaces
          their app. It opens the release page; dragging the new app over the
          old one is the macOS idiom anyway. */}
      <a
        className="update-banner-btn"
        href={found.url}
        target="_blank"
        rel="noreferrer noopener"
        title={found.date ? `Released ${found.date}` : 'Open the download page'}
      >Download</a>
      <button
        className="update-banner-x"
        title="Not now. Ask again when there's a newer version"
        aria-label="Dismiss"
        disabled={installing}
        onClick={() => { dismissVersion(found.version); setFound(null); }}
      ><FaTimes /></button>
      {busy && <span className="update-banner-busy">Checking…</span>}
    </div>
  );
}
