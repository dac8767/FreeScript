// devtools/check-v566.mjs — the Focus "?" rides the window header (popover
// works from there), and the new Focus Design knobs actually move the panel
// (no dead sliders): side padding, section spacing, indent.
import { launch, boot, seedScript, openTool, SCENES_4, settle, tokenDefault } from './driver.mjs';
const SHOTS = '/tmp/claude-0/-home-user-ScriptCraft/e4449e3e-5198-5997-9e57-bd93d663743c/scratchpad';
let pass = 0, fail = 0;
const ok = (cond, label) => {
  if (cond) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; console.log(`  ✗ FAIL: ${label}`); }
};
const { browser, page } = await launch();
await boot(page);
await seedScript(page, SCENES_4);
await openTool(page, 'Focus');
await page.waitForSelector('.fs-typewriter', { timeout: 8000 });

const seat = await page.evaluate(() => ({
  inHeader: !!document.querySelector('.tool-chrome-controls .fs-help-btn'),
  inBody: !!document.querySelector('.fs-typewriter .fs-help-btn'),
}));
ok(seat.inHeader && !seat.inBody, 'the ? sits in the window header, not the master row');
await page.click('.tool-chrome-controls .fs-help-btn');
await page.waitForSelector('.fs-help-pop', { timeout: 4000 });
ok(true, 'the help popover opens from the header');
await page.keyboard.press('Escape');
await page.waitForSelector('.fs-help-pop', { state: 'detached', timeout: 4000 });
ok(true, 'Escape closes it');

// the knobs are LIVE (the no-dead-knob contract, proven in the DOM)
const before = await page.evaluate(() => {
  const tw = getComputedStyle(document.querySelector('.fs-typewriter'));
  const sub = getComputedStyle(document.querySelector('.fs-typewriter-subgroup'));
  return { pad: tw.paddingLeft, secTop: sub.marginTop, indent: sub.paddingLeft };
});
await page.evaluate(() => {
  const s = window.__scStore.getState();
  s.setDesignVar('focusPad', 24);
  s.setDesignVar('focusSectionGap', 30);
  s.setDesignVar('focusIndent', 36);
});
await settle(page);
const after = await page.evaluate(() => {
  const tw = getComputedStyle(document.querySelector('.fs-typewriter'));
  const sub = getComputedStyle(document.querySelector('.fs-typewriter-subgroup'));
  return { pad: tw.paddingLeft, secTop: sub.marginTop, indent: sub.paddingLeft };
});
/* The claim is that the knob is LIVE — turn it and the DOM moves. So it is
   the AFTER value that has to be exact, and BEFORE only has to be different.
   v7.70: these three named the built-in defaults (12/6/14px), which stopped
   being what the app starts on the moment Derek's own Design values became the
   shipped defaults — 29px of side padding, not 12. Requiring "before" to be a
   particular number was asking about the default, which is not what this
   check is for, and it hid the real question behind an unrelated one. */
ok(before.pad !== after.pad && after.pad === '24px',
  `Side padding knob drives the panel (${before.pad} → ${after.pad})`);
ok(before.secTop !== after.secTop && after.secTop === '30px',
  `Section spacing knob drives the subgroups (${before.secTop} → ${after.secTop})`);
ok(before.indent !== after.indent && after.indent === '36px',
  `Sub-option indent knob drives the nesting (${before.indent} → ${after.indent})`);
await page.screenshot({ path: `${SHOTS}/v566-focus.png` });
await page.evaluate(() => {
  const s = window.__scStore.getState();
  s.resetDesignVar('focusPad'); s.resetDesignVar('focusSectionGap'); s.resetDesignVar('focusIndent');
});
await settle(page);
/* v7.76: was pinned to '12px' — the built-in default as it stood before Derek's
   Design values became the defaults (it is 29 now). The comment above had
   already stopped requiring BEFORE to be a particular number for exactly this
   reason and then left this line naming one.
   Two halves, so it cannot pass by accident: reset must land back on precisely
   what the panel showed before anything was touched, AND that must be the
   token's own shipped default rather than some third number. */
const resetPad = await page.evaluate(() => getComputedStyle(document.querySelector('.fs-typewriter')).paddingLeft);
ok(resetPad === before.pad, `reset returns the panel to where it started (${before.pad} → ${resetPad})`);
ok(resetPad === `${tokenDefault('focusPad')}px`,
  `…and that is the shipped default (${tokenDefault('focusPad')}px)`);

// the Design window lists the group
await page.evaluate(() => window.__scStore.getState().openTool('design'));
await page.waitForTimeout(600);
ok(await page.evaluate(() => document.body.textContent.includes('Focus Tool')),
  'the Design window carries a Focus Tool group');

console.log(`\n${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail ? 1 : 0);
