/* check-v770 — the app ships with Derek's setup as its defaults.
 *
 *   "this is the the full presets file. everything in this file should be made
 *    the default setting. the workspaces should have 5 options, all of which
 *    should be included as default, non deletable options. if this file does
 *    not include 5 workspace options, rework the preset exports so it does
 *    include all workspaces"
 *
 * The export already carried all five, so nothing about the export changed.
 * What is new is that a fresh install now opens as his app — and that the five
 * are permanent: seeded once for a new profile, merged back on EVERY load for
 * a profile that predates this version, and refused by both the store and the
 * two lists that draw the buttons when something tries to delete or rename one.
 *
 * Three things this has to prove beyond "the keys are there":
 *   • it NEVER overwrites — a setting the user has already chosen survives the
 *     seed, or shipping this version would wipe Derek's own app;
 *   • it never REORDERS — forcing the five to the top would undo Edit
 *     Workspaces' up/down arrows on the next restart, which is a silent no-op
 *     with a delay on it;
 *   • the five read CLEAN the moment they are applied. His export predates
 *     v7.69, so its snapshots hold 19 of the 33 fields a snapshot carries now,
 *     and workspaceIsDirty compares key for key — untouched, all five would
 *     have shown "Save Changes to this Workspace" lit forever.
 */
import { readFileSync } from 'node:fs';
import { launch, boot, settle } from './driver.mjs';
import { EXCLUDED_SETTINGS, EXCLUDED_PREFIXES, EXCLUDED_VIEWSTATE } from './build-default-preset.mjs';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  PASS ${name}`); }
  else { fail++; console.log(`  FAIL ${name} ${extra}`); }
};

const BUNDLE = JSON.parse(readFileSync(new URL('../src/data/defaultPreset.json', import.meta.url), 'utf8'));
const PRESET_VS = JSON.parse(BUNDLE.parts.settings['opendraft:viewState']);
const WS_ORDER = BUNDLE.parts.workspaces.workspaceOrder;

/* ── what the bundle carries, and what it deliberately does not ──────────── */
console.log('\nthe shipped bundle is the product, not the machine');
ok('it holds five workspaces', WS_ORDER.length === 5, JSON.stringify(WS_ORDER));
ok('…the five he named', JSON.stringify([...WS_ORDER].sort())
  === JSON.stringify(['Default', 'Editing', 'Focus', 'Minimalist', 'Outlining']), JSON.stringify(WS_ORDER));
/* Every one of these would do real damage on a stranger's computer. The list
   is imported from the builder, so a key dropped there and nowhere else — or
   quietly re-added — fails here rather than shipping. */
const leaked = Object.keys(EXCLUDED_SETTINGS).filter((k) => k in BUNDLE.parts.settings);
ok('…and none of his own keys', leaked.length === 0, JSON.stringify(leaked));
const leakedVs = Object.keys(EXCLUDED_VIEWSTATE).filter((k) => k in PRESET_VS);
ok('…nor the three view-state fields', leakedVs.length === 0, JSON.stringify(leakedVs));
/* The two that would be worst, by name, because a list can pass while the
   thing it was written for slips through in a different key. */
const raw = JSON.stringify(BUNDLE);
ok('…no email address anywhere in it', !/@pm\.me|derekcarl/i.test(raw), '');
ok('…no path into his home folder', !/\/Users\/dcarl|\/Volumes\/Home/.test(raw), '');
/* v7.72: the SEED MARK must never be in here. His 2026-08-21 export carried
   `opendraft:defaultsSeeded:1` — the note saying his machine had already had
   the defaults written into it. As a shipped default it is nonsense, and a
   preset carrying it, imported into a genuinely fresh install, would stop that
   install seeding at all. Prefix-matched because the key is versioned. */
const seeds = Object.keys(BUNDLE.parts.settings)
  .filter((k) => EXCLUDED_PREFIXES.some((p) => k.startsWith(p)));
ok('…and no "already seeded" mark', seeds.length === 0, JSON.stringify(seeds));
/* Every value localStorage holds is a string; a nested object here would be
   written as "[object Object]" and read back as junk by whatever parses it. */
const nonString = Object.entries(BUNDLE.parts.settings).filter(([, v]) => typeof v !== 'string');
ok('…and every setting is a storable string', nonString.length === 0,
  JSON.stringify(nonString.map(([k]) => k)));

const { browser, page } = await launch({ width: 1500, height: 950 });
await boot(page);
await settle(page);

/* ── a fresh profile opens as his app ────────────────────────────────────── */
console.log('\na fresh install comes up on the shipped defaults');
const fresh = await page.evaluate((vs) => {
  const S = () => window.__scStore.getState();
  const s = S();
  return {
    seeded: localStorage.getItem('opendraft:defaultsSeeded:1'),
    /* Read the STORE, not localStorage. That the key landed proves nothing —
       the question is whether the value reached the app, which it only does if
       the seed ran before viewState's `_vs` was computed. */
    toolbarMode: s.toolbarMode, wantToolbarMode: vs.toolbarMode,
    menuMode: s.menuMode, wantMenuMode: vs.menuMode,
    /* Stringified — these are objects and arrays, and === on two of those is a
       question about identity that is always answered "no". */
    chromeGapPx: JSON.stringify(s.chromeGapPx), wantChromeGapPx: JSON.stringify(vs.chromeGapPx),
    theme: s.theme,
    markupPresets: s.markupPresets.length,
    designVars: Object.keys(s.designVars).length,
    /* His ribbon — the 64 buttons themselves, not the migration marker
       `toolbarRibbonSections296`, whose whole value is the string "1". */
    toolbarLeft: JSON.stringify(s.toolbarLeft), wantToolbarLeft: JSON.stringify(vs.toolbarLeft),
    /* Dropped on purpose: the Developer toggle un-hides the Production menu
       v7.69 hid, and the Goals count is his. */
    devToggle: s.showUnreleasedTools,
    windowBounds: localStorage.getItem('opendraft:windowBounds'),
    feedbackProfile: localStorage.getItem('opendraft:feedbackProfile'),
  };
}, PRESET_VS);
ok('the seed ran', fresh.seeded !== null, JSON.stringify(fresh.seeded));
ok('…and reached the store before it read its defaults',
  fresh.toolbarMode === fresh.wantToolbarMode
  && fresh.menuMode === fresh.wantMenuMode
  && fresh.chromeGapPx === fresh.wantChromeGapPx, JSON.stringify(fresh));
ok('…his annotation presets came too', fresh.markupPresets === BUNDLE.parts.annotations.length,
  `${fresh.markupPresets} vs ${BUNDLE.parts.annotations.length}`);
/* v7.76 REVERSED this one. It used to read "his 81 design values arrived as
   overrides" — and they did, until "add these settings directly into the app
   code" made them the tokens' own defaults. A fresh profile now overrides
   NOTHING, which is the stronger claim: the app paints his numbers with an
   empty map. (That it still paints them is check-v776's half; here the point
   is only that seeding no longer smuggles them in as overrides.) */
ok('…and NO design overrides, because those are the code now', fresh.designVars === 0,
  `${fresh.designVars} overrides`);
ok('…and his ribbon, button for button',
  fresh.toolbarLeft === fresh.wantToolbarLeft && PRESET_VS.toolbarLeft.length > 20,
  `${fresh.toolbarLeft?.length} vs ${fresh.wantToolbarLeft?.length}`);
ok('the Developer toggle is NOT on', fresh.devToggle !== true, JSON.stringify(fresh.devToggle));
ok('…and his window position and email did not ship',
  fresh.windowBounds === null && fresh.feedbackProfile === null, JSON.stringify(fresh));

/* ── the five are there, and applying one reads clean ────────────────────── */
console.log('\nfive workspaces, and applying one leaves nothing to save');
const ws = await page.evaluate(async (order) => {
  const S = () => window.__scStore.getState();
  const mod = await window.__scImport('/src/stores/slices/workspacesSlice.ts');
  const dirtyAfterApply = {};
  for (const n of order) {
    S().applyWorkspace(n);
    await new Promise((r) => setTimeout(r, 300));
    dirtyAfterApply[n] = mod.workspaceIsDirty(S());
  }
  return {
    names: S().workspaceOrder.filter((n) => S().workspaces[n]),
    dirtyAfterApply,
    /* Non-vacuity for the line below: move something and it MUST go dirty, or
       "clean after apply" is just a comparison that never returns true. */
    noticesAChange: (() => {
      S().setPanelItemScale({ left: 1.45, right: 1.45 });
      return mod.workspaceIsDirty(S());
    })(),
  };
}, WS_ORDER);
ok('all five are in the list', JSON.stringify(ws.names) === JSON.stringify(WS_ORDER),
  JSON.stringify(ws.names));
const stillDirty = Object.entries(ws.dirtyAfterApply).filter(([, d]) => d).map(([n]) => n);
ok('…and each one reads clean the moment it is applied', stillDirty.length === 0,
  JSON.stringify(stillDirty));
ok('…while a real change still lights the button', ws.noticesAChange === true, '');

/* ── non-deletable, both doors ───────────────────────────────────────────── */
console.log('\nthe five cannot be deleted or renamed');
const guard = await page.evaluate(() => {
  const S = () => window.__scStore.getState();
  S().saveWorkspace('Mine770');            // one of the user's own, for contrast
  S().deleteWorkspace('Default');
  S().renameWorkspace('Editing', 'Editing Renamed');
  const afterBuiltin = { ...S().workspaces };
  S().deleteWorkspace('Mine770');
  const afterMine = { ...S().workspaces };
  return {
    defaultSurvived: 'Default' in afterBuiltin,
    editingSurvived: 'Editing' in afterBuiltin,
    noRenamedCopy: !('Editing Renamed' in afterBuiltin),
    /* NON-VACUITY. If deleteWorkspace were broken outright, every assertion
       above would pass for the wrong reason. */
    mineWasDeletable: 'Mine770' in afterBuiltin && !('Mine770' in afterMine),
  };
});
ok('deleting a built-in does nothing', guard.defaultSurvived === true, JSON.stringify(guard));
ok('…renaming one does nothing either', guard.editingSurvived === true, JSON.stringify(guard));
ok('…and leaves no renamed copy beside it', guard.noRenamedCopy === true, JSON.stringify(guard));
ok('…while a workspace the user made still deletes', guard.mineWasDeletable === true, JSON.stringify(guard));

/* And the UI does not OFFER what the store refuses — a Delete button that
   silently declines is this app's cardinal sin, so the row must not have one. */
const rows = await page.evaluate(async () => {
  const S = () => window.__scStore.getState();
  S().saveWorkspace('Mine770');
  S().setToolMode('workspaces', 'floating');
  S().openTool('workspaces');
  await new Promise((r) => setTimeout(r, 700));
  const read = (sel, nameSel) => [...document.querySelectorAll(sel)].map((r) => ({
    name: r.querySelector(nameSel)?.textContent?.replace(/active$|default$/, '').trim(),
    badge: Boolean(r.querySelector('.ws-builtin-badge')),
    buttons: [...r.querySelectorAll('.ws-icon-btn')].map((b) => b.title),
  }));
  const panel = read('.ws-item', '.ws-apply-name');
  /* The Edit Workspaces dialog is the OTHER door onto the same list — the one
     with its own copy of the rename and delete buttons. */
  [...document.querySelectorAll('.ws-action-btn')]
    .find((b) => b.textContent.startsWith('Edit Workspaces'))?.click();
  await new Promise((r) => setTimeout(r, 400));
  return { panel, dialog: read('.ws-row', '.ws-name') };
});
for (const [where, list] of Object.entries(rows)) {
  const builtins = list.filter((r) => WS_ORDER.includes(r.name));
  const mine = list.find((r) => r.name === 'Mine770');
  ok(`${where}: all five rows are drawn`, builtins.length === 5,
    JSON.stringify(list.map((r) => r.name)));
  ok(`${where}: …each marked as a default`, builtins.every((r) => r.badge), JSON.stringify(builtins));
  ok(`${where}: …with no Rename or Delete on them`,
    builtins.every((r) => !r.buttons.some((t) => /rename|delete/i.test(t ?? ''))),
    JSON.stringify(builtins));
  /* NON-VACUITY again: the buttons must exist on a row that CAN take them, or
     this passes on a list that simply renders no buttons at all. */
  ok(`${where}: …but both on one the user made`,
    Boolean(mine) && ['Rename', 'Delete'].every((t) => mine.buttons.includes(t)),
    JSON.stringify(mine));
}

/* ── it never overwrites, and never reorders ─────────────────────────────── */
console.log('\nan existing setup survives the seed intact');
const kept = await page.evaluate(async () => {
  const S = () => window.__scStore.getState();
  /* A choice the user has already made, in a key the bundle also carries.
     NOT the theme, which is what this reached for first: `followSystemTheme`
     ships on, so the app rewrites opendraft:theme from the OS at every boot
     and the sentinel came back changed by something that had nothing to do
     with seeding. */
  localStorage.setItem('opendraft:dateFormat', 'iso');
  /* His arrangement of the list, with a built-in moved off the top. */
  S().setWorkspaceOrder(['Mine770', 'Focus', 'Default', 'Editing', 'Outlining', 'Minimalist']);
  /* And one of the five deleted straight out of storage, the way a profile
     that predates this version has none of them. */
  const vs = JSON.parse(localStorage.getItem('opendraft:viewState'));
  delete vs.workspaces.Focus;
  localStorage.setItem('opendraft:viewState', JSON.stringify(vs));
  /* Re-arm the seed. Without this the pass is skipped and "it did not
     overwrite" would be true of a pass that never ran. */
  localStorage.removeItem('opendraft:defaultsSeeded:1');
  return { dateFormat: localStorage.getItem('opendraft:dateFormat') };
});
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForSelector('.ProseMirror', { timeout: 25000 });
await settle(page);
const after = await page.evaluate(() => {
  const S = () => window.__scStore.getState();
  return {
    seedRan: localStorage.getItem('opendraft:defaultsSeeded:1') !== null,
    dateFormat: localStorage.getItem('opendraft:dateFormat'),
    order: S().workspaceOrder,
    hasFocus: 'Focus' in S().workspaces,
    focusFields: Object.keys(S().workspaces.Focus ?? {}).length,
  };
});
ok('the seed pass ran again', after.seedRan === true, '');
ok('…and did not touch a setting already chosen', after.dateFormat === 'iso',
  `${kept.dateFormat} → ${after.dateFormat}`);
ok('…the missing built-in came back', after.hasFocus === true, '');
ok('…complete, not as the 19 fields his export saved',
  after.focusFields >= 30, JSON.stringify(after.focusFields));
ok('…and his ordering is exactly as he left it',
  JSON.stringify(after.order) === JSON.stringify(['Mine770', 'Focus', 'Default', 'Editing', 'Outlining', 'Minimalist']),
  JSON.stringify(after.order));

await browser.close();
console.log(`\ncheck-v770: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
