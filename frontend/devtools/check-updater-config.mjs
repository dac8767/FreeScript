/* check-updater-config (v7.78) — the updater's config, which lives in files
 * that cannot import each other.
 *
 * Three separate places have to agree about in-app updating, and none of them
 * can read the others:
 *
 *   src-tauri/tauri.conf.json      the endpoint the Rust plugin polls, and the
 *                                  public key it verifies downloads against
 *   src/services/updateCheck.ts    the endpoint the banner fetches
 *   src-tauri/capabilities/*.json  whether the webview may call either plugin
 *
 * A TypeScript file cannot be imported by a JSON config, so the endpoint URL is
 * genuinely written twice. That is the shape of nearly every bug in this
 * codebase's history — two lists that drifted — and the only defence available
 * is a test that reads both and compares them.
 *
 * It also fails, loudly and by name, while the signing key is still unset. That
 * is not a bug, it is the state the repo ships in until Derek generates the
 * pair (src-tauri/UPDATER.md says how); but it must never be possible to
 * publish a release without noticing, because a build with no public key can
 * verify nothing and every "Install and Restart" in the field would fail at the
 * last step.
 *
 * No browser here — this is all files on disk.
 */
import { readFileSync } from 'node:fs';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  PASS ${name}`); }
  else { fail++; console.log(`  FAIL ${name} ${extra}`); }
};
const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const readJson = (rel) => JSON.parse(read(rel));

const conf = readJson('../../src-tauri/tauri.conf.json');
const caps = readJson('../../src-tauri/capabilities/default.json');
const service = read('../src/services/updateCheck.ts');
const cargo = read('../../src-tauri/Cargo.toml');
const lib = read('../../src-tauri/src/lib.rs');
const pkg = readJson('../package.json');

/* ── the endpoint, in both places ─────────────────────────────────────────── */
console.log('\nthe app and the plugin poll the SAME url');
const endpoints = conf.plugins?.updater?.endpoints ?? [];
ok('tauri.conf.json names exactly one endpoint', endpoints.length === 1, JSON.stringify(endpoints));
const inService = /UPDATE_MANIFEST_URL\s*=\s*\n?\s*'([^']+)'/.exec(service)?.[1] ?? null;
ok('…and updateCheck.ts names one too', Boolean(inService), JSON.stringify(inService));
ok('…and they are the same url', endpoints[0] === inService,
  JSON.stringify({ conf: endpoints[0], service: inService }));
/* raw.githubusercontent is the only host that serves a file from a repo with
   no token. A github.com/…/blob/… url returns an HTML page, which parses as a
   failed manifest and reads to a tester as "the update server is down". */
ok('…and it is a RAW url, not a repo page',
  /^https:\/\/raw\.githubusercontent\.com\//.test(endpoints[0] ?? ''), endpoints[0]);

/* ── the signing key ──────────────────────────────────────────────────────
   WARNS in the everyday suite, FAILS with --release, and the split is
   deliberate. The key is the one part of this Derek has to generate himself
   (src-tauri/UPDATER.md), and it cannot be in the repo until he does. A check
   that is simply red until then would be red for weeks — and a suite that is
   normally red is a suite nobody reads, which costs more than this is worth.
   But shipping a release whose builds can verify nothing would break every
   "Install and Restart" in the field, so release.yml runs this with --release
   and cannot get past it. */
const RELEASE = process.argv.includes('--release');
console.log(`\nthe build can verify what it downloads${RELEASE ? ' (--release: required)' : ''}`);
const pubkey = String(conf.plugins?.updater?.pubkey ?? '').trim();
const HOWTO = 'run `npm run tauri signer generate -- -w ~/.tauri/scriptcraft.key`'
  + ' and paste the .pub contents into tauri.conf.json → plugins.updater.pubkey'
  + ' — see src-tauri/UPDATER.md';
if (pubkey) {
  /* A minisign public key is base64 and well over 40 characters. Catching a
     placeholder like "TODO" matters more than the exact format: it is the
     shape a hurried fix would leave behind. */
  ok('a public key is configured', true, '');
  ok('…and it looks like a minisign key rather than a placeholder',
    /^[A-Za-z0-9+/=]{40,}$/.test(pubkey), JSON.stringify(pubkey.slice(0, 24)));
} else if (RELEASE) {
  ok('a public key is configured', false, HOWTO);
} else {
  console.log(`  NOTE  no signing key yet — in-app install is OFF until there is one.\n        ${HOWTO}`);
  /* The claim that makes the NOTE safe rather than a shrug: with no key the
     app must still never be stuck. The download link is unconditional in the
     banner — it renders beside the install button and instead of it — and
     desktopUpdater turns the resulting key error into a sentence that sends
     the writer to that link. Both are asserted, so "not configured yet" cannot
     quietly become "the banner offers nothing". */
  const banner = read('../src/components/UpdateBanner.tsx');
  const updaterSrc = read('../src/services/desktopUpdater.ts');
  ok('…and until then the banner still offers the download link unconditionally',
    /className="update-banner-btn"\s*\n\s*href=\{found\.url\}/.test(banner), '');
  ok('…and a key error tells the writer to use it',
    /pubkey\|public key\|minisign\|signature/.test(updaterSrc)
    && /Download the new version instead/.test(updaterSrc), '');
}

/* ── the artifacts switch is NOT in the base config ───────────────────────── */
console.log('\na local unsigned build still works');
/* createUpdaterArtifacts makes `tauri build` sign, and signing needs the
   private key in the environment. On in the base config, Derek's own
   `npm run desktop:build` would fail on the machine that has no key — which is
   every machine but the release runner. It belongs in the overlay. */
ok('createUpdaterArtifacts is not on in tauri.conf.json',
  conf.bundle?.createUpdaterArtifacts !== true, JSON.stringify(conf.bundle?.createUpdaterArtifacts));
const overlay = readJson('../../src-tauri/tauri.release.conf.json');
ok('…and it IS on in the release overlay', overlay.bundle?.createUpdaterArtifacts === true, '');

/* ── the plugins are actually wired ───────────────────────────────────────── */
console.log('\nboth plugins are present on every side');
ok('the updater crate is a dependency', /tauri-plugin-updater\s*=/.test(cargo), '');
ok('the process crate is a dependency', /tauri-plugin-process\s*=/.test(cargo), '');
/* DESKTOP ONLY. Left in the plain [dependencies] table these break the Android
   and iOS jobs, which still run in release.yml, on a feature mobile can never
   use. The scoping is the assertion. */
const scoped = /\[target\.'cfg\(not\(any\(target_os = "android", target_os = "ios"\)\)\)'\.dependencies\]([\s\S]*?)(\n\[|$)/
  .exec(cargo)?.[1] ?? '';
ok('…and BOTH are scoped away from android/ios',
  /tauri-plugin-updater/.test(scoped) && /tauri-plugin-process/.test(scoped), '');
ok('lib.rs registers them behind #[cfg(desktop)]',
  /#\[cfg\(desktop\)\][\s\S]{0,200}tauri_plugin_updater::Builder::new\(\)\.build\(\)/.test(lib)
  && /tauri_plugin_process::init\(\)/.test(lib), '');
ok('…and exposes updater_target as a command',
  /fn updater_target\(\)/.test(lib) && /^\s*updater_target,$/m.test(lib), '');
/* std::env::consts::OS is "macos"; the manifest keys are "darwin-*". Getting
   this wrong means every Mac reports a target the manifest has never heard of
   and the Install button silently never appears. */
ok('…and it spells macOS the way the manifest does',
  /"macos" => "darwin"/.test(lib), '');

console.log('\nthe webview is allowed to call them');
const perms = caps.permissions ?? [];
ok('updater:default is granted', perms.includes('updater:default'), '');
ok('process:allow-restart is granted', perms.includes('process:allow-restart'), '');

console.log('\nthe JS halves are installed');
const deps = pkg.dependencies ?? {};
ok('@tauri-apps/plugin-updater is a dependency', Boolean(deps['@tauri-apps/plugin-updater']), '');
ok('@tauri-apps/plugin-process is a dependency', Boolean(deps['@tauri-apps/plugin-process']), '');
/* Static imports would put the Tauri IPC shims in the browser bundle, where
   __TAURI_INTERNALS__ does not exist and the module throws on load — taking
   the banner with it, in the one build where the banner is all there is. */
const updater = read('../src/services/desktopUpdater.ts');
ok('…and both are imported DYNAMICALLY, so the web build never loads them',
  !/^import .*@tauri-apps\/plugin-(updater|process)/m.test(updater)
  && /await import\('@tauri-apps\/plugin-updater'\)/.test(updater)
  && /await import\('@tauri-apps\/plugin-process'\)/.test(updater), '');

console.log(`\ncheck-updater-config: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
