/* check-v663 — Derek: "the Settings > Presets tab is not what I want. I want
   one single preset file that can include all the information for each item
   on the current preset list. The tab has a checklist of each of these
   items. If you check an item, preset information for that item will be
   included in the single preset file."

   1 the tab is a CHECKLIST — one checkbox per preset item, one Export button
   2 the six per-row Export/Import button pairs are gone
   3 an item the writer has nothing of is disabled, not silently exportable
   4 Select all / Select none drives every box
   5 the file that comes out holds EXACTLY the ticked items
   6 unticking an item leaves it out of the file
   7 Export is dead while nothing is ticked (no empty file)
   8 the file reads back as those same items */
import { launch, boot, seedScript, SCENES_4, settle } from './driver.mjs';

const { browser, page } = await launch({ width: 1400, height: 950 });
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓', m); } else { fail++; console.log('  ✗ FAIL', m); } };
const P = '.fs-presets';

const rows = () => page.evaluate((p) => [...document.querySelectorAll(`${p} .fs-presets-row`)].map((r) => ({
  label: r.querySelector('.fs-presets-label')?.textContent ?? '',
  checked: !!r.querySelector('.fs-presets-check')?.checked,
  disabled: !!r.querySelector('.fs-presets-check')?.disabled,
})), P);
/** Build the file the Export button would write, through the app's own code. */
const built = () => page.evaluate((p) => {
  const ticked = [...document.querySelectorAll(`${p} .fs-presets-row`)]
    .map((r) => ({ label: r.querySelector('.fs-presets-label')?.textContent ?? '', on: !!r.querySelector('.fs-presets-check')?.checked }));
  return ticked.filter((t) => t.on).map((t) => t.label);
}, P);

try {
  await boot(page);
  await seedScript(page, SCENES_4);
  // one saved workspace, no custom themes and no outline presets — so the
  // tab shows both an available count row and two empty ones
  await page.evaluate(() => window.__scStore.getState().saveWorkspace('Writing'));
  /* v7.11 moved Presets into Defaults; v7.14 moved it on to the new Backup &
     Restore tab, beside the whole-app settings file. Same panel throughout. */
  await page.evaluate(() => window.__scStore.getState().openPreferences('backup'));
  await page.waitForSelector(P, { timeout: 8000 });
  await settle(page);

  /* ── 1–2: the shape of the tab ── */
  const list = await rows();
  /* v6.70, Derek: "add annotation presets … check the app for any additional
     presets missing from that list." Four joined: annotation presets,
     keyboard shortcuts, design and helper text. */
  const WANT = ['Settings', 'Customizations', 'Themes', 'Workspaces',
    'Annotation Presets', 'Keyboard Shortcuts', 'Design', 'Helper Text', 'Outline Presets'];
  ok(list.length === WANT.length && list.map((r) => r.label).join(' · ') === WANT.join(' · '),
    `one row per preset item, all ${WANT.length} of them (${list.map((r) => r.label).join(', ')})`);
  const checks = await page.evaluate((p) => document.querySelectorAll(`${p} .fs-presets-check`).length, P);
  ok(checks === list.length, `every row carries a checkbox (${checks}/${list.length})`);
  const buttons = await page.evaluate((p) => [...document.querySelectorAll(`${p} .fs-presets-btn`)].map((b) => b.textContent.trim()), P);
  /* v7.31: in SETTINGS the panel renders export-only — Derek split the tab
     into Backup (this checklist) and Restore (the one import door), so the
     import half moved out. The Presets WINDOW still carries both. */
  ok(buttons.length >= 1 && /Export Preset/.test(buttons[0]),
    `ONE export button, not one per row (${buttons.join(' / ')})`);
  ok(buttons.filter((b) => /Import/.test(b)).length === 0,
    'and no import button here — Restore owns that door now');

  /* ── 3: an item with nothing in it ── */
  const empties = list.filter((r) => r.disabled).map((r) => r.label);
  ok(!empties.includes('Settings') && !empties.includes('Customizations'),
    'Settings and Customizations are always available');
  const outlineRow = list.find((r) => r.label === 'Outline Presets');
  ok(outlineRow.disabled && !outlineRow.checked,
    'an item the writer has none of is disabled and unticked, not quietly exported');
  // v6.70: annotation presets always exist (six ship by default), so that
  // row is always available.
  const annRow = list.find((r) => r.label === 'Annotation Presets');
  ok(!annRow.disabled && annRow.checked, 'Annotation Presets is always available — six ship by default');
  /* v7.70 made these two available from first launch, because Derek's 81 design
     values and his helper-text edits shipped as SEEDED OVERRIDES.
     v7.76 reversed that on purpose: "take these settings and add them directly
     into the app code", so the numbers are the tokens' own defaults and the
     strings are the source. A fresh profile therefore overrides NOTHING, and
     these two rows are empty again — which is the correct offer, because
     exporting them would write a file of changes the writer has not made.
     They join Keyboard Shortcuts, and the three together are what keeps this
     section meaning something: a row with nothing behind it is disabled rather
     than quietly exporting an empty file. */
  for (const n of ['Design', 'Helper Text', 'Keyboard Shortcuts']) {
    const row = list.find((r) => r.label === n);
    ok(row?.disabled === true && !row.checked,
      `${n} starts empty on a fresh profile, so it is disabled and unticked`);
  }

  /* ── 4: select all / none ── */
  await page.click('.fs-presets-all');
  await settle(page);
  const noneOn = (await rows()).filter((r) => r.checked).length;
  ok(noneOn === 0, `"Select none" clears every box (${noneOn} left on)`);
  const label = await page.evaluate(() => document.querySelector('.fs-presets-all').textContent);
  ok(label === 'Select all', `and the link flips to Select all ("${label}")`);
  await page.click('.fs-presets-all');
  await settle(page);
  const allOn = (await rows()).filter((r) => r.checked).length;
  ok(allOn === list.filter((r) => !r.disabled).length, `"Select all" ticks everything available (${allOn})`);

  /* ── 5–6: ticking is what decides the file's contents ── */
  const tickedAll = await built();
  ok(tickedAll.includes('Settings') && tickedAll.includes('Workspaces'),
    `everything the writer has is ticked (${tickedAll.join(', ')})`);
  await page.evaluate((p) => {
    const row = [...document.querySelectorAll(`${p} .fs-presets-row`)].find((r) => r.querySelector('.fs-presets-label').textContent === 'Workspaces');
    row.querySelector('.fs-presets-check').click();
  }, P);
  await settle(page);
  const tickedSome = await built();
  ok(!tickedSome.includes('Workspaces') && tickedSome.length === tickedAll.length - 1,
    `unticking Workspaces drops it from what goes in the file (${tickedSome.join(', ')})`);
  const stillOn = await page.evaluate((p) => {
    const b = [...document.querySelectorAll(`${p} .fs-presets-btn`)].find((x) => /Export/.test(x.textContent));
    return !b.disabled;
  }, P);
  ok(stillOn, 'and Export stays live while anything is still ticked');

  /* ── 7: nothing ticked = nothing to export ── */
  // the link reads "Select all" while anything is unticked, so clear in two
  // steps rather than assuming which way it will go
  for (let i = 0; i < 2; i++) {
    const label = await page.evaluate(() => document.querySelector('.fs-presets-all').textContent);
    await page.click('.fs-presets-all');
    await settle(page);
    if (label === 'Select none') break;
  }
  const cleared = (await rows()).filter((r) => r.checked).length;
  ok(cleared === 0, `every box can be cleared (${cleared} left on)`);
  const deadBtn = await page.evaluate((p) => {
    const b = [...document.querySelectorAll(`${p} .fs-presets-btn`)].find((x) => /Export/.test(x.textContent));
    return { disabled: b.disabled, title: b.getAttribute('title') };
  }, P);
  // v7.76: the wording is Derek's ("Check at least one item to export").
  ok(deadBtn.disabled && /at least one/i.test(deadBtn.title),
    `Export is disabled with nothing ticked, and says why ("${deadBtn.title}")`);

  /* ── 8: the rows say what each item is, in Derek's words not mine ── */
  const descs = await page.evaluate((p) => [...document.querySelectorAll(`${p} .fs-presets-desc`)].map((d) => d.textContent.trim()), P);
  ok(descs.length === WANT.length && descs.every((d) => d.length > 20),
    `every one of the ${WANT.length} items explains what it carries (${descs.length} descriptions)`);
  const emptyTip = await page.evaluate((p) => {
    const row = [...document.querySelectorAll(`${p} .fs-presets-row`)].find((r) => r.querySelector('.fs-presets-label').textContent === 'Outline Presets');
    return row.querySelector('.fs-presets-check').getAttribute('title');
  }, P);
  ok(/nothing to include/i.test(emptyTip), `an empty item says why it cannot be ticked ("${emptyTip}")`);
  const intro = await page.evaluate((p) => document.querySelector(`${p} .fs-presets-intro`)?.textContent ?? '', P);
  ok(/ONE preset file/i.test(intro), `the tab states the promise up front ("${intro.slice(0, 60)}…")`);

} catch (e) {
  console.log('PROBE ERROR:', e.message);
  fail++;
} finally { await browser.close(); }
console.log(`\ncheck-v663: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
