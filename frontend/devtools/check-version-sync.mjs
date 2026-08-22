/* check-version-sync (v7.62, hardened v7.63) — the app's version and every
 * shipped copy of it must be the same number, and that number must be one the
 * build can actually parse.
 *
 * They were not. The app said 7.61; src-tauri/tauri.conf.json said 0.19.0, and
 * nothing connected them — release.yml reads the git tag into $VERSION and uses
 * it for the release NOTES only, never writing it into the config. So every
 * build since v0.19 was stamped 0.19.0 whatever the About box claimed, and the
 * .dmg filename disagreed with the app inside it.
 *
 * WHY THIS IS A GATE AND NOT A NOTE. It is invisible from inside the app: the
 * About box reads APP_VERSION and is always right, so nothing on screen ever
 * looks wrong. It only surfaces at release time, in an artifact, after the tag
 * is cut — and it is precisely what an updater compares, so the first thing
 * built on top of it would have compared 0.19.0 against 0.19.0 and concluded
 * forever that there was nothing to install.
 *
 * ── v7.63, and the reason this file grew ──────────────────────────────────
 * The v7.62 fix wrote APP_VERSION through verbatim: `"version": "7.62"`. Tauri
 * requires full semver and refuses two components outright —
 *
 *     failed to parse config: `tauri.conf.json > version` must be a semver string
 *
 * — so the app would not launch AT ALL. This file passed it, because the only
 * shape assertion it made was on APP_VERSION (`\d+\.\d+(\.\d+)?`, which permits
 * two parts) and never on the value actually written into the config.
 *
 * That is the lesson worth keeping: the check tested the INPUT and not the
 * ARTIFACT. Tauri's parser is the real authority and it cannot run here, so
 * every assertion below is about the written file, in the shape that parser
 * demands.
 *
 * Fix drift with:  node devtools/sync-version.mjs
 */
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  readAppVersion, readBundleVersion, readCrateVersion, readLockVersion, toSemver,
} from './sync-version.mjs';

let pass = 0, fail = 0;
const ok = (cond, name, extra = '') => {
  if (cond) { pass++; console.log(`  PASS ${name}`); }
  else { fail++; console.log(`  FAIL ${name} ${extra}`); }
};

const app = readAppVersion();
const want = toSemver(app);
const bundle = readBundleVersion();

console.log('\nthe bundle version is one Tauri will accept');
/* THE ASSERTION THAT WAS MISSING. Not "looks like a version" — exactly three
   numeric components, which is what `tauri.conf.json > version` means by "a
   semver string". Anything less and the app does not start. Confirmed against
   the semver library rather than by reading the spec: semver.valid('7.63.0')
   returns the version, semver.valid('7.63') returns null. Deliberately not
   IMPORTED here — semver is a transitive dependency, and a gate that stops
   working when the dependency tree shifts is not a gate. This is stricter
   anyway: no prerelease or build metadata in a shipped bundle version. */
ok(/^\d+\.\d+\.\d+$/.test(bundle),
  'tauri.conf.json carries a full MAJOR.MINOR.PATCH version', `got "${bundle}"`);
/* The old value, named, because "0.19.0" is what this looks like when it has
   silently stopped being maintained — a plausible number that never moves. */
ok(bundle !== '0.19.0', 'the bundle version is not the stale 0.19.0 default', bundle);

console.log('\nand every copy of the number came from APP_VERSION');
ok(/^\d+\.\d+(\.\d+)?$/.test(app), 'APP_VERSION is a plain dotted version', app);
ok(bundle === want, 'tauri.conf.json matches APP_VERSION',
  bundle === want ? '' : `app=${app} (→ ${want}) bundle=${bundle} → node devtools/sync-version.mjs`);
/* The crate and the lockfile are not user-visible, but they are two more copies
   of the same number and both had drifted to 0.19.0. A lockfile that disagrees
   with its Cargo.toml is rewritten by the next build, and a dirty lockfile is
   what aborts Derek's `git pull` (CLAUDE.md §3). */
ok(readCrateVersion() === want, 'src-tauri/Cargo.toml matches APP_VERSION', readCrateVersion());
ok(readLockVersion() === want, 'src-tauri/Cargo.lock matches APP_VERSION', readLockVersion());

/* Reading it is not enough — the writer has to produce the normalised form, or
   the next bump reintroduces exactly the bug this file exists to catch. */
console.log('\nthe writer normalises rather than copying through');
ok(toSemver('7.63') === '7.63.0' && toSemver('7.63.1') === '7.63.1'
  && toSemver('v7.63') === '7.63.0' && toSemver('7.63-rc1') === '7.63.0',
  'toSemver fills in the missing component', toSemver('7.63'));

/* The updater's manifest carries the version too, on a public host, and it is
   the one copy that is not in this repo at all — so it is GENERATED rather than
   typed. Assert the generator's output, because a generator nobody runs is just
   a longer way to hand-copy a number. */
console.log('\nand the release manifest is generated from the same number');
const manifest = JSON.parse(
  execFileSync('node', [fileURLToPath(new URL('build-release-manifest.mjs', import.meta.url))],
    { encoding: 'utf8' }),
);
/* v7.78: SEMVER, not APP_VERSION verbatim. Tauri's updater now reads this same
   file and parses the version with the `semver` crate, which rejects a
   two-component "7.78" — the identical trap that stopped the app launching in
   v7.63, one file along. Both halves are asserted, because either alone lets
   the wrong thing through: the shape (three components, so Tauri can parse it)
   AND that it is derived from APP_VERSION (so it is still one number in one
   place, which is what this whole file is about). */
ok(/^\d+\.\d+\.\d+$/.test(manifest.version ?? ''),
  'latest.json carries a full semver version, which Tauri requires', manifest.version);
ok(manifest.version === toSemver(app),
  'latest.json would be published with APP_VERSION', `${manifest.version} vs ${toSemver(app)}`);
/* The third claim — that the APP reads 7.78.0 as equal to its own 7.78, or the
   banner would offer the same install forever — lives in
   services/updateCheck.test.ts, next to the comparator that makes it true.
   Re-implementing compareVersions here to assert it would be the second copy
   this file exists to prevent. */
/* parseManifest() in services/updateCheck.ts drops anything that is not https
   — a manifest url ends up in an anchor the user is invited to click. A
   generator that emits a url the app then refuses is a silent dead feature. */
ok(/^https:\/\//.test(manifest.url), '…and a url the app will actually open', manifest.url);
ok(Boolean(manifest.notes) && manifest.notes.length < 120,
  '…and a note short enough to sit inline in the banner', JSON.stringify(manifest.notes));

/* The one number a tester ever quotes back is the one in the diagnostics
   report, and it was the literal '0.19.0' — the global it preferred is set
   nowhere in the app, so the fallback was the only path. */
console.log('\nand the diagnostics report quotes the real version');
const diag = readFileSync(new URL('../src/services/diagnostics.ts', import.meta.url), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
ok(/import \{ APP_VERSION \}/.test(diag), 'diagnostics reads APP_VERSION');
ok(!/return '\d+\.\d+\.\d+'/.test(diag), 'and hard-codes no version of its own',
  (/return '\d+\.\d+\.\d+'/.exec(diag) || [''])[0]);

/* The release workflow has to REFUSE a tag that disagrees, not paper over it.
   A build that quietly rewrites its own version produces an artifact matching
   no commit, which is worse than a failed build. */
console.log('\nand the release workflow refuses a tag that disagrees');
const wf = readFileSync(new URL('../../.github/workflows/release.yml', import.meta.url), 'utf8');
ok(/Check the tag matches the app version/.test(wf), 'the guard step exists');
ok(/tauri\.conf\.json \(\$BUNDLE\) and APP_VERSION \(\$APP\) disagree/.test(wf),
  '…and fails loudly rather than patching the config');
/* It compares the NORMALISED app version. Comparing raw strings is what it did
   first, and "7.63.0" != "7.63" would have failed every legal release — the
   same two-vs-three-component confusion, one file over. */
ok(/APP_SEMVER=/.test(wf) && /"\$BUNDLE" != "\$APP_SEMVER"/.test(wf),
  '…comparing the normalised version, not the raw string');
ok(!/sed -i.*tauri\.conf\.json/.test(wf) && !/jq .*version.*tauri\.conf\.json/.test(wf),
  '…and the workflow never rewrites the version itself');

console.log(`\ncheck-version-sync: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
