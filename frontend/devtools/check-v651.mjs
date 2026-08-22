/* check-v651 — Derek: "recheck the entire app for helper text that is not
   an option in the helper text window. I've found many."
   1 dynamic (ternary) tooltips are LISTED — his example, the outline bar
     checkbox hover, is searchable in the Helper Text window
   2 editing one takes effect on the LIVE control (the DOM applier keys any
     attribute by its default string, dynamic or not)
   3 the applier follows a dynamic title to its OTHER arm instead of
     painting the stale arm's override over it (the v6.51 applier fix)
   4 the Outline ? popover body now rides ht() and is editable too */
import { launch, boot, seedScript, SCENES_4, settle, showAllHelperText } from './driver.mjs';

const { browser, page } = await launch({ width: 1500, height: 950 });
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓', m); } else { fail++; console.log('  ✗ FAIL', m); } };
const W = '.tool-window[data-tool="beatboard"]';
/* v7.76: both arms and the ? body are Derek's rewrites now — his helper-text
   pass shortened all three, and v7.76 baked them into the source. The check is
   about the MECHANISM (a dynamic tooltip is listed, overridable per arm, and
   swaps live), so what has to follow his wording is the default string it keys
   on: an override keyed to text no element carries can never match. */
const CHECKED_ARM = 'The Outline Bar shows this tab';
const UNCHECKED_ARM = 'Show this tab in the Outline Bar';

try {
  await boot(page);
  /* v7.70: the shipped defaults are Derek's preset, and he has ~200 helper
     strings hidden. This window filters those out, so every count and lookup
     below was reading his housekeeping instead of the app's. */
  await showAllHelperText(page);
  await seedScript(page, SCENES_4);
  await page.evaluate(() => {
    window.__scStore.setState((s) => ({ toolSizes: { ...s.toolSizes, beatboard: { w: 1300, h: 700 } } }));
    const st = window.__scStore.getState();
    st.setToolMode('beatboard', 'floating');
    st.openTool('beatboard');
  });
  await page.waitForSelector(`${W} .beat-bar-check`, { timeout: 8000 });
  await settle(page);

  // ── 2: overriding the checked-arm default swaps the LIVE title ──
  const t0 = await page.evaluate((w) => document.querySelector(`${w} .beat-bar-check`)?.getAttribute('title'), W);
  ok(t0 === CHECKED_ARM, `single tab: checkbox carries the checked-arm default (${JSON.stringify(t0?.slice(0, 40))}…)`);
  await page.evaluate((arm) => window.__scStore.getState().setHelperTextOverride(arm, 'CUSTOM CHECKED TIP'), CHECKED_ARM);
  await settle(page);
  const t1 = await page.evaluate((w) => document.querySelector(`${w} .beat-bar-check`)?.getAttribute('title'), W);
  ok(t1 === 'CUSTOM CHECKED TIP', `editing the dynamic tooltip changes the live control (${JSON.stringify(t1)})`);

  // ── 3: the OTHER arm is not polluted by the stale override ──
  await page.click(`${W} .tool-chrome-tabs:not(.tool-chrome-tabs-measure) .beat-tab-add`);
  await settle(page);
  const t2 = await page.evaluate((w) => document.querySelector(`${w} .beat-bar-check`)?.getAttribute('title'), W);
  ok(t2 === UNCHECKED_ARM, `flipping to the unchecked arm shows ITS default, not the stale override (${JSON.stringify(t2?.slice(0, 40))})`);
  await page.evaluate((arm) => window.__scStore.getState().setHelperTextOverride(arm, 'CUSTOM UNCHECKED TIP'), UNCHECKED_ARM);
  await settle(page);
  const t3 = await page.evaluate((w) => document.querySelector(`${w} .beat-bar-check`)?.getAttribute('title'), W);
  ok(t3 === 'CUSTOM UNCHECKED TIP', 'the other arm takes its own override');
  // back to the first arm — its override re-applies
  await page.click(`${W} .beat-bar-check input`);
  await settle(page);
  const t4 = await page.evaluate((w) => document.querySelector(`${w} .beat-bar-check`)?.getAttribute('title'), W);
  ok(t4 === 'CUSTOM CHECKED TIP', 'flipping back re-applies the first arm\'s override');

  // ── 4: the ? popover body rides ht() ──
  await page.evaluate(() => window.__scStore.getState().setHelperTextOverride(
    'Create sections (Act 1, Act 2…) and drop beats into them. Create manually or pick a Preset.',
    'MY OWN OUTLINE HELP'));
  await page.click(`${W} .fs-help-btn`);
  await settle(page);
  const helpBody = await page.evaluate(() => document.querySelector('.fs-help-pop')?.textContent?.trim());
  ok(helpBody === 'MY OWN OUTLINE HELP', `the ? popover body is editable (${JSON.stringify(helpBody)})`);
  await page.keyboard.press('Escape');

  // ── 1: the Helper Text window LISTS the dynamic tooltip ──
  await page.evaluate(() => window.__scStore.getState().setHelperTextWindowOpen(true));
  await page.waitForSelector('.htw-panel .dz-search-input', { timeout: 8000 });
  await page.fill('.htw-panel .dz-search-input', 'The Outline Bar shows this tab');
  await settle(page);
  const listed = await page.evaluate((arm) => document.querySelector('.htw-panel .dz-body')?.textContent?.includes(arm), CHECKED_ARM);
  ok(listed, 'the Helper Text window lists the checkbox\'s hover text (Derek\'s example)');
  await page.fill('.htw-panel .dz-search-input', 'Switch to this theme');
  await settle(page);
  const listed2 = await page.evaluate(() => document.querySelector('.htw-panel .dz-body')?.textContent?.includes('Switch to this theme'));
  ok(listed2, 'other dynamic tooltips (Customize theme rows) are listed too');

  // cleanup so nothing persists into other checks
  await page.evaluate((arms) => {
    const st = window.__scStore.getState();
    for (const a of arms) st.setHelperTextOverride(a, null);
  }, [CHECKED_ARM, UNCHECKED_ARM]);
} catch (e) {
  console.log('PROBE ERROR:', e.message);
  fail++;
} finally { await browser.close(); }
console.log(`\ncheck-v651: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
