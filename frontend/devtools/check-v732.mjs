/* check-v732 — the giant gap above the first page, and Derek's new gear.
 *
 * A. THE GAP. "there is a new glitch where there is a giant gap above the top
 *    page" — on every saved file, unchanged by resizing, still there when the
 *    file is opened from inside the app. It did not reproduce on a clean
 *    profile, which was the finding that mattered: nothing in the code path
 *    made a gap, so it had to be state. Measured here in the browser, the
 *    ONLY thing between the top of .editor-main's content box and the page is
 *    that element's own padding-top — `--dz-editor-main-pad-top`, the Design
 *    token literally labelled "Space above first page". Its slider stops at
 *    120; applyDesignVars painted whatever number was persisted. designVars
 *    rides in Design presets and settings backups, so a value the panel could
 *    never produce could land there and paint a void with no control able to
 *    undo it.
 *
 *    So the assertions are about REACHABILITY, not just arithmetic: an
 *    out-of-range value paints inside the range, the readout agrees with the
 *    paint, and the reset that clears it actually returns the token's default
 *    (30px when this was written; Derek's 42 since v7.76 — read, not typed).
 *
 * B. THE GEAR. His images/gear3.png, black on transparency, stored white.
 *    Two renderers read the one asset; the assertion is that the in-app icon
 *    is a MASK (so it takes currentColor on light themes too) and that the
 *    mask resolves to a real file rather than a 404 that renders as nothing.
 */
import { readFileSync } from 'node:fs';
import { launch, boot, settle, zoom100, tokenDefault } from './driver.mjs';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  PASS ${name}`); }
  else { fail++; console.log(`  FAIL ${name} ${extra}`); }
};

const { browser, page } = await launch();
await boot(page);
await settle(page);

/* Seed a script so there is a real page to measure against. */
await page.evaluate(() => {
  window.__scEditor.commands.setContent({
    type: 'doc',
    content: [
      { type: 'sceneHeading', content: [{ type: 'text', text: 'INT. ROOM - DAY' }] },
      ...Array.from({ length: 20 }, (_, i) => ({
        type: 'action', content: [{ type: 'text', text: `Action line ${i} with enough words to fill some space.` }],
      })),
    ],
  });
});
await settle(page);

/** Distance from the top of .editor-main's content box to the top of the page. */
const gap = () => page.evaluate(() => {
  const main = document.querySelector('.editor-main');
  const pg = document.querySelector('.page');
  if (!main || !pg) return null;
  return Math.round(pg.getBoundingClientRect().top - main.getBoundingClientRect().top + main.scrollTop);
});

console.log('\nA. the gap above the first page');

/* 100% first — every number below is in px, and the shipped defaults (v7.70)
   carry Derek's 140% zoom. */
await zoom100(page);

/* v7.70 shipped Derek's 42px as a seeded OVERRIDE on top of a built-in 30, so
   there were two numbers to check: what the app paints, and what clearing the
   override falls back to.
   v7.76 collapsed that — his values are the token defaults now and there is no
   override to clear. The 42 is still asserted (that is the half that says his
   settings arrived); what replaces the second claim is that RESET IS A NO-OP
   HERE, because there is nothing to reset from. A fresh profile that quietly
   moved when reset was pressed would mean an override had been seeded after
   all, which is exactly what v7.76 set out to remove. */
const shipped = await gap();
ok(`the shipped default carries his ${tokenDefault('editorMainPadTop')}px`,
  shipped === tokenDefault('editorMainPadTop'), `got ${shipped}`);
await page.evaluate(() => window.__scStore.getState().resetDesignVar('editorMainPadTop'));
await settle(page);
const base = await gap();
ok('…and reset does not move it, because nothing was overriding it',
  base === shipped, `got ${base}, was ${shipped}`);

/* The failure exactly as it reached Derek: a persisted number outside the
   slider's range. setDesignVar is the store door every import ends up at. */
await page.evaluate(() => window.__scStore.getState().setDesignVar('editorMainPadTop', 400));
await settle(page);
const wild = await gap();
const wildVar = await page.evaluate(() =>
  getComputedStyle(document.documentElement).getPropertyValue('--dz-editor-main-pad-top').trim());
ok('an out-of-range value paints at the slider maximum, not verbatim',
  wildVar === '120px' && wild === 120, `var=${wildVar} gap=${wild}`);
ok('…so the void is bounded — 400px never reaches the page', wild < 400, `got ${wild}`);

/* The readout must agree with the paint. A panel showing 400 while the page
   shows 120 is two sources of truth and leaves him dragging a control that
   already reads what he wants. */
const shown = await page.evaluate(async () => {
  // Design is a dockable tool, and its groups collapse — searching is what a
  // person would do, and it renders the row without depending on group state.
  window.__scStore.getState().openTool('design');
  await new Promise((r) => setTimeout(r, 900));
  const search = document.querySelector('.dz-search-input');
  if (!search) return { found: false, why: 'no search box' };
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(search, 'Space above');
  search.dispatchEvent(new Event('input', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 400));
  const row = [...document.querySelectorAll('.dz-row-top')]
    .find((r) => /Space above first page/.test(r.textContent || ''));
  if (!row) return { found: false, why: 'no row' };
  const num = row.querySelector('input[type="number"]');
  const range = row.parentElement?.querySelector('input[type="range"]');
  return { found: true, num: num?.value ?? null, range: range?.value ?? null };
});
ok('the Design window found the "Space above first page" row', shown.found === true, JSON.stringify(shown));
if (shown.found) {
  /* Against the MEASURED gap, not a constant. With the clamp removed the panel
     still read 120 while the page painted 400 — the two-sources-of-truth half
     of this bug, and a hardcoded 120 here passed straight through it. */
  ok('…and its readout equals what the page is actually painting',
    Number(shown.num) === wild && Number(shown.range) === wild,
    `readout ${shown.num}/${shown.range} vs page ${wild}`);
}

/* And the way out actually works. */
await page.evaluate(() => window.__scStore.getState().resetDesignVar('editorMainPadTop'));
await settle(page);
const after = await gap();
/* v7.76: the way out lands on the token's own default — 42 now, not the 30
   this line used to name. This is the assertion the whole check exists for:
   a value no slider can reach still has an undo. */
ok(`resetting it returns the page to the ${tokenDefault('editorMainPadTop')}px default`,
  after === tokenDefault('editorMainPadTop'), `got ${after}`);

console.log('\nB. the Settings gear');

/* The gear lives on Help ▸ Settings… (v6.95 moved it there from File), so the
   menu has to be open for it to exist at all. */
await page.evaluate(() => window.__scStore.getState().closeTool('design'));
await settle(page);
const helpBtn = await page.$('.menu-item:has-text("Help"), .menu-bar-item:has-text("Help")');
if (helpBtn) { await helpBtn.click(); await settle(page); }
else {
  const anyHelp = await page.$$('.menu-bar *');
  for (const el of anyHelp) {
    if ((await el.textContent())?.trim() === 'Help') { await el.click(); await settle(page); break; }
  }
}
await page.waitForSelector('.menu-dropdown', { timeout: 4000 }).catch(() => {});

const gear = await page.evaluate(async () => {
  const el = document.querySelector('.icon-gear-mask');
  if (!el) return { found: false, menuOpen: !!document.querySelector('.menu-dropdown') };
  const cs = getComputedStyle(el);
  const url = (cs.webkitMaskImage || cs.maskImage || '').match(/url\("?([^")]+)"?\)/)?.[1] ?? '';
  let status = 0;
  try { status = (await fetch(url)).status; } catch { status = -1; }
  const r = el.getBoundingClientRect();
  return { found: true, url, status, w: Math.round(r.width), h: Math.round(r.height), bg: cs.backgroundColor };
});
ok('the in-app gear renders', gear.found === true, JSON.stringify(gear));
if (gear.found) {
  // A mask, not an <img> — that is what lets one white file paint dark on the
  // light themes. An <img> here would be the invisible-icon bug again.
  ok('…as a MASK, so it takes currentColor', /settings-gear/.test(gear.url), gear.url);
  ok('…and the mask file actually exists (a 404 masks to nothing)', gear.status === 200, `status ${gear.status}`);
  ok('…at a real size', gear.w > 0 && gear.h > 0, JSON.stringify(gear));
}

/* The asset itself: his alpha, repainted white. Read the PNG's own header
   rather than trusting the file name. */
const png = readFileSync(new URL('../src/assets/settings-gear.png', import.meta.url));
const sig = png.subarray(0, 8).toString('latin1') === '\x89PNG\r\n\x1a\n';
const w = png.readUInt32BE(16), h = png.readUInt32BE(20), colourType = png[25];
ok('the asset is a 512×512 PNG', sig && w === 512 && h === 512, `${w}x${h} sig=${sig}`);
ok('…with an alpha channel — the mask reads alpha, nothing else',
  colourType === 6 || colourType === 4, `colour-type ${colourType}`);

console.log(`\ncheck-v732: ${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail ? 1 : 0);
