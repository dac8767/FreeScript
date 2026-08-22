/**
 * updateCheck (v7.62) — tell testers a newer build exists.
 *
 * NOTIFY ONLY. This does not download or install anything: it fetches a small
 * JSON manifest, compares versions, and hands back what it found so the UI can
 * offer a link. Installing in place is the job of tauri-plugin-updater, and
 * that has to wait for a Developer ID — an unsigned macOS app replacing its own
 * bundle is the one bug you cannot ask a tester to recover from.
 *
 * The manifest lives in a SEPARATE PUBLIC repo. The source repo is private, and
 * a private repo's release assets need an authenticated request — which would
 * mean shipping a GitHub token inside the app, where it is trivially extracted
 * and generally readable against the source. A public repo holding nothing but
 * artifacts and this file costs nothing and leaks nothing.
 */

/** Where the manifest lives. Public on purpose — see the note above. */
export const UPDATE_MANIFEST_URL =
  'https://raw.githubusercontent.com/dac8767/ScriptCraft-releases/main/latest.json';

export interface UpdateManifest {
  /** The newest version, e.g. "7.62". Compared against APP_VERSION. */
  version: string;
  /** Where to send someone to get it. */
  url: string;
  /** Optional one-line summary shown beside the version. */
  notes?: string;
  /** Optional ISO date, shown in the tooltip. */
  date?: string;
  /**
   * v7.78 — the per-machine installers, keyed the way Tauri's updater keys
   * them: `darwin-aarch64`, `darwin-x86_64`, `windows-x86_64`, `linux-x86_64`.
   *
   * ONE FILE SERVES BOTH READERS, which is the point. Tauri's updater reads
   * `version`, `notes`, `pub_date` and `platforms` and ignores everything else;
   * this module reads `version`, `url`, `notes` and `date` and ignores
   * `platforms` except to answer "is there something to install here". Two
   * manifests would mean two version numbers, and a version number written
   * twice is the subject of v7.62, v7.63 and half of §4.
   */
  platforms?: Record<string, { url: string; signature: string }>;
}

export type UpdateResult =
  | {
    kind: 'update';
    version: string;
    url: string;
    notes?: string;
    date?: string;
    platforms?: Record<string, { url: string; signature: string }>;
  }
  | { kind: 'current'; version: string }
  | { kind: 'error'; message: string };

/**
 * Compare two dotted version strings NUMERICALLY, part by part.
 *
 * The whole feature turns on this and it is the easy thing to get wrong: string
 * comparison puts "7.9" above "7.10", so the first release past x.9 would stop
 * offering updates and look like a dead endpoint rather than a comparison bug.
 * Missing parts count as 0, so 7.62 and 7.62.0 are the same version.
 *
 * Returns >0 if `a` is newer, <0 if older, 0 if equal.
 */
export function compareVersions(a: string, b: string): number {
  const parts = (v: string) => String(v).trim().replace(/^v/, '')
    // A pre-release suffix (7.62-rc1) is NOT ordered here — it is stripped, so
    // 7.62-rc1 compares equal to 7.62. Testers should never be offered a
    // downgrade from a release to an rc, and this is the version of that rule
    // that cannot be got subtly wrong.
    .split('-')[0]
    .split('.')
    .map((n) => Number.parseInt(n, 10) || 0);
  const A = parts(a);
  const B = parts(b);
  for (let i = 0; i < Math.max(A.length, B.length); i++) {
    const d = (A[i] ?? 0) - (B[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/** A manifest is only usable if it carries both a version and somewhere to go. */
export function parseManifest(raw: unknown): UpdateManifest | null {
  if (!raw || typeof raw !== 'object') return null;
  const m = raw as Record<string, unknown>;
  const version = typeof m.version === 'string' ? m.version.trim() : '';
  const url = typeof m.url === 'string' ? m.url.trim() : '';
  if (!version || !url) return null;
  // Only ever hand the UI a link we would open. A manifest is a file on the
  // internet; treating its `url` as trusted is how a notice becomes a vector.
  if (!/^https:\/\//i.test(url)) return null;
  return {
    version,
    url,
    notes: typeof m.notes === 'string' ? m.notes : undefined,
    date: typeof m.date === 'string' ? m.date : undefined,
    platforms: parsePlatforms(m.platforms),
  };
}

/**
 * The `platforms` map, kept only where every entry is complete (v7.78).
 *
 * A half-written entry is worse than a missing one: it is what decides whether
 * the app offers "Install and Restart" rather than a download link, so an entry
 * with a url and no signature would put a button on screen that cannot finish.
 * Same reason the url must be https — this file came off the internet, and
 * `platforms[x].url` is handed to a downloader.
 */
function parsePlatforms(raw: unknown): Record<string, { url: string; signature: string }> | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const out: Record<string, { url: string; signature: string }> = {};
  for (const [target, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!value || typeof value !== 'object') continue;
    const v = value as Record<string, unknown>;
    const url = typeof v.url === 'string' ? v.url.trim() : '';
    const signature = typeof v.signature === 'string' ? v.signature.trim() : '';
    if (!url || !signature || !/^https:\/\//i.test(url)) continue;
    out[target] = { url, signature };
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** Does the release carry something THIS machine can install? (v7.78)
 *
 *  `target` is the manifest's own spelling — darwin-aarch64, windows-x86_64 —
 *  which only the Rust side can supply; see updater_target in lib.rs for why
 *  the webview cannot be asked. An unknown target answers false, which is the
 *  answer that keeps a dead button off the screen. */
export function hasInstallerFor(result: UpdateResult, target: string | null): boolean {
  if (result.kind !== 'update' || !target) return false;
  return Boolean(result.platforms?.[target]);
}

/** Decide from a manifest and the running version. Pure — the tests drive this. */
export function evaluateManifest(raw: unknown, current: string): UpdateResult {
  const m = parseManifest(raw);
  if (!m) return { kind: 'error', message: 'The update manifest could not be read.' };
  return compareVersions(m.version, current) > 0
    ? {
      kind: 'update', version: m.version, url: m.url, notes: m.notes, date: m.date, platforms: m.platforms,
    }
    : { kind: 'current', version: current };
}

/**
 * Fetch and evaluate. Never throws.
 *
 * `cache: 'no-store'` because a CDN-cached manifest is the failure where the
 * app cheerfully reports "up to date" for hours after a release — the one
 * outcome that makes the whole feature worse than not having it.
 */
export async function checkForUpdate(
  current: string,
  { url = UPDATE_MANIFEST_URL, timeoutMs = 8000, fetchImpl = fetch }:
  { url?: string; timeoutMs?: number; fetchImpl?: typeof fetch } = {},
): Promise<UpdateResult> {
  const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
  try {
    const res = await fetchImpl(`${url}?t=${Date.now()}`, {
      cache: 'no-store',
      signal: ctrl?.signal,
    });
    if (!res.ok) return { kind: 'error', message: `The update server answered ${res.status}.` };
    return evaluateManifest(await res.json(), current);
  } catch (err) {
    // Offline, DNS, timeout, malformed JSON — all one thing to the caller: we
    // could not find out. The AUTOMATIC check swallows this; the one the user
    // asked for reports it (see UpdateBanner).
    const message = err instanceof Error && err.name === 'AbortError'
      ? 'The update check timed out.'
      : 'Could not reach the update server.';
    return { kind: 'error', message };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/* ── "don't tell me again" ───────────────────────────────────────────────────
   Dismissing 7.62 must not suppress 7.63. The dismissal stores the VERSION it
   was aimed at, not a boolean — a boolean would make one dismissal silence the
   feature permanently, which is exactly how an update notice ends up being the
   thing nobody ever sees again. */
const DISMISS_KEY = 'opendraft:updateDismissed';

export function dismissedVersion(): string {
  try { return localStorage.getItem(DISMISS_KEY) || ''; } catch { return ''; }
}

export function dismissVersion(version: string): void {
  try { localStorage.setItem(DISMISS_KEY, version); } catch { /* quota */ }
}

/** Is this result worth putting on screen unprompted? */
export function shouldAnnounce(result: UpdateResult): boolean {
  if (result.kind !== 'update') return false;
  const seen = dismissedVersion();
  return !seen || compareVersions(result.version, seen) > 0;
}
