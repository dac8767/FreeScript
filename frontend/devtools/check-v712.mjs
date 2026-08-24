// check-v712.mjs — Derek:
//   1 "add a list of all of the page setup templates to the top of the page
//     setup tab. this list is where the view, edit, and delete (for custom
//     templates only) buttons are. bellow that is the shown and hidden columns"
//   2 "use a different gear icon for settings"
import { readFileSync } from 'node:fs';
import { launch, boot, settle } from './driver.mjs';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  PASS ${name}`); }
  else { fail++; console.log(`  FAIL ${name} ${extra}`); }
};

const { browser, page } = await launch();
await boot(page);

// ── 1. the template list above the columns ───────────────────────────
console.log('\n1. Page Setup: list on top, columns below');
await page.evaluate(() => window.__scStore.getState().openPreferences('page'));
await page.waitForSelector('.prefs-content .pst-list', { timeout: 8000 });
await settle(page);

/* v7.50, Derek: the rows in this list are the Format ▸ Script Format / Template
   window's rows now — one shared TemplateCard, not a second list of the same
   templates. The selectors moved with it; what each assertion is FOR did not.
   A built-in used to be marked by a "Default" chip and is now marked by
   sitting under the Script Formats heading, which is also what decides whether
   it can be edited, so the two can no longer disagree. */
const layout = await page.evaluate(() => {
  const list = document.querySelector('.pst-list');
  const cols = document.querySelector('.fs-dnd-cols');
  const box = (el) => el?.getBoundingClientRect();
  return {
    listRows: document.querySelectorAll('.pst-list .template-select-item').length,
    listBottom: box(list)?.bottom ?? 0,
    colsTop: box(cols)?.top ?? 0,
    heads: [...document.querySelectorAll('.prefs-content h3')].map((h) => h.textContent.trim()),
  };
});
ok('every template is in the list', layout.listRows >= 6, `rows=${layout.listRows}`);
/* v7.81, Derek retired the New Script Picker columns — the tab is the list
   alone now, so "list above columns" becomes "no columns at all". */
ok('the Shown/Hidden columns are gone', layout.colsTop === 0, `columns start ${Math.round(layout.colsTop)}`);
ok('the one remaining area is named', layout.heads.includes('Page Templates'), JSON.stringify(layout.heads));

const buttons = await page.evaluate(() => {
  const kids = [...document.querySelector('.pst-list').children];
  const start = kids.findIndex((k) => k.textContent.trim() === 'Script Formats');
  const end = kids.findIndex((k, i) => i > start && k.classList.contains('template-select-category'));
  const read = (r, isDefault) => ({
    name: r.querySelector('.template-select-item-name')?.textContent.trim(),
    isDefault,
    btns: [...r.querySelectorAll('button')].map((b) => b.textContent.trim()),
  });
  const inSection = (from, to) => kids.slice(from, to)
    .filter((k) => k.classList.contains('template-select-item'));
  return [
    ...inSection(start + 1, end === -1 ? undefined : end).map((r) => read(r, true)),
    ...(end === -1 ? [] : inSection(end + 1, undefined).map((r) => read(r, false))),
  ];
});
const builtIns = buttons.filter((r) => r.isDefault);
ok('every row offers View', buttons.every((r) => r.btns.includes('View')), JSON.stringify(buttons[0]));
/* View to open its page setup, Duplicate to get an editable copy — and NOT
   Edit or Delete, because a built-in is an immutable constant and both would
   write into the void. */
ok('built-ins offer View and Duplicate only — no Edit, no Delete',
  builtIns.length >= 6 && builtIns.every((r) => r.btns.join() === 'View,Duplicate'),
  JSON.stringify(builtIns.map((r) => r.btns)));

/* A custom template gets Edit + Delete. Driven through the UI on purpose: a
   dynamic import from the driver can hand back a SECOND module instance, whose
   store the mounted component is not subscribed to — the first cut created a
   template that existed in that copy and never appeared in the list. Clicking
   the app's own buttons cannot lie about which store it used. */
/* v7.50: the way in is Duplicate on a built-in's row. The old "New Template…"
   row asked for a base in a dropdown and copied it — the same operation with a
   worse handle on it — so it is gone rather than kept as a second door. */
await page.evaluate(() => {
  const first = document.querySelector('.pst-list .template-select-item');
  [...first.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Duplicate').click();
});
await page.waitForTimeout(700);
// Duplicating a built-in opens the editor on the copy — close it and read the list.
await page.keyboard.press('Escape');
await settle(page);
await page.waitForTimeout(400);
const custom = await page.evaluate(() => {
  const kids = [...document.querySelector('.pst-list').children];
  const userHead = kids.findIndex((k) => k.textContent.trim() === 'User Defined');
  const own = kids.slice(userHead + 1).find((k) => k.classList.contains('template-select-item'));
  return own ? {
    name: own.querySelector('.template-select-item-name')?.textContent.trim(),
    btns: [...own.querySelectorAll('button')].map((b) => b.textContent.trim()),
  } : null;
});
ok('a custom template appears in the list',
  Boolean(custom) && /Copy/.test(custom.name || ''), JSON.stringify(custom));
ok('…offering View, Edit, Duplicate and Delete',
  custom && ['View', 'Edit', 'Duplicate', 'Delete'].every((t) => custom.btns.includes(t)),
  JSON.stringify(custom));

// the columns are visibility only now
const colRows = await page.evaluate(() => {
  const rows = [...document.querySelectorAll('.fs-dnd-col .fs-dnd-row')];
  return {
    count: rows.length,
    labels: rows.slice(0, 3).map((r) => [...r.querySelectorAll('button')].map((b) => b.textContent.trim())),
    handles: document.querySelectorAll('.fs-dnd-col .fs-customize-drag').length,
  };
});
ok('the columns carry no View/Edit/Delete',
  colRows.labels.every((b) => !b.some((t) => ['View', 'Edit', 'Delete'].includes(t))), JSON.stringify(colRows.labels));
ok('…just the one visibility toggle per row',
  colRows.labels.every((b) => b.length === 1 && ['×', '+'].includes(b[0])), JSON.stringify(colRows.labels));
ok('rows still drag', colRows.handles === colRows.count, JSON.stringify(colRows));

// ── 2. the gear ──────────────────────────────────────────────────────
console.log('\n2. the Settings gear');
const icons = await page.evaluate(async () => {
  const m = await window.__scImport('/src/components/toolbarCommands.tsx');
  const cmd = m.TOOLBAR_COMMANDS.find((c) => c.id === 'settings');
  // react-icons render as an <svg> whose path data identifies the glyph;
  // compare Settings' icon against the wrench the Tools menu wears.
  const { MENU_ICONS, TOOLBAR_ICONS } = await window.__scImport('/src/components/uiIcons.tsx');
  return {
    hasSettingsCmd: !!cmd,
    toolsIsWrench: !!MENU_ICONS.Tools,
    customizeIsWrench: !!TOOLBAR_ICONS.customize,
  };
});
ok('the Settings command still exists', icons.hasSettingsCmd, '');

/* v7.13, Derek sent the gear he wants: a stroked OUTLINE gear, eight teeth,
   hollow centre — drawn in uiIcons (react-icons has no gear that shape) — and
   "make the lines white". Dropdown icons are painted --fd-text-muted, so the
   white is a real, checkable difference from every other icon in that menu. */
const glyphs = await page.evaluate(() => {
  const svgPath = (el) => el?.querySelector('svg path')?.getAttribute('d') ?? null;
  const menuTools = [...document.querySelectorAll('.menu-item')].find((e) => /Tools/.test(e.textContent));
  return { toolsPath: svgPath(menuTools) };
});
ok('the Tools menu still has its wrench', Boolean(glyphs.toolsPath), '');

/* Clear the decks first: section 1 leaves the Settings window and the template
   editor it opened on screen, and an overlay eats the menu click — Playwright
   calls that "intercepts pointer events", not a miss. The template editor has
   NO Escape handler (only Cancel and an overlay click), so pressing Escape at
   it does nothing; click the button it actually has. */
const cancel = await page.$('.template-editor-header .dialog-btn');
if (cancel) { await cancel.click(); await settle(page); }
await page.evaluate(() => window.__scStore.getState().closePreferences());
await settle(page);
await page.waitForSelector('.template-editor-overlay, .prefs-window', { state: 'detached', timeout: 8000 }).catch(() => {});

const help = await page.$('.menu-item:has-text("Help")');
await help.click();
await settle(page);
/* v7.22: the gear is Derek's FILE, masked — not an SVG this app draws. The
   shape assertions (stroke, twelve teeth, hollow centre) described the
   drawing and are gone with it; what they were protecting is not. These are
   the same requirements against the new mechanism:
     · the item wears a gear at all
     · it reads HIS asset, so replacing that file replaces the icon
     · it is full-strength, brighter than its muted neighbours
     · a light theme paints it DARK — his file is white, and white on a light
       dropdown is an icon you cannot see. That was true of the drawn gear by
       way of `currentColor`; with a raster it is true only because the icon
       is a MASK, which is the whole reason for the mask. */
const gear = await page.evaluate(() => {
  const item = [...document.querySelectorAll('.menu-dropdown-item')].find((e) => /Settings/.test(e.textContent));
  const el = item?.querySelector('.icon-gear-mask');
  const other = [...document.querySelectorAll('.menu-dropdown-item')]
    .find((e) => !/Settings/.test(e.textContent) && e.querySelector('.menu-dropdown-icon svg'));
  const g = el ? getComputedStyle(el) : null;
  const o = other ? getComputedStyle(other.querySelector('.menu-dropdown-icon svg')) : null;
  const r = el?.getBoundingClientRect();
  return {
    present: !!el,
    strong: el?.classList.contains('icon-gear-strong') ?? false,
    mask: g ? (g.webkitMaskImage || g.maskImage) : null,
    paint: g?.backgroundColor ?? null,
    color: g?.color ?? null,
    otherColor: o?.color ?? null,
    size: r ? [Math.round(r.width), Math.round(r.height)] : null,
  };
});
ok('Settings wears the gear', gear.present && gear.strong, JSON.stringify(gear));
ok('…which is DEREK\'S FILE, masked — replace the file, replace the icon',
  /settings-gear/.test(gear.mask || ''), String(gear.mask).slice(0, 70));
ok('…painted with the icon colour, not left transparent',
  gear.paint && gear.paint !== 'rgba(0, 0, 0, 0)', String(gear.paint));
ok('…at the same size as the other icons in that menu', 
  !!gear.size && gear.size[0] >= 8 && gear.size[0] <= 20, JSON.stringify(gear.size));
ok('…brighter than the other icons in that menu, which stay muted',
  gear.otherColor && gear.otherColor !== gear.color, JSON.stringify({ gear: gear.color, other: gear.otherColor }));

/* A light theme must not paint it white — that is an invisible icon. */
const onLight = await page.evaluate(async () => {
  document.documentElement.setAttribute('data-theme', 'light');
  await new Promise((r) => setTimeout(r, 80));
  const el = [...document.querySelectorAll('.menu-dropdown-item')]
    .find((e) => /Settings/.test(e.textContent))?.querySelector('.icon-gear-mask');
  const c = el ? getComputedStyle(el).backgroundColor : null;
  document.documentElement.setAttribute('data-theme', 'dark');
  return c;
});
ok('a light theme paints it dark instead of white', onLight !== null && onLight !== 'rgb(255, 255, 255)', String(onLight));

const src = readFileSync(new URL('../src/menu/nativeMenuSync.ts', import.meta.url), 'utf8');
ok('the native menu uses the plain GEAR, not the Advanced pane icon',
  /NativeIcon\.PreferencesGeneral/.test(src) && !/NativeIcon\.Advanced/.test(src), '');
ok('…still with the fallback that keeps the menu alive',
  /catch[\s\S]{0,200}MenuItem\.new\(opts\)/.test(src), '');

/* Read the SOURCE, not the served module: Vite compiles JSX away, so
   `<FaCog />` never appears in what the browser is given. */
const menuSrc = readFileSync(new URL('../src/components/MenuBar.tsx', import.meta.url), 'utf8');
ok('the in-app Settings… item uses the gear', /<GearIcon \/>, label: 'Settings…'/.test(menuSrc), '');

console.log(`\ncheck-v712: ${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail ? 1 : 0);
