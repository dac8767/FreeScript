/**
 * UpdateBanner (v7.62) — "a newer build exists", and a way to go get it.
 *
 * Derek is about to hand the app to a handful of testers, and the failure mode
 * that matters is not a broken updater — it is a tester quietly running a
 * three-week-old build and reporting bugs that were fixed a fortnight ago.
 * This is the smallest thing that stops that.
 *
 * NOTIFY ONLY, on purpose. See services/updateCheck.ts for why installing waits
 * for a Developer ID.
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
  checkForUpdate, dismissVersion, shouldAnnounce,
  type UpdateResult,
} from '../services/updateCheck';
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
    return () => {
      manualCheckHandler = null;
      clearTimeout(first);
      clearInterval(repeat);
    };
  }, [run]);

  if (!found || found.kind !== 'update') return null;

  return (
    <div className="update-banner" role="status">
      <span className="update-banner-icon"><FaArrowUp /></span>
      <span className="update-banner-text">
        <strong>ScriptCraft {found.version}</strong> is available
        {found.notes ? ` — ${found.notes}` : ''}
        <span className="update-banner-have"> (you have {APP_VERSION})</span>
      </span>
      {/* A LINK, not a button that pretends to install. It opens the release
          page in the browser; the writer drags the new app over the old one,
          which is the macOS idiom anyway. */}
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
        onClick={() => { dismissVersion(found.version); setFound(null); }}
      ><FaTimes /></button>
      {busy && <span className="update-banner-busy">Checking…</span>}
    </div>
  );
}
