/* check-v778 — in-app updating, seen from the one place it must NOT happen.
 *
 * Derek: "lets complete the update functionality", having been told the risk —
 * a macOS bundle that replaces itself while still unsigned is a failure a
 * tester cannot walk back. So the install path exists now, and the whole safety
 * story is that it appears ONLY where it can actually run.
 *
 * This runs in Chromium. There is no Tauri here, no plugin, no signing key —
 * which makes it the exact environment the guarantee is about: the banner must
 * still work, must still offer the download, and must NOT grow a button that
 * presses like a real control and does nothing. The component test
 * (UpdateBanner.install.test.tsx) drives the other three states with the shell
 * faked; this one is the real app, really rendered, with nothing faked but the
 * network.
 *
 * The manifest is served by stubbing fetch rather than by pointing at the live
 * URL, and that is deliberate twice over: the real endpoint is a 404 until the
 * releases repo exists, and a check that depends on a public server is a check
 * that goes red when someone else's DNS does.
 */
import { readFileSync } from 'node:fs';
import { launch, boot, settle } from './driver.mjs';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  PASS ${name}`); }
  else { fail++; console.log(`  FAIL ${name} ${extra}`); }
};

const { browser, page } = await launch({ width: 1500, height: 950 });

/* Stub BEFORE the app loads: the banner's automatic check fires 4s after mount
   and there is no waiting for it afterwards. A manifest two versions ahead, and
   carrying an installer for every platform there is — so if the button were
   going to appear anywhere, it would appear here. */
await page.addInitScript(() => {
  const MANIFEST = {
    version: '99.0.0',
    url: 'https://example.test/releases/tag/v99',
    notes: 'A test manifest.',
    date: '2026-08-22',
    pub_date: '2026-08-22T00:00:00Z',
    platforms: {
      'darwin-aarch64': { url: 'https://example.test/a.app.tar.gz', signature: 'sig' },
      'darwin-x86_64': { url: 'https://example.test/b.app.tar.gz', signature: 'sig' },
      'windows-x86_64': { url: 'https://example.test/c.exe.zip', signature: 'sig' },
      'linux-x86_64': { url: 'https://example.test/d.AppImage.tar.gz', signature: 'sig' },
    },
  };
  const real = window.fetch.bind(window);
  window.fetch = (input, init) => {
    const url = typeof input === 'string' ? input : (input?.url ?? '');
    if (/ScriptCraft-releases|latest\.json/.test(url)) {
      return Promise.resolve(new Response(JSON.stringify(MANIFEST), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      }));
    }
    return real(input, init);
  };
});

await boot(page);
await settle(page);

/* The automatic pass waits 4s by design — a writer opening a script has not
   asked about updates yet. Nothing to do but wait it out. */
await page.waitForSelector('.update-banner', { timeout: 15000 }).catch(() => {});
await settle(page);

console.log('\nthe banner still does its v7.62 job');
const seen = await page.evaluate(() => {
  const b = document.querySelector('.update-banner');
  if (!b) return { present: false };
  const link = b.querySelector('a.update-banner-btn');
  return {
    present: true,
    text: b.textContent?.trim() ?? '',
    installButtons: b.querySelectorAll('.update-banner-install').length,
    linkHref: link?.getAttribute('href') ?? null,
    linkText: link?.textContent?.trim() ?? null,
    dismiss: Boolean(b.querySelector('.update-banner-x')),
  };
});
ok('a newer version puts the banner on screen', seen.present === true, JSON.stringify(seen));
ok('…naming the version it found', /99\.0\.0/.test(seen.text ?? ''), JSON.stringify(seen.text));

/* THE ASSERTION THIS FILE EXISTS FOR. The manifest above carries an installer
   for all four targets; the only reason not to offer one is that this is a
   browser. If the gate were "is there an update" rather than "can THIS machine
   install it", the button would be right here. */
console.log('\nand offers NOTHING it cannot do');
ok('no install button in a browser, with every platform published',
  seen.installButtons === 0, `${seen.installButtons} found`);
ok('…but the download link is there, and points at the release',
  seen.linkHref === 'https://example.test/releases/tag/v99' && seen.linkText === 'Download',
  JSON.stringify([seen.linkHref, seen.linkText]));
ok('…and it can still be dismissed', seen.dismiss === true, '');

/* The target is what gates the button, and off the desktop it must be null
   rather than a guess. WebKit reports "Intel Mac OS X" on Apple Silicon, so a
   userAgent-derived answer would be confidently wrong — which is why this
   comes from Rust and why the browser gets nothing at all. */
console.log('\nthe machine target is unknown off the desktop');
const target = await page.evaluate(async () => {
  const m = await window.__scImport('/src/services/desktopUpdater.ts');
  return m.updaterTarget();
});
ok('updaterTarget() is null in a browser', target === null, JSON.stringify(target));

/* …and installing is refused rather than attempted. */
const outcome = await page.evaluate(async () => {
  const m = await window.__scImport('/src/services/desktopUpdater.ts');
  return m.installUpdate();
});
ok('installUpdate() refuses instead of throwing',
  outcome?.kind === 'failed' && /desktop app/i.test(outcome.message ?? ''), JSON.stringify(outcome));

/* ── the decision function, against the same manifest ─────────────────────── */
console.log('\nthe gate reads the manifest, not the platform it is running on');
const gate = await page.evaluate(async () => {
  const m = await window.__scImport('/src/services/updateCheck.ts');
  const res = m.evaluateManifest({
    version: '99.0.0',
    url: 'https://example.test/r',
    platforms: { 'darwin-aarch64': { url: 'https://example.test/a', signature: 's' } },
  }, '7.78');
  return {
    match: m.hasInstallerFor(res, 'darwin-aarch64'),
    other: m.hasInstallerFor(res, 'linux-x86_64'),
    none: m.hasInstallerFor(res, null),
  };
});
ok('a published target says yes', gate.match === true, JSON.stringify(gate));
ok('…an unpublished one says no', gate.other === false, JSON.stringify(gate));
ok('…and an unknown one says no', gate.none === false, JSON.stringify(gate));

/* ── the manifest the release process actually writes ─────────────────────── */
console.log('\nthe generated manifest is one file both readers understand');
const generated = JSON.parse(
  (await import('node:child_process')).execFileSync('node',
    [new URL('./build-release-manifest.mjs', import.meta.url).pathname], { encoding: 'utf8' }),
);
const APP = /APP_VERSION = '([^']+)'/.exec(
  readFileSync(new URL('../src/data/changelog.ts', import.meta.url), 'utf8'),
)?.[1];
/* THE v7.63 TRAP, one file along: Tauri parses this with the semver crate,
   which rejects a two-component "7.78". The app's own comparator treats the
   missing part as 0, so both readers agree about the same string. */
ok('its version is full semver, which Tauri requires',
  /^\d+\.\d+\.\d+$/.test(generated.version ?? ''), JSON.stringify(generated.version));
ok('…and it is THIS build\'s version, not a hand-typed one',
  generated.version === `${APP}.0` || generated.version === APP, `${generated.version} vs ${APP}`);
ok('…it carries both date spellings, from one source',
  !generated.date || generated.pub_date === `${generated.date}T00:00:00Z`,
  JSON.stringify([generated.date, generated.pub_date]));
/* No platforms before a build exists — and that is correct, not missing. An
   empty or half-written map is what would put a dead button on screen. */
ok('…and no platforms until a signed build has been made',
  generated.platforms === undefined, JSON.stringify(Object.keys(generated.platforms ?? {})));
const parsed = await page.evaluate(async (raw) => {
  const m = await window.__scImport('/src/services/updateCheck.ts');
  const r = m.parseManifest(raw);
  return { version: r?.version ?? null, url: r?.url ?? null };
}, generated);
ok('…and the app can read what the generator wrote',
  parsed.version === generated.version && parsed.url === generated.url, JSON.stringify(parsed));

await browser.close();
console.log(`\ncheck-v778: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
