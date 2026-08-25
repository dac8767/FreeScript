/* check-v649 — Derek's Outline header/body rework:
   1 Arrangement label+buttons → the standard View dropdown (Sections/Freeform)
   2 Presets + "+ Add Section" live in the BODY's first row
   3 "Show beat color on all tabs" is gone
   4 the header has Search and Filter (color filter with swatches)
   5 "Show in Outline Bar" sits at the RIGHT edge of the body's first row */
import { launch, boot, seedScript, SCENES_4, settle } from './driver.mjs';

const { browser, page } = await launch({ width: 1500, height: 950 });
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓', m); } else { fail++; console.log('  ✗ FAIL', m); } };
const W = '.tool-window[data-tool="beatboard"]';

try {
  await boot(page);
  await seedScript(page, SCENES_4);
  await page.evaluate(() => {
    window.__scStore.setState((s) => ({ toolSizes: { ...s.toolSizes, beatboard: { w: 1300, h: 700 } } }));
    const st = window.__scStore.getState();
    st.setToolMode('beatboard', 'floating');
    st.openTool('beatboard');
  });
  await page.waitForSelector(W, { timeout: 8000 });
  await settle(page);

  // ── 1 + 3 + 4: the header cluster is Filter · View · Search (+?), nothing else ──
  const header = await page.evaluate((w) => {
    const win = document.querySelector(w);
    const hc = win?.querySelector('.beat-header-controls');
    return {
      ctlLabels: [...(hc?.querySelectorAll('.tool-ctl .tool-ctl-label') ?? [])].map((el) => el.textContent),
      viewCurrent: hc?.querySelector('[data-ctl="view"]')?.textContent,
      viewIcon: !!hc?.querySelector('[data-ctl="view"] svg'),
      searchBtn: !!hc?.querySelector('[data-ctl="search"], .tool-ctl-search-field'),
      modeCenter: !!document.querySelector('.beat-mode-center'),
      modeBtns: !!document.querySelector('.beat-mode-btn'),
      colorAll: !!document.querySelector('.beat-color-alltabs'),
      help: !!hc?.querySelector('.fs-help-btn'),
    };
  }, W);
  ok(header.ctlLabels.includes('Filter') && !header.ctlLabels.includes('View'), `header has Filter; the View trigger shows only the current view (${JSON.stringify(header.ctlLabels)})`);
  ok(header.viewCurrent === 'Sections' && header.viewIcon, `View trigger reads icon + "${header.viewCurrent}"`);
  ok(header.searchBtn, 'header has the standard search control');
  ok(!header.modeCenter && !header.modeBtns, 'the Arrangement label/buttons are gone');
  ok(!header.colorAll, '"Show beat color on all tabs" is gone');
  ok(header.help, 'the ? help button survives at the end');

  // ── 2 + 5: the body's first row — Presets/Add left, bar checkbox right ──
  const row = await page.evaluate((w) => {
    const win = document.querySelector(w);
    const r = win?.querySelector('.beat-board-actions-row');
    if (!r) return null;
    const rr = r.getBoundingClientRect();
    const preset = r.querySelector('.beat-board-preset')?.getBoundingClientRect();
    const add = r.querySelector('.beat-board-add-col-btn');
    const check = r.querySelector('.beat-bar-check');
    const cr = check?.getBoundingClientRect();
    return {
      hasPreset: !!preset, addLabel: add?.textContent, hasCheck: !!check,
      addLeftOfPreset: !!(add && preset) && add.getBoundingClientRect().right + 8 <= preset.x,
      checkText: check?.textContent, checkbox: !!check?.querySelector('input[type="checkbox"]'),
      presetLeftish: preset ? preset.x - rr.x < 200 : false,
      checkRightGap: cr ? Math.round(rr.right - cr.right) : -1,
      inHeader: !!win?.querySelector('.beat-header-controls .beat-tabs-actions, .beat-header-controls .beat-bar-check'),
    };
  }, W);
  ok(row && row.hasPreset && row.addLabel?.includes('Add Section'), 'Presets + "+ Add Section" render in the body first row');
  ok(row?.presetLeftish, 'Presets/Add hold the row\'s left side');
  // v7.91, Derek: label reworded to "Use this variation in the outline toolbar".
  ok(row?.hasCheck && row.checkbox && row.checkText?.includes('Use this variation in the outline toolbar'), '"Use this variation in the outline toolbar" rides the same row');
  ok(row?.addLeftOfPreset, 'the add button sits far left, before Presets (with air between)');
  ok(row != null && row.checkRightGap >= 0 && row.checkRightGap < 40, `…aligned right (gap to row edge: ${row?.checkRightGap}px)`);
  ok(!row?.inHeader, 'neither lives in the header cluster anymore');

  // ── 1: the View dropdown navigates arrangements ──
  await page.click(`${W} .beat-header-controls [data-ctl="view"]`);
  await settle(page);
  const viewItems = await page.evaluate(() =>
    [...document.querySelectorAll('.tool-ctl-menu .tool-ctl-menu-item')].map((el) => ({
      label: el.textContent.trim(), icon: !!el.querySelector('.tool-ctl-item-icon svg'),
    })));
  ok(viewItems.some((i) => i.label === 'Sections' && i.icon) && viewItems.some((i) => i.label === 'Freeform' && i.icon),
    `View menu = Sections/Freeform, each with an icon (${JSON.stringify(viewItems)})`);
  await page.click('.tool-ctl-menu .tool-ctl-menu-item:has-text("Freeform")');
  await settle(page);
  const mode1 = await page.evaluate(() => window.__scStore.getState().beatArrangeMode);
  ok(mode1 === 'custom', `picking Freeform jumps to a Freeform tab (mode=${mode1})`);
  await page.click(`${W} .beat-header-controls [data-ctl="view"]`);
  await page.click('.tool-ctl-menu .tool-ctl-menu-item:has-text("Sections")');
  await settle(page);
  ok(await page.evaluate(() => window.__scStore.getState().beatArrangeMode) === 'auto', 'and back to Sections');

  // ── 4a: the color filter hides cards (before the search test — the
  // collapsing search field shifts the cluster's layout mid-click) ──
  await page.evaluate(() => {
    const st = window.__scStore.getState();
    const colId = st.addBeatColumn('Act I');
    st.addBeat('Alpha moment', colId);
    st.addBeat('Beta reversal', colId);
    const beats = window.__scStore.getState().beats;
    st.updateBeat(beats[beats.length - 1].id, { color: '#ef4444' });
  });
  await settle(page);
  const before = await page.evaluate((w) => document.querySelectorAll(`${w} .beat-column-cards .beat-card`).length, W);
  await page.click(`${W} .beat-header-controls .tool-ctl:has(.tool-ctl-label:text-is("Filter"))`);
  await settle(page);
  const filterItems = await page.evaluate(() =>
    [...document.querySelectorAll('.tool-ctl-menu .tool-ctl-menu-item')].map((el) => ({
      label: el.textContent.trim(), swatch: !!el.querySelector('.tool-ctl-swatch'),
    })));
  ok(filterItems.some((i) => i.label === 'Red' && i.swatch), `Filter lists the colors in use, with swatches (${JSON.stringify(filterItems.map((i) => i.label))})`);
  await page.click('.tool-ctl-menu .tool-ctl-menu-item:text-is("Red")');
  await settle(page);
  const afterFilter = await page.evaluate((w) => document.querySelectorAll(`${w} .beat-column-cards .beat-card`).length, W);
  ok(before === 2 && afterFilter === 1, `the Red filter hides other beats (${before} → ${afterFilter})`);
  await page.keyboard.press('Escape');
  await settle(page);
  await page.click(`${W} .beat-header-controls .tool-ctl:has(.tool-ctl-label:text-is("Filter"))`);
  await page.click('.tool-ctl-menu .tool-ctl-menu-item:text-is("All colors")');
  await settle(page);
  ok(await page.evaluate((w) => document.querySelectorAll(`${w} .beat-column-cards .beat-card`).length, W) === 2, '"All colors" restores everything');

  // ── 4b: search narrows the board + the count reads M of N ──
  await page.click(`${W} .beat-header-controls .tool-ctl-search-btn`).catch(() => null);
  await page.fill(`${W} .beat-header-controls .tool-ctl-search-field input`, 'alpha');
  await settle(page);
  const afterSearch = await page.evaluate((w) => ({
    cards: document.querySelectorAll(`${w} .beat-column-cards .beat-card`).length,
    info: document.querySelector(`${w} .beat-board-info`)?.textContent,
  }), W);
  ok(afterSearch.cards === 1, `search narrows the board (2 → ${afterSearch.cards})`);
  ok(/1 of 2 beats/.test(afterSearch.info || ''), `count reads "${afterSearch.info}"`);
} catch (e) {
  console.log('PROBE ERROR:', e.message);
  fail++;
} finally { await browser.close(); }
console.log(`\ncheck-v649: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
