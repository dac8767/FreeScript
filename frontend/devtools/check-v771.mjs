/* check-v771 — Reset puts back the workspace you are standing in.
 *
 * Derek, against v7.70: "you were supposed to make all of the settings i sent
 * the defaults, but when I clicked 'reset' on the customize > toolbar window,
 * it changed the toolbar to a setting nothing like the default it should have
 * been." Then, the rule: "resetting anything should set it to the default of
 * the current workspace. so resetting the ribbon toolbar returns it to the
 * initial state of the current workspace, whether it is the default workspace,
 * minimalist, etc."
 *
 * v7.70 made his preset the app's defaults by SEEDING localStorage, which no
 * Reset button ever reads. They each called a hardcoded constant —
 * DEFAULT_TOOLBAR_LEFT, DEFAULT_TOOL_CONFIG, 'compact', 1 — so "reset to
 * default" still meant the pre-v7.70 factory layout. Two definitions of
 * "default" and the buttons held the wrong one.
 *
 * The order is now decided in ONE place (resetValue): the applied workspace's
 * snapshot, then what the app ships, then the built-in constant. The first step
 * is what makes Reset and "Reset to Saved Layout" agree, per field.
 *
 * THE TEST THAT MATTERS is the same button pressed under two workspaces: the
 * five ship with five different ribbons, so a reset that lands on Minimalist's
 * 45 items under Minimalist and Default's 64 under Default cannot be reading a
 * constant.
 */
import { readFileSync } from 'node:fs';
import { launch, boot, settle } from './driver.mjs';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  PASS ${name}`); }
  else { fail++; console.log(`  FAIL ${name} ${extra}`); }
};

const BUNDLE = JSON.parse(readFileSync(new URL('../src/data/defaultPreset.json', import.meta.url), 'utf8'));
const WS = BUNDLE.parts.workspaces.workspaces;
const PRESET_VS = JSON.parse(BUNDLE.parts.settings['opendraft:viewState']);

/* The premise. If the five shipped the same ribbon, every assertion below
   would pass on a reset that ignored workspaces entirely. */
console.log('\nthe five workspaces really do differ');
ok('Default and Minimalist carry different ribbons',
  JSON.stringify(WS.Default.toolbarLeft) !== JSON.stringify(WS.Minimalist.toolbarLeft),
  `${WS.Default.toolbarLeft.length} vs ${WS.Minimalist.toolbarLeft.length}`);
ok('…and different tool docks',
  JSON.stringify(WS.Default.toolOrder) !== JSON.stringify(WS.Outlining.toolOrder), '');

const { browser, page } = await launch({ width: 1500, height: 950 });
await boot(page);
await settle(page);

/** Press one registry reset by id, without the confirm dialog in the way —
 *  runCustomizeReset's warning is check-v6.77's subject, not this one. */
const runReset = (id) => page.evaluate(async (resetId) => {
  const mod = await window.__scImport('/src/components/customizeResets.tsx');
  const action = mod.CUSTOMIZE_RESETS.find((a) => a.id === resetId);
  if (!action) throw new Error(`no reset registered as ${resetId}`);
  action.run();
  await new Promise((r) => setTimeout(r, 250));
}, id);

const read = (fields) => page.evaluate((f) => {
  const s = window.__scStore.getState();
  const out = {};
  for (const k of f) out[k] = s[k];
  return out;
}, fields);

const apply = (name) => page.evaluate(async (n) => {
  window.__scStore.getState().applyWorkspace(n);
  await new Promise((r) => setTimeout(r, 350));
  return window.__scStore.getState().activeWorkspace;
}, name);

/* ── the ribbon, under two different workspaces ──────────────────────────── */
console.log('\nReset Items gives back the ribbon of the workspace you are in');
const ribbons = {};
for (const name of ['Default', 'Minimalist']) {
  await apply(name);
  /* Wreck it first, so "it came back" is a real journey and not the state it
     was already in. */
  await page.evaluate(async () => {
    window.__scStore.getState().setToolbarZones(['b:bold'], []);
    await new Promise((r) => setTimeout(r, 200));
  });
  const wrecked = (await read(['toolbarLeft'])).toolbarLeft.length;
  await runReset('toolbarItems');
  const after = await read(['toolbarLeft', 'toolbarDdWidths']);
  ribbons[name] = { wrecked, got: after.toolbarLeft, dd: after.toolbarDdWidths };
}
for (const name of ['Default', 'Minimalist']) {
  ok(`${name}: the ribbon was actually broken first`, ribbons[name].wrecked === 1,
    JSON.stringify(ribbons[name].wrecked));
  ok(`${name}: …and Reset Items put ITS ribbon back`,
    JSON.stringify(ribbons[name].got) === JSON.stringify(WS[name].toolbarLeft),
    `${ribbons[name].got.length} items, wanted ${WS[name].toolbarLeft.length}`);
}
/* THE ONE THAT CANNOT PASS ON A CONSTANT. */
ok('…so the same button gave two different answers',
  JSON.stringify(ribbons.Default.got) !== JSON.stringify(ribbons.Minimalist.got), '');
/* And the dropdown widths rode along, instead of being wiped to {} — they are
   part of the ribbon's layout, and clearing them was the old reset's doing.
   Against the COMPLETED snapshot: his export predates v7.69, so the raw JSON
   holds 19 fields and seedDefaults fills the other 14 from the export's live
   view state. Reading the raw file here would ask for {} and get the right
   answer marked wrong. */
ok('…with his dropdown widths, not an empty set',
  JSON.stringify(ribbons.Default.dd)
    === JSON.stringify(WS.Default.toolbarDdWidths ?? PRESET_VS.toolbarDdWidths)
  && Object.keys(ribbons.Default.dd).length > 0,
  JSON.stringify(ribbons.Default.dd));

/* ── the panels, same rule ───────────────────────────────────────────────── */
console.log('\nReset Items on the panels gives back that workspace’s dock');
await apply('Outlining');
await page.evaluate(async () => {
  const s = window.__scStore.getState();
  s.setToolOrder(['navigator']);
  s.setToolConfig({ navigator: { side: 'right', enabled: true } });
  await new Promise((r) => setTimeout(r, 200));
});
await runReset('panelsItems');
const panels = await read(['toolOrder', 'toolConfig']);
ok('the dock is Outlining’s, not the factory list',
  JSON.stringify(panels.toolOrder) === JSON.stringify(WS.Outlining.toolOrder),
  `${panels.toolOrder.length} tools, wanted ${WS.Outlining.toolOrder.length}`);
ok('…and so is every tool’s side',
  JSON.stringify(panels.toolConfig) === JSON.stringify(WS.Outlining.toolConfig), '');

/* ── sizes ───────────────────────────────────────────────────────────────── */
console.log('\nReset Size follows the workspace too');
await apply('Minimalist');
await page.evaluate(async () => {
  window.__scStore.getState().setToolbarMode('comfortable');
  await new Promise((r) => setTimeout(r, 200));
});
await runReset('toolbarSize');
const size = await read(['toolbarMode']);
/* Minimalist hides the toolbar entirely — the clearest possible proof this is
   not reading 'compact' off a constant. */
ok('Minimalist’s toolbar mode comes back', size.toolbarMode === WS.Minimalist.toolbarMode,
  `${size.toolbarMode}, wanted ${WS.Minimalist.toolbarMode}`);

/* ── what a workspace does NOT carry falls through to the shipped bundle ─── */
console.log('\nwhat a workspace does not carry falls through to what ships');
/* v7.76 turned two of these three the other way up. The probe used to EMPTY
   designVars and helperTextHidden, because a correct reset REFILLED them from
   the 81 seeded design values and the seeded hidden list. Those are the code
   now, so a correct reset EMPTIES them instead — and emptying something that
   is already empty proves nothing. So the probe dirties all three the same
   way: a value that could not have come from a reset. */
await page.evaluate(async () => {
  const s = window.__scStore.getState();
  s.setDesignVars({ editorMainPadTop: 97, toolWinRadius: 3 });
  s.setMarkupPresets([{ icon: 'star', color: '#ff0000' }]);
  s.setHelperTextHidden(['a string no catalog entry has']);
  await new Promise((r) => setTimeout(r, 200));
});
await runReset('designTokens');
await runReset('markupPresets');
await runReset('helperText');
const rest = await read(['designVars', 'markupPresets', 'helperTextHidden']);
/* "Reset Design" restores the DEFAULTS, and the defaults are the tokens
   themselves now — so a correct reset clears the override map, where before it
   refilled it with the 81 seeded values. The probe left two overrides in it,
   so this cannot pass by standing still. */
ok('Reset Design clears the overrides — the defaults are the code now',
  Object.keys(rest.designVars).length === 0,
  `${Object.keys(rest.designVars).length} left`);
/* By VALUE, and honestly labelled: Derek never changed his annotation presets,
   so the six in the bundle are the six in DEFAULT_MARKUP_PRESETS, character for
   character. NOTHING here can tell which source the reset read — proven by
   break-testing it — so this claims only what it can: the presets come back,
   in full, from the single red star the probe above left behind. */
ok('…the annotation presets come back in full',
  JSON.stringify(rest.markupPresets) === JSON.stringify(BUNDLE.parts.annotations),
  `${rest.markupPresets.length} vs ${BUNDLE.parts.annotations.length}`);
/* Same reversal, and the probe planted a string no catalog entry carries, so
   an untouched list would still be holding it. */
ok('…and the helper-text reset leaves nothing hidden',
  rest.helperTextHidden.length === 0, JSON.stringify(rest.helperTextHidden));

/* The element list is not in a workspace either, and its reset used to empty
   the hidden set — which is a REAL difference now: the defaults hide four. */
const elements = await page.evaluate(async () => {
  const fmt = await window.__scImport('/src/stores/formattingTemplateStore.ts');
  fmt.useFormattingTemplateStore.setState({ elementHidden: [], elementOrder: [] });
  await new Promise((r) => setTimeout(r, 150));
  fmt.useFormattingTemplateStore.getState().resetElementOverrides();
  await new Promise((r) => setTimeout(r, 150));
  return fmt.useFormattingTemplateStore.getState().elementHidden;
});
const shippedHidden = JSON.parse(BUNDLE.parts.settings['opendraft:elementOverrides']).hidden;
ok('…and the hidden elements come back hidden',
  JSON.stringify(elements) === JSON.stringify(shippedHidden),
  `${JSON.stringify(elements)} vs ${JSON.stringify(shippedHidden)}`);

/* ── Reset All, and the no-workspace case ───────────────────────────────── */
console.log('\nReset All, and what happens with no workspace applied');
await apply('Focus');
await page.evaluate(async () => {
  const s = window.__scStore.getState();
  s.setToolbarZones(['b:bold'], []);
  s.setToolOrder(['navigator']);
  await new Promise((r) => setTimeout(r, 200));
  s.resetAllCustomizations();
  await new Promise((r) => setTimeout(r, 300));
});
const all = await read(['toolbarLeft', 'toolOrder']);
ok('Reset All lands on Focus, not on the factory',
  JSON.stringify(all.toolbarLeft) === JSON.stringify(WS.Focus.toolbarLeft)
  && JSON.stringify(all.toolOrder) === JSON.stringify(WS.Focus.toolOrder),
  `${all.toolbarLeft.length}/${all.toolOrder.length} vs ${WS.Focus.toolbarLeft.length}/${WS.Focus.toolOrder.length}`);

/* No workspace applied — the shipped bundle is the answer, and the old
   constant is still what it must NOT be. */
await page.evaluate(async () => {
  window.__scStore.setState({ activeWorkspace: null });
  window.__scStore.getState().setToolbarZones(['b:bold'], []);
  await new Promise((r) => setTimeout(r, 200));
});
await runReset('toolbarItems');
const none = await read(['toolbarLeft']);
ok('with no workspace applied it falls through to the shipped ribbon',
  JSON.stringify(none.toolbarLeft) === JSON.stringify(PRESET_VS.toolbarLeft),
  `${none.toolbarLeft.length} items, wanted ${PRESET_VS.toolbarLeft.length}`);
/* The screenshot he sent: a bare Courier Prime / B I U / Action strip. That is
   DEFAULT_TOOLBAR_LEFT, and it is what no reset may produce any more. */
const factory = await page.evaluate(async () => {
  const m = await window.__scImport('/src/components/toolbarBuiltins.ts');
  return m.DEFAULT_TOOLBAR_LEFT;
});
ok('…and never the pre-v7.70 factory strip he was shown',
  JSON.stringify(none.toolbarLeft) !== JSON.stringify(factory),
  `${factory.length} factory items`);

await browser.close();
console.log(`\ncheck-v771: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
