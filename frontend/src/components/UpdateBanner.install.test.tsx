// @vitest-environment jsdom
/**
 * v7.78 — WHEN the banner offers to install, and when it must not.
 *
 * The install path cannot be exercised end to end anywhere this suite runs:
 * it needs a Tauri shell, a published manifest and a signing key, and there is
 * none of that in a browser or in CI. What CAN be pinned — and what actually
 * matters — is the DECISION in front of it, because the failure mode is not a
 * broken download. It is an "Install and Restart" button that appears where it
 * cannot work, presses like a real control, and does nothing: the silent no-op
 * this codebase treats as the cardinal sin.
 *
 * So the component is rendered for real and read back, in all four states:
 * a machine the release has an artifact for, a machine it does not, a browser,
 * and a notify-only release with no artifacts at all. The download link has to
 * survive every one of them, because it is the way out of all of them.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';

const ARM = { url: 'https://x.test/ScriptCraft.app.tar.gz', signature: 'sig' };

/* The network and the shell are the two things this component reaches for, and
   both are stubbed at the module edge rather than deeper: what is under test is
   how the banner READS their answers. hasInstallerFor is deliberately NOT
   mocked — it is the decision, and mocking it would leave this asserting that
   a mock returns what it was told to. */
const checkForUpdate = vi.fn();
const updaterTarget = vi.fn();
const installUpdate = vi.fn();

vi.mock('../services/updateCheck', async () => {
  const real = await vi.importActual<typeof import('../services/updateCheck')>('../services/updateCheck');
  return { ...real, checkForUpdate: (...a: unknown[]) => checkForUpdate(...a) };
});
vi.mock('../services/desktopUpdater', () => ({
  updaterTarget: () => updaterTarget(),
  installUpdate: (...a: unknown[]) => installUpdate(...a),
}));
vi.mock('./Toast', () => ({ showToast: vi.fn() }));

let host: HTMLElement;
let root: Root;

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  installUpdate.mockResolvedValue({ kind: 'failed', message: 'nope' });
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.clearAllMocks();
});

/** Mount, then let the 4s startup check and its promises settle. */
async function show(result: unknown, target: string | null) {
  checkForUpdate.mockResolvedValue(result);
  updaterTarget.mockResolvedValue(target);
  const { default: UpdateBanner } = await import('./UpdateBanner');
  await act(async () => { root.render(<UpdateBanner />); });
  await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
}

const banner = () => host.querySelector('.update-banner');
const install = () => host.querySelector<HTMLButtonElement>('.update-banner-install');
const download = () => host.querySelector<HTMLAnchorElement>('a.update-banner-btn');

const UPDATE = (platforms?: unknown) => ({
  kind: 'update' as const,
  version: '9.99',
  url: 'https://x.test/release',
  notes: 'a note',
  ...(platforms ? { platforms } : {}),
});

describe('UpdateBanner — when it offers to install', () => {
  it('offers Install on a machine the release actually built for', async () => {
    await show(UPDATE({ 'darwin-aarch64': ARM }), 'darwin-aarch64');
    expect(banner()).toBeTruthy();
    expect(install()).toBeTruthy();
    expect(install()!.textContent).toContain('Install and Restart');
    // …and never INSTEAD of the link.
    expect(download()?.getAttribute('href')).toBe('https://x.test/release');
  });

  /* The uneven-matrix case: an Intel Mac while only the Apple Silicon build
     shipped. Offering here would download something the machine cannot run. */
  it('does NOT offer Install for a machine the release has no artifact for', async () => {
    await show(UPDATE({ 'darwin-aarch64': ARM }), 'darwin-x86_64');
    expect(banner()).toBeTruthy();
    expect(install()).toBeNull();
    expect(download()).toBeTruthy();
  });

  /* null target = not the desktop app. This is the assertion that keeps a
     dead button out of the web build. */
  it('does NOT offer Install in a browser', async () => {
    await show(UPDATE({ 'darwin-aarch64': ARM }), null);
    expect(banner()).toBeTruthy();
    expect(install()).toBeNull();
    expect(download()).toBeTruthy();
  });

  /* The state the app ships in TODAY: a release published before any signed
     artifacts exist. Exactly the v7.62 banner, which is the correct answer. */
  it('does NOT offer Install for a notify-only release with no platforms', async () => {
    await show(UPDATE(), 'darwin-aarch64');
    expect(banner()).toBeTruthy();
    expect(install()).toBeNull();
    expect(download()).toBeTruthy();
  });

  it('shows nothing at all when the app is current', async () => {
    await show({ kind: 'current', version: '9.99' }, 'darwin-aarch64');
    expect(banner()).toBeNull();
  });

  /* Pressing it must not be re-entrant: downloadAndInstall is not, and a
     second press would have two downloads fighting over one bundle. */
  it('a press disables the button while it runs, and re-arms on failure', async () => {
    let release!: (v: unknown) => void;
    installUpdate.mockReturnValue(new Promise((r) => { release = r; }));
    await show(UPDATE({ 'darwin-aarch64': ARM }), 'darwin-aarch64');

    await act(async () => { install()!.click(); });
    expect(install()!.disabled).toBe(true);
    expect(install()!.textContent).toContain('Downloading');
    // A second press while busy must not start another install.
    await act(async () => { install()!.click(); });
    expect(installUpdate).toHaveBeenCalledTimes(1);

    await act(async () => { release({ kind: 'failed', message: 'nope' }); });
    expect(install()!.disabled).toBe(false);
    expect(install()!.textContent).toContain('Install and Restart');
    // …and the way out is still on screen.
    expect(download()).toBeTruthy();
  });

  it('reports real progress rather than sitting at zero', async () => {
    let report!: (p: { downloaded: number; total: number }) => void;
    installUpdate.mockImplementation((onProgress: (p: { downloaded: number; total: number }) => void) => {
      report = onProgress;
      return new Promise(() => {});           // never settles: stay in-flight
    });
    await show(UPDATE({ 'darwin-aarch64': ARM }), 'darwin-aarch64');
    await act(async () => { install()!.click(); });
    await act(async () => { report({ downloaded: 25, total: 100 }); });
    expect(install()!.textContent).toContain('25%');
    await act(async () => { report({ downloaded: 100, total: 100 }); });
    expect(install()!.textContent).toContain('100%');
  });

  /* No Content-Length is common, and a bar pinned at 0% reads as a hang. */
  it('says Downloading… rather than 0% when the size is unknown', async () => {
    installUpdate.mockImplementation((onProgress: (p: { downloaded: number; total: number }) => void) => {
      onProgress({ downloaded: 4096, total: 0 });
      return new Promise(() => {});
    });
    await show(UPDATE({ 'darwin-aarch64': ARM }), 'darwin-aarch64');
    await act(async () => { install()!.click(); });
    expect(install()!.textContent).toContain('Downloading…');
    expect(install()!.textContent).not.toContain('%');
  });
});
