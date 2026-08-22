// @vitest-environment jsdom
/**
 * updateCheck — the version comparison, the manifest guard, and the
 * don't-nag rule.
 *
 * The comparison is the whole feature and it has one classic failure: string
 * ordering puts "7.9" above "7.10", so the first release past x.9 would quietly
 * stop offering updates. That reads as a dead endpoint, not a comparison bug,
 * and it would be looked for in the wrong place for a long time. Pinned here
 * in both directions.
 *
 * The network path is not mocked at the fetch level beyond what these need:
 * checkForUpdate takes a fetchImpl so the failure shapes (non-200, thrown,
 * malformed body, timeout) can be driven exactly.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  compareVersions, parseManifest, evaluateManifest, checkForUpdate,
  shouldAnnounce, dismissVersion, hasInstallerFor,
} from './updateCheck';

describe('compareVersions', () => {
  it('orders by NUMBER, not by string — 7.10 is newer than 7.9', () => {
    // The bug this whole test file exists for. Lexically, '7.10' < '7.9'.
    expect(compareVersions('7.10', '7.9')).toBeGreaterThan(0);
    expect(compareVersions('7.9', '7.10')).toBeLessThan(0);
  });

  it('…and keeps working across a major bump', () => {
    expect(compareVersions('8.0', '7.99')).toBeGreaterThan(0);
    expect(compareVersions('10.0', '9.9')).toBeGreaterThan(0);
  });

  it('treats equal versions as equal, including trailing zeroes', () => {
    expect(compareVersions('7.62', '7.62')).toBe(0);
    expect(compareVersions('7.62', '7.62.0')).toBe(0);
    expect(compareVersions('7.62.0.0', '7.62')).toBe(0);
  });

  it('a third component still counts', () => {
    expect(compareVersions('7.62.1', '7.62')).toBeGreaterThan(0);
    expect(compareVersions('7.62', '7.62.1')).toBeLessThan(0);
  });

  it('tolerates a leading v and surrounding space', () => {
    expect(compareVersions('v7.62', '7.61')).toBeGreaterThan(0);
    expect(compareVersions(' 7.62 ', '7.62')).toBe(0);
  });

  it('a pre-release suffix compares as its base version', () => {
    // Deliberate: a tester on 7.62 must never be offered "7.62-rc1".
    expect(compareVersions('7.62-rc1', '7.62')).toBe(0);
    expect(compareVersions('7.63-rc1', '7.62')).toBeGreaterThan(0);
  });

  it('junk sorts as zero rather than throwing', () => {
    expect(compareVersions('', '')).toBe(0);
    expect(compareVersions('nonsense', '0')).toBe(0);
    expect(compareVersions('7.62', 'nonsense')).toBeGreaterThan(0);
  });
});

describe('parseManifest', () => {
  it('accepts a well-formed manifest', () => {
    const m = parseManifest({ version: '7.62', url: 'https://example.com/dl', notes: 'hi' });
    expect(m).toMatchObject({ version: '7.62', url: 'https://example.com/dl', notes: 'hi' });
  });

  it('rejects one missing either half', () => {
    expect(parseManifest({ version: '7.62' })).toBeNull();
    expect(parseManifest({ url: 'https://example.com' })).toBeNull();
    expect(parseManifest({})).toBeNull();
    expect(parseManifest(null)).toBeNull();
    expect(parseManifest('7.62')).toBeNull();
  });

  it('rejects a non-https url', () => {
    // The manifest is a file on the internet; its url ends up in an anchor the
    // user is invited to click. javascript: and http: are both refused.
    expect(parseManifest({ version: '7.62', url: 'javascript:alert(1)' })).toBeNull();
    expect(parseManifest({ version: '7.62', url: 'http://example.com' })).toBeNull();
    expect(parseManifest({ version: '7.62', url: 'file:///etc/passwd' })).toBeNull();
  });
});

describe('evaluateManifest', () => {
  it('reports an update when the manifest is ahead', () => {
    const r = evaluateManifest({ version: '7.63', url: 'https://x.test/d' }, '7.62');
    expect(r.kind).toBe('update');
  });

  it('reports current when equal', () => {
    expect(evaluateManifest({ version: '7.62', url: 'https://x.test/d' }, '7.62').kind).toBe('current');
  });

  it('never offers a DOWNGRADE', () => {
    // A rolled-back manifest must not push testers backwards.
    expect(evaluateManifest({ version: '7.60', url: 'https://x.test/d' }, '7.62').kind).toBe('current');
  });

  it('an unreadable manifest is an error, not an update', () => {
    expect(evaluateManifest({ nope: true }, '7.62').kind).toBe('error');
  });
});

describe('checkForUpdate — the failure shapes', () => {
  const ok = (body: unknown) => (async () => ({
    ok: true, status: 200, json: async () => body,
  })) as unknown as typeof fetch;

  it('returns an update from a good response', async () => {
    const r = await checkForUpdate('7.62', { fetchImpl: ok({ version: '7.63', url: 'https://x.test/d' }) });
    expect(r).toMatchObject({ kind: 'update', version: '7.63' });
  });

  it('a non-200 is an error, never an update', async () => {
    const f = (async () => ({ ok: false, status: 404, json: async () => ({}) })) as unknown as typeof fetch;
    const r = await checkForUpdate('7.62', { fetchImpl: f });
    expect(r.kind).toBe('error');
    expect((r as { message: string }).message).toContain('404');
  });

  it('a thrown fetch is caught — offline must never crash the app', async () => {
    const f = (async () => { throw new TypeError('Failed to fetch'); }) as unknown as typeof fetch;
    const r = await checkForUpdate('7.62', { fetchImpl: f });
    expect(r.kind).toBe('error');
  });

  it('a body that is not JSON is an error', async () => {
    const f = (async () => ({
      ok: true, status: 200, json: async () => { throw new SyntaxError('bad json'); },
    })) as unknown as typeof fetch;
    expect((await checkForUpdate('7.62', { fetchImpl: f })).kind).toBe('error');
  });

  it('asks the network not to serve a cached manifest', async () => {
    // A CDN-cached manifest reports "up to date" for hours after a release —
    // the one outcome that makes this feature worse than not having it.
    let seenUrl = '';
    let seenInit: RequestInit | undefined;
    const f = (async (u: string, init: RequestInit) => {
      seenUrl = u; seenInit = init;
      return { ok: true, status: 200, json: async () => ({ version: '7.62', url: 'https://x.test/d' }) };
    }) as unknown as typeof fetch;
    await checkForUpdate('7.62', { fetchImpl: f });
    expect(seenInit?.cache).toBe('no-store');
    expect(seenUrl).toMatch(/\?t=\d+/);
  });
});

describe('shouldAnnounce — dismissing one version must not silence the next', () => {
  /* This block NEEDS a real localStorage — see the @vitest-environment pragma
     at the top of the file. Without it dismissVersion's try/catch swallows the
     write, dismissedVersion() returns '', and every assertion here passes
     vacuously by announcing everything. That is exactly what happened on the
     first run of this file. */
  beforeEach(() => { localStorage.clear(); });

  const update = (version: string) =>
    ({ kind: 'update', version, url: 'https://x.test/d' }) as const;

  it('announces an update nobody has dismissed', () => {
    expect(shouldAnnounce(update('7.63'))).toBe(true);
  });

  it('stops announcing the version that was dismissed', () => {
    dismissVersion('7.63');
    expect(shouldAnnounce(update('7.63'))).toBe(false);
  });

  it('…but announces the NEXT one', () => {
    // The reason the dismissal stores a version and not a boolean: a boolean
    // would silence the feature permanently on the first "not now".
    dismissVersion('7.63');
    expect(shouldAnnounce(update('7.64'))).toBe(true);
  });

  it('and never announces "current" or an error', () => {
    expect(shouldAnnounce({ kind: 'current', version: '7.62' })).toBe(false);
    expect(shouldAnnounce({ kind: 'error', message: 'nope' })).toBe(false);
  });
});

/* ── v7.78: the installers, and the button they decide ────────────────────
   The manifest gained a `platforms` map so ONE file can serve both the banner
   and Tauri's own updater. What is worth pinning is not the shape but the
   DECISION it drives: hasInstallerFor is the only thing standing between a
   writer and an "Install and Restart" button that cannot install anything. */
describe('platforms, and whether this machine can install', () => {
  const withPlatforms = (platforms: unknown) => ({
    version: '7.79', url: 'https://x.test/r', platforms,
  });
  const ARM = { url: 'https://x.test/a.tar.gz', signature: 'sig' };

  it('keeps a complete entry', () => {
    const m = parseManifest(withPlatforms({ 'darwin-aarch64': ARM }));
    expect(m?.platforms?.['darwin-aarch64']).toEqual(ARM);
  });

  /* A url with no signature is the dangerous shape: it reads as installable
     and dies at the last step, after the download, having verified nothing. */
  it('drops an entry with no signature', () => {
    const m = parseManifest(withPlatforms({ 'darwin-aarch64': { url: 'https://x.test/a' } }));
    expect(m?.platforms).toBeUndefined();
  });

  it('drops an entry whose url is not https — it is handed to a downloader', () => {
    const m = parseManifest(withPlatforms({ 'darwin-aarch64': { url: 'http://x.test/a', signature: 's' } }));
    expect(m?.platforms).toBeUndefined();
  });

  it('a manifest with no platforms at all still parses — that is the notify-only release', () => {
    const m = parseManifest({ version: '7.79', url: 'https://x.test/r' });
    expect(m?.version).toBe('7.79');
    expect(m?.platforms).toBeUndefined();
  });

  it('carries platforms through evaluateManifest onto the result', () => {
    const r = evaluateManifest(withPlatforms({ 'darwin-aarch64': ARM }), '7.78');
    expect(r.kind).toBe('update');
    expect(hasInstallerFor(r, 'darwin-aarch64')).toBe(true);
  });

  it('says no for a machine the release has no artifact for', () => {
    const r = evaluateManifest(withPlatforms({ 'darwin-aarch64': ARM }), '7.78');
    expect(hasInstallerFor(r, 'windows-x86_64')).toBe(false);
  });

  /* null is what updaterTarget answers in a browser, and off the desktop there
     is nothing to install into — this is the assertion that keeps the button
     out of the web build. */
  it('says no when the target is unknown', () => {
    const r = evaluateManifest(withPlatforms({ 'darwin-aarch64': ARM }), '7.78');
    expect(hasInstallerFor(r, null)).toBe(false);
  });

  it('says no when there is no update to install', () => {
    expect(hasInstallerFor({ kind: 'current', version: '7.78' }, 'darwin-aarch64')).toBe(false);
    expect(hasInstallerFor({ kind: 'error', message: 'x' }, 'darwin-aarch64')).toBe(false);
  });

  /* THE v7.63 TRAP, one file along. Tauri parses the manifest version with the
     semver crate, which rejects two-component "7.79" — so the published
     manifest carries 7.79.0 while APP_VERSION is 7.79. The banner's comparator
     has to call those equal, or every install would be offered forever. */
  it('treats the manifest\'s semver form as equal to APP_VERSION\'s short form', () => {
    expect(compareVersions('7.79.0', '7.79')).toBe(0);
    expect(evaluateManifest({ version: '7.79.0', url: 'https://x.test/r' }, '7.79').kind).toBe('current');
    expect(evaluateManifest({ version: '7.80.0', url: 'https://x.test/r' }, '7.79').kind).toBe('update');
  });
});
