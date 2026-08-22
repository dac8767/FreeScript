/* build-default-preset.mjs (v7.70) — turn one of Derek's preset exports into
 * the app's shipped defaults.
 *
 *   node devtools/build-default-preset.mjs <exported-preset.json>
 *
 * Derek: "this is the the full presets file. everything in this file should be
 * made the default setting."
 *
 * ALMOST everything. A preset export is a snapshot of ONE person's app on ONE
 * machine, and a handful of its keys are his rather than the product's. Baked
 * in as defaults they would each do real damage on a stranger's computer, so
 * they are dropped HERE, by name, with the reason attached — not quietly
 * skipped somewhere in the app.
 *
 * Re-run this whenever he sends a newer export; the exclusions travel with it.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const OUT = new URL('../src/data/defaultPreset.json', import.meta.url);

/** localStorage keys that describe the MACHINE or the PERSON, not the product. */
export const EXCLUDED_SETTINGS = {
  'opendraft:feedbackProfile':
    "Derek's name and email — every tester would file feedback as him",
  'opendraft:feedbackQueue': 'his unsent feedback',
  'opendraft:bookmarks': 'bookmarks pointing into script ids that exist on his disk',
  'opendraft:lastOpenedScript': 'a project/script uuid nobody else has',
  'opendraft:lastWindowTabs': 'which tab he last had open in three windows',
  'opendraft:notebook': 'the contents of his Scrapbook',
  'opendraft:windowBounds':
    'x:-1730 — a second monitor to the LEFT of his main one. On any other machine the app opens off-screen, which reads as "it did not launch"',
  'opendraft:saveloc:localFolder': '/Users/dcarl/Downloads',
  'opendraft:saveloc:backupFolder': '/Volumes/Home/10 - Writing/…',
  'opendraft:saveloc:screenshotFolder': '/Users/dcarl/Documents/…',
  'opendraft:saveloc:snapLocalFolder': '/Users/dcarl/Documents/…',
  /* The toggles go with the folders they point at. Left on with the path
     dropped, every save would try to write to a folder that was never set. */
  'opendraft:saveloc:saveToBackupFolder': 'points at the backup folder above',
  'opendraft:saveloc:snapToLocalFolder': 'points at the snapshot folder above',
};

/** Key PREFIXES dropped the same way — for keys that carry a version suffix.
 *
 *  v7.72: his 2026-08-21 export carried `opendraft:defaultsSeeded:1`, the mark
 *  saying that machine had already had the shipped defaults written into it.
 *  Shipping "already seeded" as part of the defaults is nonsense, and importing
 *  such a preset into a genuinely fresh install would stop it seeding at all.
 *  The real defence is in the app — isBackupExcluded (utils/settingsBackup.ts)
 *  now keeps it out of every export and refuses it on the way back in — so this
 *  is belt and braces, and it keeps the committed bundle readable. */
export const EXCLUDED_PREFIXES = ['opendraft:defaultsSeeded:'];

/** Fields inside the viewState blob, same rule. */
export const EXCLUDED_VIEWSTATE = {
  showUnreleasedTools:
    'the Developer toggle. On by default it un-hides the Production menu that v7.69 hid, and Lock Pages with it',
  goalsCompleted: 'his running count of finished writing goals',
  windowShape:
    'remembered x/y for each tool window — positions from his display, on someone else\'s',
  /* NOT privacy — SINGLE SOURCE OF TRUTH. The export carries the same five
     workspaces twice: once as parts.workspaces (the part the checklist means)
     and once inside this blob, because that is where the store persists them.
     Seeded, the viewState copy wins — it is written before anything reads it —
     and the copy the app then shows is the raw one, missing the 14 fields a
     snapshot grew in v7.69, so all five read as "changed" the moment they were
     applied. parts.workspaces is the source; stores/seedDefaults completes it
     and merges it on every load. */
  workspaces: 'a second copy of parts.workspaces, and the stale one',
  workspaceOrder: 'ditto — the order lives with the workspaces it orders',
  /* v7.76: the same three ride INSIDE this blob as well as in their own parts,
     and it is the blob that actually seeds them. Dropping only the parts would
     have left a fresh install with all 81 design overrides and all 141
     helper-text overrides anyway — see EXCLUDED_PARTS for why none of them
     should be there now. */
  designVars: 'the token defaults are in designTokens.ts and the CSS now',
  helperTextOverrides: 'the source strings say it themselves now',
  helperTextHidden: 'only ever governed the Helper Text window\'s own list',
};

/** Whole PARTS that no longer belong in the shipped bundle (v7.76).
 *
 *  Derek: "take these settings and add them directly into the app code." Design
 *  values are the tokens' own defaults now and helper text is the source
 *  strings, so shipping them as SEEDED OVERRIDES as well would mean a fresh
 *  install starts with 81 design overrides and 141 helper-text overrides that
 *  say exactly what the code already says — "Reset Design" would report 81
 *  changes that change nothing, and the helper-text MutationObserver would run
 *  for a map with no effect. The code is the one place now. */
export const EXCLUDED_PARTS = {
  design: 'the token defaults in src/design/designTokens.ts and the CSS fallbacks',
  helpertext: 'the source strings themselves',
};

/** The transform, as a function — check-v770 imports the two lists above to
 *  verify the shipped bundle really is missing every key they name, so this
 *  file must be importable without running. */
export function buildDefaultPreset(bundle) {
  const dropped = [];
  const settings = { ...(bundle.parts.settings ?? {}) };
  for (const key of Object.keys(EXCLUDED_SETTINGS)) {
    if (key in settings) { delete settings[key]; dropped.push(key); }
  }
  for (const key of Object.keys(settings)) {
    if (EXCLUDED_PREFIXES.some((p) => key.startsWith(p))) { delete settings[key]; dropped.push(key); }
  }

  /* viewState rides inside settings as a JSON string. */
  if (typeof settings['opendraft:viewState'] === 'string') {
    const vs = JSON.parse(settings['opendraft:viewState']);
    for (const key of Object.keys(EXCLUDED_VIEWSTATE)) {
      if (key in vs) { delete vs[key]; dropped.push(`viewState.${key}`); }
    }
    settings['opendraft:viewState'] = JSON.stringify(vs);
  }

  const parts = { ...bundle.parts, settings };
  for (const id of Object.keys(EXCLUDED_PARTS)) {
    if (id in parts) { delete parts[id]; dropped.push(`parts.${id}`); }
  }
  const includes = (bundle.includes ?? []).filter((id) => !(id in EXCLUDED_PARTS));

  return {
    doc: {
      ...bundle,
      includes,
      /* Stamped so a future reader knows which export this came from and that
         it went through here rather than being pasted in whole. */
      sourceExportedAt: bundle.exportedAt,
      builtBy: 'devtools/build-default-preset.mjs',
      parts,
    },
    dropped,
  };
}

function main() {
  const srcPath = process.argv[2];
  if (!srcPath) {
    console.error('usage: node devtools/build-default-preset.mjs <exported-preset.json>');
    process.exit(1);
  }

  const bundle = JSON.parse(readFileSync(srcPath, 'utf8'));
  if (bundle.kind !== 'preset-bundle') {
    console.error(`not a preset bundle (kind: ${bundle.kind})`);
    process.exit(1);
  }

  const { doc, dropped } = buildDefaultPreset(bundle);
  writeFileSync(OUT, `${JSON.stringify(doc, null, 2)}\n`);

  const ws = Object.keys(bundle.parts.workspaces?.workspaces ?? {});
  console.log('wrote src/data/defaultPreset.json');
  console.log(`  parts:      ${bundle.includes.join(', ')}`);
  console.log(`  settings:   ${Object.keys(doc.parts.settings).length} kept, ${dropped.length} dropped`);
  console.log(`  workspaces: ${ws.length} — ${ws.join(', ')}`);
  for (const d of dropped) console.log(`    dropped ${d}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main();
