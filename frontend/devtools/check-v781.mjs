/* check-v781 — Derek's fifteen-item pass over Settings & Customize.
 *
 * One theme: the explanatory paragraphs go, short imperatives arrive, and two
 * whole features leave (the New Script Picker filter; the Design/Helper Text
 * backup rows). The retired features' absences are asserted where their old
 * checks lived (v642/v663/v711/v712/v750/v758/v765, all updated in the same
 * change); THIS file drives the claims nothing else covers — the new wording
 * is really on screen, in the surface Derek pointed at.
 *
 * Wording is asserted EXACTLY, not by regex fragments: these lines are his,
 * and "roughly his words" is how a helper-text pass drifts back.
 */
import { launch, boot, settle, placeTool } from './driver.mjs';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  PASS ${name}`); }
  else { fail++; console.log(`  FAIL ${name} ${extra}`); }
};

const { browser, page } = await launch({ width: 1500, height: 950 });
await boot(page);
await settle(page);

/* ── 1. Annotations panel: the empty state ──────────────────────────────── */
console.log('\nthe Annotations panel empty state');
await placeTool(page, 'markups', 'right');
await page.evaluate(() => window.__scStore.getState().openTool('markups'));
await page.waitForSelector('.markups-empty', { timeout: 8000 });
const empty = await page.evaluate(() => document.querySelector('.markups-empty')?.textContent?.trim());
ok('reads exactly "No annotations yet."', empty === 'No annotations yet.', JSON.stringify(empty));

/* ── 2. Settings ▸ General/Region: the four removed hints ───────────────── */
console.log('\nthe removed Settings hints are gone');
await page.evaluate(() => window.__scStore.getState().openPreferences('general'));
await page.waitForSelector('.prefs-content', { timeout: 8000 });
await settle(page);
const generalText = await page.evaluate(() => document.querySelector('.prefs-content')?.textContent ?? '');
ok('the tabs-window hint is gone', !/Applies to every window with tabs/.test(generalText), '');
ok('the spell-check hint is gone', !/Misspellings get the red squiggle/.test(generalText), '');
// the Region tab's stored id is 'languages' (renamed on screen in v7.06)
await page.evaluate(() => window.__scStore.getState().openPreferences('languages'));
await settle(page);
const regionText = await page.evaluate(() => document.querySelector('.prefs-content')?.textContent ?? '');
ok('the date-format hint is gone', !/Version autofill, the\s+changelog/.test(regionText), '');
ok('the time-format hint is gone', !/Vomit Draft/.test(regionText), '');
/* The controls those hints described must still be there — a sweep that took
   the SELECT with the sentence would be a different bug wearing this one. */
ok('…while the Date/Time format controls stay',
  /Date format/.test(regionText) && /Time format/.test(regionText), '');

/* ── 3. Backup & Restore: Derek's wording and spacing ───────────────────── */
console.log('\nBackup & Restore reads as he wrote it');
await page.evaluate(() => window.__scStore.getState().openPreferences('backup'));
await page.waitForSelector('.fs-presets', { timeout: 8000 });
await settle(page);
const backup = await page.evaluate(() => {
  const content = document.querySelector('.prefs-content');
  const hints = [...content.querySelectorAll('.prefs-hint')].map((h) => h.textContent.trim().replace(/\s+/g, ' '));
  const intro = document.querySelector('.fs-presets-intro')?.textContent ?? '';
  const allBtn = document.querySelector('.fs-presets-all')?.textContent?.trim();
  /* Alignment is a MEASUREMENT, not a class check: the hint's left edge must
     sit level with its heading's. */
  const h3 = [...content.querySelectorAll('h3')].find((h) => h.textContent.trim() === 'Backup');
  const hint = h3 ? h3.nextElementSibling : null;
  const restoreH3 = [...content.querySelectorAll('h3')].find((h) => h.textContent.trim() === 'Restore');
  const restoreHint = restoreH3 ? restoreH3.nextElementSibling : null;
  const restoreBtn = [...content.querySelectorAll('button')].find((b) => /Restore from a file/.test(b.textContent));
  return {
    hints,
    intro: intro.replace(/Deselect All|Select all/, '').trim(),
    allBtn,
    headLeft: h3?.getBoundingClientRect().left,
    hintLeft: hint?.classList.contains('prefs-hint') ? hint.getBoundingClientRect().left : null,
    restoreHintLeft: restoreHint?.getBoundingClientRect().left,
    restoreHeadLeft: restoreH3?.getBoundingClientRect().left,
    gapAboveIntro: Boolean(document.querySelector('.fs-presets .prefs-gap-row')),
    gapBeforeRestoreBtn: Boolean(restoreBtn?.parentElement?.previousElementSibling?.classList.contains('prefs-gap-row')),
  };
});
ok('the Backup hint is his sentence',
  backup.hints.some((h) => h === "Settings and customizations live in this app's local storage, which isn't shared between installs. Back them up for safe keeping."),
  JSON.stringify(backup.hints[0]));
ok('…and the safety line is his short one',
  backup.hints.some((h) => h === 'Login info, cloud tokens, and device identity are left out of the file for safety.'), '');
ok('…the old "sign in once on the other app" tail is gone',
  !backup.hints.some((h) => /sign in once/.test(h)), '');
ok('the checklist intro is his instruction', backup.intro === 'Check all items you want to include in the backup file:',
  JSON.stringify(backup.intro));
ok('…with an empty row above it', backup.gapAboveIntro === true, '');
ok('the toggle reads Deselect All while everything is ticked', backup.allBtn === 'Deselect All', JSON.stringify(backup.allBtn));
ok('the Backup hint is FLUSH with its heading',
  backup.hintLeft !== null && Math.abs(backup.hintLeft - backup.headLeft) < 1,
  `hint ${backup.hintLeft} vs h3 ${backup.headLeft}`);
ok('…and the Restore hint with its heading',
  Math.abs(backup.restoreHintLeft - backup.restoreHeadLeft) < 1,
  `hint ${backup.restoreHintLeft} vs h3 ${backup.restoreHeadLeft}`);
ok('…with an empty row between the Restore text and its button',
  backup.gapBeforeRestoreBtn === true, '');

/* ── 4. The Customize window: rename, new hints, Element Rules row ──────── */
console.log('\nthe Customize window');
await page.evaluate(() => {
  window.__scStore.getState().setPreferencesOpen?.(false);
  window.dispatchEvent(new CustomEvent('scriptcraft:command', { detail: 'customize' }));
});
await page.waitForSelector('.fs-customize-tabs', { timeout: 8000 });
await settle(page);
const rail = await page.evaluate(() =>
  [...document.querySelectorAll('.fs-customize-tabs .prefs-tab')].map((t) => t.textContent.trim()));
ok('the rail tab says Ribbon Toolbar, matching the Settings sidebar',
  rail.includes('Ribbon Toolbar') && !rail.includes('Toolbar'),
  JSON.stringify(rail));

// Ribbon Toolbar tab: heading + the bottom how-to line
await page.evaluate(() => {
  [...document.querySelectorAll('.fs-customize-tabs .prefs-tab')].find((t) => t.textContent.trim() === 'Ribbon Toolbar')?.click();
});
await settle(page);
const ribbon = await page.evaluate(() => {
  const body = document.querySelector('.fs-customize-body');
  const hint = [...body.querySelectorAll('.fs-customize-hint')].map((h) => h.textContent.trim().replace(/\s+/g, ' '));
  return { h3: [...body.querySelectorAll('h3')].map((h) => h.textContent.trim()), hint };
});
ok('its heading says Ribbon Toolbar', ribbon.h3.includes('Ribbon Toolbar'), JSON.stringify(ribbon.h3));
ok('the how-to line closes the window',
  ribbon.hint.some((h) => h === 'Customize the ribbon toolbar by adding or removing items directly from the bar at the top of the screen. You can create sections, section titles, dividers, and spacers. Icons will appear small when in two-row sections, and large when in single-row sections.'),
  JSON.stringify(ribbon.hint));

// Quick Access: the new hint (his "items appears" shipped as "items appear")
await page.evaluate(() => {
  [...document.querySelectorAll('.fs-customize-tabs .prefs-tab')].find((t) => t.textContent.trim() === 'Quick Access')?.click();
});
await settle(page);
ok('Quick Access carries his hint', await page.evaluate(() =>
  [...document.querySelectorAll('.fs-customize-body .fs-customize-hint')]
    .some((h) => h.textContent.trim().replace(/\s+/g, ' ') === 'Choose which items appear in the toolbar that sits between the menu bar and the ribbon toolbar:')), '');

// Context Menu: the replacement line, and the old paragraph gone
await page.evaluate(() => {
  [...document.querySelectorAll('.fs-customize-tabs .prefs-tab')].find((t) => t.textContent.trim() === 'Context Menu')?.click();
});
await settle(page);
const ctx = await page.evaluate(() => document.querySelector('.fs-customize-body')?.textContent ?? '');
ok('Context Menu opens with his line',
  /Choose what appears in the toolbar that appears when you right-click on the script:/.test(ctx), '');
ok('…and the permanent-items paragraph is gone', !/are permanent,\s*so they aren't listed/.test(ctx), '');

// Themes: both paragraphs gone, the toggle still there
await page.evaluate(() => {
  [...document.querySelectorAll('.fs-customize-tabs .prefs-tab')].find((t) => t.textContent.trim() === 'Themes')?.click();
});
await settle(page);
const themes = await page.evaluate(() => document.querySelector('.fs-customize-body')?.textContent ?? '');
ok('the system-appearance paragraph is gone', !/when macOS does/.test(themes), '');
ok('the click-a-theme paragraph is gone', !/Click a theme to switch to it/.test(themes), '');
ok("…while the Match-the-system checkbox stays", /Match the system/.test(themes), '');

// Editor: element/transition wording, Element Rules row
await page.evaluate(() => {
  [...document.querySelectorAll('.fs-customize-tabs .prefs-tab')].find((t) => t.textContent.trim() === 'Editor')?.click();
});
await settle(page);
const editorTab = await page.evaluate(() => {
  const body = document.querySelector('.fs-customize-body');
  const hints = [...body.querySelectorAll('.fs-customize-hint')].map((h) => h.textContent.trim().replace(/\s+/g, ' '));
  const h3s = [...body.querySelectorAll('h3')].map((h) => h.textContent.trim());
  const headrow = body.querySelector('.fs-sec-headrow');
  const h3 = headrow?.querySelector('h3');
  const toggle = headrow?.querySelector('.fs-sugg-mode');
  const mid = (el) => { const r = el.getBoundingClientRect(); return r.top + r.height / 2; };
  return {
    hints, h3s,
    rules: {
      present: Boolean(headrow && toggle),
      /* "up one row" made concrete: the toggle's vertical centre is level
         with the heading's, not a row beneath it. */
      level: headrow && toggle ? Math.abs(mid(h3) - mid(toggle)) < 8 : false,
      showLabel: toggle?.textContent?.startsWith('Show:') ?? false,
    },
  };
});
ok('the Elements hint is his line',
  editorTab.hints.includes('Choose which elements are shown as options when beginning a new line on the script:'), '');
ok('the Transitions hint is his line (with the missing "in" restored)',
  editorTab.hints.includes('Choose which transitions are shown as options in a Transition element. You can add your own.'), '');
ok('the section is Element Rules, not Element Suggestions',
  editorTab.h3s.includes('Element Rules') && !editorTab.h3s.includes('Element Suggestions'), JSON.stringify(editorTab.h3s));
ok('…with his helper line under it',
  editorTab.hints.includes('Choose which script elements will be suggested after another element:'), '');
ok('the Show toggle sits ON the heading row, Show: before it',
  editorTab.rules.present && editorTab.rules.level && editorTab.rules.showLabel,
  JSON.stringify(editorTab.rules));

/* …and moving the toggle must not have broken it: All Elements hides the
   table, Script-Aware brings it back — the same store switch as before. */
const toggled = await page.evaluate(async () => {
  const btns = () => [...document.querySelectorAll('.fs-sec-headrow .fs-customize-seg button')];
  btns().find((b) => b.textContent === 'All Elements')?.click();
  await new Promise((r) => setTimeout(r, 250));
  const gone = !document.querySelector('.fs-sugg-table');
  btns().find((b) => b.textContent === 'Script-Aware')?.click();
  await new Promise((r) => setTimeout(r, 250));
  const back = Boolean(document.querySelector('.fs-sugg-table'));
  return { gone, back };
});
ok('…and it still switches the table off and on', toggled.gone && toggled.back, JSON.stringify(toggled));

await browser.close();
console.log(`\ncheck-v781: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
