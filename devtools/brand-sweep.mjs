#!/usr/bin/env node
/**
 * brand-sweep (v7.15) — Derek, queued 2026-08-14: "look through all code and
 * make sure any instance of 'Freedraft' or 'OpenDraft' are removed (excluding
 * the about page which actually talks about OpenDraft) and replaced with
 * ScriptCraft."
 *
 * A blanket find-replace would break the app, so this sweeps PROSE only and
 * refuses to touch anything that names a thing:
 *
 *  · `opendraft:…`      — 224 localStorage keys. Renaming orphans every
 *                         setting, workspace, theme and layout Derek has.
 *  · `.odraft`          — the file format. Renaming orphans saved scripts.
 *  · `com.freedraft.*`  — the bundle id: the app's identity to macOS.
 *  · `OPENDRAFT_*`      — env vars a running deployment reads.
 *  · slugs and filenames (opendraft-collab, OpenDraft-intro.mp4, …) — real
 *    services, volumes, GCP projects and files on disk.
 *
 * Run `node devtools/brand-sweep.mjs --check` to fail when a NEW prose mention
 * appears; that check runs in check-all so this can't silently come back.
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');

/** Files whose OpenDraft mentions are DELIBERATE — provenance, not branding. */
const KEEP_FILES = [
  'docs/UPSTREAM-OPENDRAFT-NOTES.md',   // the archived upstream document
  'CLAUDE.md',                          // the naming history, stated on purpose
  'docs/HANDOFF.md',                    // engineering history: rewriting it lies
  'docs/HANDOFF-CONTINUE.md',
  'docs/HANDOFF-ARCHIVE.md',
  'frontend/src/components/AboutDialog.tsx',  // credits OpenDraft as upstream
  /* v7.31: the repo is PUBLIC, so the README names the upstream twice on
     purpose — the fork attribution, and an honest note that the apps in
     the stores are OpenDraft's rather than this fork's. Sweeping either
     would turn a true statement into a false one, which is the same
     reason the changelog and the About window are here. */
  'README.md',
  /* v7.78: the updater doc explains why publishing has its OWN workflow rather
     than living in release.yml — because release.yml is upstream's, and builds
     Android, iOS, a Mac App Store target and a Docker image this product does
     not ship. That provenance IS the reason; sweeping the name would leave the
     decision looking arbitrary. */
  'docs/UPDATING.md',
  'devtools/brand-sweep.mjs',           // this file names what it protects
  'frontend/devtools/check-brand.mjs',  // and so does its guard
  /* v7.37/v7.39 — DEVTOOLS THAT EXPLAIN WHAT THEY REPLACED. Each of these
     names the upstream because that is the content of the explanation: the
     README was rewritten because it was OpenDraft's marketing copy, and the
     icons were regenerated because the art was OpenDraft's. Two of them quote
     Derek's request verbatim. Sweeping the name would leave a tool whose
     stated purpose no longer says what it guards against — the same reason
     the README, the changelog and the About window are on this list. These
     are comments in dev tooling; none of it ships. */
  'frontend/devtools/check-readme.mjs',
  'frontend/devtools/build-app-icons.mjs',
  'frontend/devtools/check-icons.mjs',
  '.github/FUNDING.yml',                // ko-fi / buy-me-a-coffee HANDLES —
                                        // upstream's accounts, not ours to rename
  /* The changelog is a RECORD. "replacing the old OpenDraft art" becomes a
     false sentence if swept, and the entry about the crate rename stops
     making sense at all. */
  'frontend/src/data/changelog.json',
  'frontend/src/data/changelog.ts',
  /* Same reason: its header explains that the crate was renamed BECAUSE
     `tauri dev` names the macOS app menu after the debug binary, so "Hide
     freedraft" lingered. Sweep it and the sentence says the menu showed the
     name it was renamed to — the note stops explaining anything. */
  'src-tauri/Cargo.toml',
];

/* frontend/src is swept BY HAND. Its OpenDraft mentions are mostly
   provenance — "OpenDraft's inherited A4 geometry", "from the original
   OpenDraft welcome" — and rewriting those makes true statements false. The
   handful of USER-VISIBLE strings in there were changed deliberately; this
   tool stays out. */
const SKIP_PREFIXES = [
  'frontend/src/',
  /* A stashed copy of the GENERATED iOS project (src-tauri/gen/apple, which
     is skipped as generated). Its `name`, PRODUCT_NAME and bundle id must
     keep matching the live project — build-ios-device.sh looks for
     OpenDraft.app inside the archive — so renaming the copy alone would
     produce exactly the two-lists-that-drift bug this repo keeps hitting. */
  'images/ios-config/',
];

/** Directories with nothing user-facing in them. */
const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'target', 'build', 'gen', '.vite',
  'test-script',        // one-off debugging scratch, not shipped
  'src-tauri/gen',      // generated platform projects
]);

/** Token shapes that NAME something. Order matters — longest first. */
const PROTECTED = [
  /opendraft:[A-Za-z0-9_.:-]*/gi,        // localStorage keys
  /com\.freedraft\.[A-Za-z0-9.]*/gi,     // bundle id
  /\.odraft\b/gi,                        // file format
  /OPENDRAFT_[A-Z0-9_]+/g,               // env vars
  /opendraft[-_][A-Za-z0-9_.-]+/gi,      // services, volumes, projects, files
  /OpenDraft[-_][A-Za-z0-9_.-]+/g,       // asset filenames (OpenDraft-intro.mp4)
  /UPSTREAM-OPENDRAFT-NOTES/gi,
  /* Domains and account handles NAME something too, and ScriptCraft owns
     none of them yet — swapping the word would invent an address. Each is
     dealt with deliberately, not by find-replace. */
  /(?:https?:\/\/)?(?:[a-z0-9-]+\.)*opendraft\.[a-z]{2,}/gi,
  /@opendraft\.[a-z]{2,}/gi,
  /Proteus-Technologies-Private-Limited\/OpenDraft/gi,
  /* CREDENTIALS AND SHELL DEFAULTS. The release workflow generates a temp
     Android keystore with `-alias opendraft -storepass opendraft`, and signs
     with `${ANDROID_KEY_ALIAS:-opendraft}` fifteen lines below. Sweeping only
     the half that has a space in front of it — which is what a word-boundary
     rule does — leaves a keystore signed with a name nothing looks for, and
     the Android release build fails. An alias and a password are names. */
  /-(?:alias|storepass|keypass|dname)\s+"?[^"\s\\]+/gi,
  /:-[A-Za-z0-9_]+\}/g,
  /(?:CN|O)=[A-Za-z0-9_ ]+/g,
];

const WORD = /(OpenDraft|Opendraft|openDraft|opendraft|OPENDRAFT|FreeDraft|Freedraft|freeDraft|freedraft|FREEDRAFT)/g;

const REPLACEMENT = (matched) => {
  if (matched === matched.toUpperCase()) return 'SCRIPTCRAFT';
  if (matched === matched.toLowerCase()) return 'scriptcraft';
  return 'ScriptCraft';
};

/** Blank out protected tokens so the word pass can't see inside them. */
function mask(text) {
  let masked = text;
  for (const re of PROTECTED) {
    masked = masked.replace(re, (m) => ' '.repeat(m.length));
  }
  return masked;
}

/* A match is PROSE only if it stands alone. Welded to an identifier char, a
   hyphen, a slash, a colon or a dot-then-letter, it is naming something:
   __opendraftDeviceIdMemo, non-opendraft, opendraft/main, opendraft.dev.
   A trailing sentence full stop does not count — "built on OpenDraft." is
   prose, "opendraft.dev" is an address. */
const GLUE = /[A-Za-z0-9_$/:-]/;
function standsAlone(text, start, end) {
  const before = start > 0 ? text[start - 1] : ' ';
  const after = end < text.length ? text[end] : ' ';
  if (GLUE.test(before) || GLUE.test(after)) return false;
  if (after === '.' && /[A-Za-z0-9]/.test(text[end + 1] || ' ')) return false;
  /* A DOT ON THE LEFT with a name before it is a reverse-DNS identifier, and
     the first run of this tool swept every one of them: `package
     com.proteus.opendraft` in android-src/MainActivity.kt (the release
     workflow copies that file to .../java/com/proteus/opendraft/ — the
     package line and the directory must agree), PRODUCT_BUNDLE_IDENTIFIER and
     bundleIdPrefix in the iOS project, the entitlements plist keys, the Play
     Store listing URL, `simctl launch`, the App Store CFBundleIdentifier, and
     `%APPDATA%\\com.proteus.opendraft` — the Windows folder holding the
     writer's data. A bundle id is the app's identity to the OS; this is the
     same class as com.freedraft.app and must never be rewritten. */
  if ((before === '.' || before === '\\') && /[A-Za-z0-9_%]/.test(text[start - 2] || ' ')) return false;
  /* `cd OpenDraft` is a DIRECTORY, and the line above it is a git clone of a
     repository we do not own yet, so the two must keep matching. Sweeping
     only the cd left instructions that clone one folder and enter another. */
  const lineHead = text.slice(text.lastIndexOf('\n', start - 1) + 1, start);
  if (/(?:^|[;&|$>])\s*cd\s+$/.test(lineHead)) return false;
  /* A bullet whose WHOLE content is the word is a reference, not a sentence.
     docker-compose.combined.yml defines the service as `opendraft:` (which
     the storage-key rule happens to protect) and names it again under
     `depends_on: - opendraft`. Sweeping only the second one leaves compose
     depending on a service that does not exist. */
  const lineTail = text.slice(end, text.indexOf('\n', end) === -1 ? text.length : text.indexOf('\n', end));
  if (/^\s*-\s*$/.test(lineHead) && /^\s*$/.test(lineTail)) return false;
  /* INFRASTRUCTURE RESOURCE NAMES — a database role, a registry repository, a
     service account. Same trap as the Android keystore, and it caught the
     same file twice: collab-server/setup.sh sets DB_USER="opendraft" at the
     top and re-reads it as ${DB_USER:-opendraft} in the postgres branch
     twenty lines down. The `:-…}` half is protected, so sweeping the
     assignment left the prompt offering one name and the default applying
     another. These name resources that exist (or will be created once) —
     renaming them is a migration, not a find-replace. The shapes:
       DB_USER="opendraft"          shell assignment, SHOUTING_CASE
       [opendraft]                  the prompt's default label
       || 'opendraft'               the code default that must match it
     Lowercase `name = "…"` with spaces is deliberately NOT here: that is
     Cargo's crate name, which really did become scriptcraft, and release.sh
     was still bumping the version of a package called opendraft. */
  if (/\b[A-Z][A-Z0-9_]*=["']?$/.test(lineHead)) return false;
  if (/\|\|\s*['"]$/.test(lineHead)) return false;
  if (/\[$/.test(lineHead) && /^\]/.test(lineTail)) return false;
  return true;
}

/* BUILD OUTPUTS are neither prose nor identity — they are the names of files
   the build produces, and they take the product name. `productName` became
   "ScriptCraft" in v1.34 (2026-07-13), so tauri has been emitting
   ScriptCraft_<v>_aarch64.dmg and ScriptCraft.app ever since, while the
   release workflow, release.sh, the README download table and the landing
   page all still asked for OpenDraft_*. Stale for ~180 versions, and nobody
   noticed because the pipeline hasn't run — build-desktop.sh, the script
   Derek actually uses, finds the .dmg by glob.

   What is NOT touched here: names the platform owns rather than the build —
   src-tauri/gen/apple is a generated project genuinely called opendraft (so
   the iOS archive really does hold OpenDraft.app), com.proteus.opendraft is
   the bundle id, opendraft.mobileprovision is a profile keyed to it, and
   ghcr.io/…/opendraft-combined is a published image whose name people pull. */
const ARTIFACT_RULES = [
  [/OpenDraft_(?=[0-9$*{[])/g, 'ScriptCraft_'],     // dmg/exe/msi/deb/AppImage/apk/aab/ipa
  /* rpm only — OpenDraft-VERSION-1.x86_64.rpm. Matching "OpenDraft-" before
     any digit was too greedy and renamed images/OpenDraft-1024x1024.png,
     a file that is really on disk and really is called that. */
  [/OpenDraft-(?=[^\s"'()]*x86_64\.rpm)/g, 'ScriptCraft-'],
  [/bundle\/macos\/OpenDraft\.app/g, 'bundle/macos/ScriptCraft.app'],
  [/Contents\/MacOS\/opendraft/g, 'Contents/MacOS/ScriptCraft'],
  [/OpenDraft\.pkg/g, 'ScriptCraft.pkg'],
];

export function sweepText(input) {
  let text = input;
  for (const [re, to] of ARTIFACT_RULES) text = text.replace(re, to);
  const masked = mask(text);
  let out = '';
  let last = 0;
  for (const m of masked.matchAll(WORD)) {
    const i = m.index;
    const end = i + m[0].length;
    if (!standsAlone(text, i, end)) continue;
    out += text.slice(last, i) + REPLACEMENT(text.substr(i, m[0].length));
    last = end;
  }
  return out + text.slice(last);
}

function walk(dir, hits = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const rel = relative(ROOT, full);
    if (SKIP_DIRS.has(name) || SKIP_DIRS.has(rel)) continue;
    const st = statSync(full);
    if (st.isDirectory()) { walk(full, hits); continue; }
    if (!/\.(ts|tsx|js|mjs|jsx|css|html|md|sh|yml|yaml|json|py|kt|toml|nsh|conf|env|example|entitlements)$/.test(name)) continue;
    if (KEEP_FILES.includes(rel)) continue;
    if (SKIP_PREFIXES.some((p) => rel.startsWith(p))) continue;
    let text;
    try { text = readFileSync(full, 'utf8'); } catch { continue; }
    if (!/opendraft|freedraft/i.test(text)) continue;
    const swept = sweepText(text);
    if (swept !== text) hits.push({ full, rel, text, swept });
  }
  return hits;
}

const check = process.argv.includes('--check');
const hits = walk(ROOT);

if (check) {
  if (hits.length === 0) {
    console.log('brand-sweep: 1 passed, 0 failed');
    console.log('  ✓ no un-swept OpenDraft/FreeDraft prose');
    process.exit(0);
  }
  console.log('brand-sweep: 0 passed, 1 failed');
  console.log(`  ✗ ${hits.length} file(s) still carry OpenDraft/FreeDraft prose:`);
  for (const h of hits.slice(0, 20)) {
    const line = h.text.split('\n').find((l) => /opendraft|freedraft/i.test(l) && sweepText(l) !== l);
    console.log(`      ${h.rel}: ${(line || '').trim().slice(0, 90)}`);
  }
  console.log('  → run: node devtools/brand-sweep.mjs   (or add the file to KEEP_FILES with a reason)');
  process.exit(1);
}

for (const h of hits) writeFileSync(h.full, h.swept);
console.log(`brand-sweep: rewrote ${hits.length} file(s)`);
for (const h of hits) console.log(`  ${h.rel}`);
