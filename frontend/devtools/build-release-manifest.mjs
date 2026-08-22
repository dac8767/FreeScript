// build-release-manifest.mjs (v7.63) — emit the updater's latest.json.
//
// The manifest lives in the PUBLIC ScriptCraft-releases repo and is the file
// every running copy of the app polls: services/updateCheck.ts fetches it,
// compares its `version` against APP_VERSION, and offers the download when it
// is newer. So it holds one more copy of the version number — and hand-copied
// version numbers are the entire subject of v7.62 and v7.63. tauri.conf.json
// sat at 0.19.0 for three hundred releases; the diagnostics report quoted the
// forked-from version to every tester. Both because a number was written down
// twice and only one copy was ever maintained.
//
// This generates it from APP_VERSION instead, so cutting a release is a command
// rather than an edit:
//
//   node devtools/build-release-manifest.mjs                    print it
//   node devtools/build-release-manifest.mjs --notes "…"        override the note
//   node devtools/build-release-manifest.mjs -o latest.json     write a file
//   node devtools/build-release-manifest.mjs --artifacts <dir>  …with installers
//
// v7.78: ONE FILE SERVES BOTH READERS. Tauri's updater reads `version`,
// `notes`, `pub_date` and `platforms`; services/updateCheck reads `version`,
// `url`, `notes` and `date`. Each ignores the other's fields, so there is still
// exactly one version number in exactly one place — which is the whole subject
// of v7.62 and v7.63 and the reason this generator exists at all.
//
// Without --artifacts it emits the notify-only manifest: a version, a link, a
// note. That is the correct output before a build exists, because an empty or
// half-written `platforms` would put an "Install and Restart" button on screen
// with nothing behind it. With --artifacts it scans a finished bundle
// directory, pairs each installer with its .sig, and adds `platforms`.
//
// Nothing here talks to GitHub — a token that can write to a public repo is not
// worth having on disk for a file this small. Publishing is release.yml's job.
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readAppVersion, toSemver } from './sync-version.mjs';

const RELEASES = 'https://github.com/dac8767/ScriptCraft-releases/releases';
const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
};

const version = readAppVersion();
const log = JSON.parse(
  readFileSync(new URL('../src/data/changelog.json', import.meta.url), 'utf8'),
);
const entry = log.find((e) => e.version === version);

/* The banner shows `notes` inline beside the version, so it wants ONE short
   line — not a changelog. Default to the first sentence of the newest entry,
   which is written to lead with the point. */
function firstLine() {
  const first = String(entry?.changes?.[0] ?? entry?.items?.[0]?.title ?? '');
  /* Split on a full stop that ENDS A SENTENCE, not on the one inside "7.62".
     The version's dot is masked before the split and restored after. The
     sentinel is spelled as an escape rather than typed: a raw control byte in
     a source file is invisible in every editor and diff that will show it. */
  const SENTINEL = '\u0001';
  const masked = first.replace(/(\d)\.(\d)/g, `$1${SENTINEL}$2`);
  const sentence = /^(.*?[.!?])(\s|$)/.exec(masked);
  const line = (sentence ? sentence[1] : masked).split(SENTINEL).join('.').trim();
  return cap(line);
}

/**
 * The banner shows this inline beside the version, so it has a budget.
 *
 * The changelog's first sentence is not written to one — v7.66's opens at 187
 * characters, which is a paragraph in a pill. It is trimmed at a WORD boundary
 * rather than mid-word, and the ellipsis is honest about there being more:
 * the banner links to the release, which is where the rest of it lives.
 * `--notes` overrides this whenever a release deserves a written teaser.
 */
const MAX_NOTE = 110;
function cap(line) {
  if (line.length <= MAX_NOTE) return line;
  const cut = line.slice(0, MAX_NOTE);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > 40 ? cut.slice(0, lastSpace) : cut).replace(/[\s,;:—-]+$/, '')}…`;
}

/* ── v7.78: the artifacts Tauri's updater installs ────────────────────────
   `--artifacts <dir>` scans a finished `tauri build` bundle directory for the
   updater artifacts and their detached signatures, and emits the `platforms`
   map. Without it the manifest is exactly the v7.63 notify-only file, which is
   the right output for a release that has not been built yet — an empty
   `platforms` would put an Install button on screen with nothing behind it.

   The naming is Tauri's: for every updater artifact X there is X.sig holding
   the base64 minisign signature. The pairing is what matters — an artifact
   whose .sig is missing is SKIPPED rather than emitted unsigned, because the
   app refuses an unsigned download anyway and would fail at the last step
   instead of never offering. */
/* Which manifest keys an artifact serves. Returns an ARRAY because one macOS
   universal binary serves both architectures.

   macOS IS NOT GUESSED FROM THE FILENAME, and that is the important line here.
   CI builds with an explicit `--target aarch64-apple-darwin`, so the triple is
   in the path; build-desktop.sh does not, so its bundle sits in a plain
   `target/release/bundle/macos/` with nothing saying which chip it was built
   for. Guessing "no marker means Intel" would hand every Apple Silicon tester
   an update their Mac cannot run, silently, and they would have no way to tell
   that is what happened. So an ambiguous path is an ERROR asking for
   --mac-target, not a default. */
const TARGET_BY_EXT = [
  [/\.app\.tar\.gz$/, macTargets],
  // Windows: NSIS is what this app bundles (see bundle.windows.nsis).
  [/-setup\.exe\.zip$|\.nsis\.zip$/, () => ['windows-x86_64']],
  [/\.msi\.zip$/, () => ['windows-x86_64']],
  // Linux: AppImage is the only self-updating format Tauri supports.
  [/\.AppImage\.tar\.gz$/, () => ['linux-x86_64']],
];

function macTargets(path) {
  const forced = flag('--mac-target');
  if (forced) return forced === 'universal' ? ['darwin-aarch64', 'darwin-x86_64'] : [forced];
  if (/universal-apple-darwin/.test(path)) return ['darwin-aarch64', 'darwin-x86_64'];
  if (/aarch64-apple-darwin/.test(path)) return ['darwin-aarch64'];
  if (/x86_64-apple-darwin/.test(path)) return ['darwin-x86_64'];
  console.error(
    `cannot tell which architecture this macOS artifact is for:\n  ${path}\n`
    + 'The path carries no target triple — pass --mac-target darwin-aarch64, '
    + 'darwin-x86_64, or universal.',
  );
  process.exit(1);
  return [];
}

function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

function collectPlatforms(dir, baseUrl) {
  const files = walk(dir);
  const sigs = new Set(files.filter((f) => f.endsWith('.sig')));
  const platforms = {};
  for (const file of files) {
    if (file.endsWith('.sig')) continue;
    const rule = TARGET_BY_EXT.find(([re]) => re.test(file));
    if (!rule) continue;
    if (!sigs.has(`${file}.sig`)) {
      console.error(`  skipped (no .sig): ${file}`);
      continue;
    }
    const name = file.slice(file.lastIndexOf('/') + 1);
    const entry = {
      signature: readFileSync(`${file}.sig`, 'utf8').trim(),
      url: `${baseUrl.replace(/\/$/, '')}/${name}`,
    };
    for (const target of rule[1](file)) {
      /* Two artifacts claiming one target means the scan picked up an old
         build alongside the new one, and whichever lost would be invisible.
         Louder than a wrong update. */
      if (platforms[target]) {
        console.error(`two artifacts both claim ${target}:\n  ${platforms[target].url}\n  ${entry.url}`);
        process.exit(1);
      }
      platforms[target] = entry;
    }
  }
  return platforms;
}

const manifest = {
  /* SEMVER, not APP_VERSION. Tauri's updater parses this with the `semver`
     crate, and semver rejects a two-component "7.78" — the identical trap that
     stopped the app launching in v7.63, one file along. `updateCheck`'s own
     comparator treats a missing part as 0, so 7.78.0 and 7.78 are equal to it
     and the notify path is unaffected. */
  version: toSemver(version),
  url: flag('--url') || `${RELEASES}/tag/v${version}`,
  notes: flag('--notes') || firstLine(),
  /* Taken from the changelog rather than the clock: these scripts run in a
     container whose date is not necessarily the release date, and a wrong date
     in the banner's tooltip is worse than no date at all. */
  date: flag('--date') || entry?.date || '',
};
if (!manifest.date) delete manifest.date;
/* Tauri wants RFC3339 and reads `pub_date`; the banner reads `date`. One
   source, two spellings — rather than two dates that can disagree. */
if (manifest.date) manifest.pub_date = `${manifest.date}T00:00:00Z`;

const artifacts = flag('--artifacts');
if (artifacts) {
  const baseUrl = flag('--base-url') || `${RELEASES}/download/v${version}`;
  const platforms = collectPlatforms(artifacts, baseUrl);
  if (Object.keys(platforms).length === 0) {
    console.error(`no signed updater artifacts under ${artifacts} — was TAURI_SIGNING_PRIVATE_KEY set?`);
    process.exit(1);
  }
  manifest.platforms = platforms;
}

const json = `${JSON.stringify(manifest, null, 2)}\n`;
const out = flag('-o') || flag('--out');
if (out) {
  writeFileSync(out, json);
  console.log(`wrote ${out} (version ${version})`);
} else {
  process.stdout.write(json);
}
