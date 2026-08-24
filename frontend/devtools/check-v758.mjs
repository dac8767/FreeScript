/* check-v758 — four suggestions from the feedback queue.
 *
 *   1. "shift the add button right so it is next to the Show all button"
 *   2. "move teh reset buttons so they are each under their respective
 *       section. we do not need the 'Reset ores and continues' button at all"
 *   3. "restructure this so it has the standard Shown and Hidden columns. If
 *       something is moved to the shown column, it appears in the toolbar
 *       above. we no longer need the ability to drag items from this window
 *       directly onto the toolbar"
 *   4. "for these grayed out items, show 'This feature is still in
 *       development' when hovering over them with the cursor"
 *
 * ── 4 is a bug wearing a suggestion's clothes, and the interesting kind.
 *
 * v7.06 already gave those items that tooltip. It had never once been seen,
 * because `.menu-dropdown-item.disabled` carried `pointer-events: none` — the
 * browser delivers no hover to such an element, and a native title tooltip is
 * hover or nothing. So the feature was written, shipped, and silently inert
 * for fifty versions. Nothing in the source looked wrong: the title is right
 * there on the element.
 *
 * Which is why the assertions below refuse to accept `getAttribute('title')`
 * as evidence. That passed the whole time. They check the property that
 * actually decides whether a human ever sees it — that the element is
 * hit-testable — and they check it on the item Derek pointed at.
 *
 * ── 3 is the largest change: the last tab that did not speak the app's own
 * language. Checked by driving the real list and reading the STORE, because
 * the whole claim is "the Shown column is the toolbar" — a column that
 * rendered the right rows while writing nowhere would look identical.
 *
 * ── 1 and 2 are arrangement, so they are measured by position. A button keeps
 * its class, label and handler while sitting in the wrong place.
 */
import { readFileSync } from 'node:fs';
import { launch, boot } from './driver.mjs';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  PASS ${name}`); }
  else { fail++; console.log(`  FAIL ${name} ${extra}`); }
};

const { browser, page } = await launch();
await boot(page);

/* ── 4. the greyed items say why ─────────────────────────────────────────── */
console.log('\na greyed menu item can be hovered, and says why it is grey');
const menu = await page.evaluate(async () => {
  /* v7.69 hid the Production menu ("hide the entire production menu for now")
     behind the Developer toggle, and the greyed items this section is about
     live in it. Turned on here so the mechanism is tested where the items
     actually are, rather than relocated to whichever menu happens to have a
     disabled item on the day. */
  window.__scStore.getState().setShowUnreleasedTools(true);
  await new Promise((r) => setTimeout(r, 400));
  const open = () => [...document.querySelectorAll('.menu-item')]
    .find((m) => m.textContent.trim() === 'Production')?.click();
  open();
  await new Promise((r) => setTimeout(r, 500));
  const items = [...document.querySelectorAll('.menu-dropdown-item')].map((el) => {
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    /* THE test. `title` was always present; what was missing was any way for
       a person to trigger it. An element with pointer-events: none is not the
       hit-test result at its own centre — the browser hands back whatever is
       behind it — so the tooltip can never fire. */
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return {
      label: el.textContent.trim(),
      disabled: el.classList.contains('disabled'),
      title: el.getAttribute('title'),
      pointerEvents: cs.pointerEvents,
      hoverable: Boolean(hit) && (el === hit || el.contains(hit)),
    };
  });
  return { items };
});
const greyed = menu.items.filter((i) => i.disabled);
ok('the Production menu really is showing greyed items',
  greyed.length >= 2, JSON.stringify(menu.items.map((i) => i.label)));
/* The assertion that would have caught v7.06 shipping inert. */
ok('…every one of them is hit-testable, so a hover can reach it',
  greyed.every((i) => i.pointerEvents !== 'none' && i.hoverable),
  JSON.stringify(greyed));
ok('…and every one of them carries an explanation',
  greyed.every((i) => i.title && i.title.length > 0), JSON.stringify(greyed));
/* Derek's words, on the items he pointed at. */
ok('…the unbuilt ones say they are still in development',
  greyed.filter((i) => /Revision Mode|Production Tags/.test(i.label))
    .every((i) => i.title === 'This feature is still in development.'),
  JSON.stringify(greyed.map((i) => [i.label, i.title])));
/* NOT a blanket sentence. Lock Scene Numbers is greyed because scene numbers
   are off — a switch two menus away. Telling the reader it is unbuilt would
   send them away from something they can fix in one click, so the wrong
   tooltip here is worse than none. */
const lock = greyed.find((i) => /Lock Scene Numbers/.test(i.label));
ok('…and one greyed for a fixable reason says what to fix instead',
  Boolean(lock) && /scene numbers on/i.test(lock.title || '')
    && !/development/i.test(lock.title || ''), JSON.stringify(lock));

/* Clicking a disabled item must do nothing AT ALL. With hover restored the
   click now arrives at the handler, and closing the menu on it would snatch
   the explanation away exactly when the reader went to read it. */
const clicked = await page.evaluate(async () => {
  const el = [...document.querySelectorAll('.menu-dropdown-item.disabled')][0];
  el?.click();
  await new Promise((r) => setTimeout(r, 300));
  return { stillOpen: Boolean(document.querySelector('.menu-dropdown-item')) };
});
ok('clicking one does nothing — the menu stays open with its explanation',
  clicked.stillOpen === true, JSON.stringify(clicked));

/* And it is LISTED, so it can be reworded like every other piece of helper
   text — Derek's standing rule. None of the menu tooltips ever were: the
   harvester read JSX `title=` attributes and these are handed over as data. */
const catalog = JSON.parse(readFileSync(new URL('../src/data/helperTextCatalog.json', import.meta.url), 'utf8'));
const texts = new Set(catalog.map((c) => c.text));
ok('the Helper Text window lists them',
  texts.has('This feature is still in development.'), '');
// v7.76: Derek's helper-text pass shortened this one; the claim is that a
// menu item's DATA-supplied reason reaches the catalog at all, not its wording.
ok('…including the state one', texts.has('Turn scene numbers on first'), '');
/* The harvest rule must be exact, not broad. `tooltip:` was chosen over
   `title:` because on a data object `title` usually means a HEADING — and the
   sibling-label test keeps the Helper Text window's own kind-label map
   ({ tooltip: 'Hover' }) from listing the word "Hover" as helper text. */
ok('…and it did not sweep up the window\'s own kind labels',
  !texts.has('Hover'), '');

await page.evaluate(() => document.body.click());

/* ── 1. the adder sits with the other header buttons ─────────────────────── */
console.log('\nthe + Add sits beside Show All, not stranded mid-header');
const heads = [];
for (const [cat, title] of [['qat', 'Shown'], ['panels', 'Left Panel'], ['elements', 'Shown']]) {
  const r = await page.evaluate(async ([c, t]) => {
    window.__scStore.getState().openPreferences(`cz-${c}`);
    await new Promise((r) => setTimeout(r, 1100));
    const col = [...document.querySelectorAll('.prefs-content .fs-dnd-col')]
      .find((x) => x.querySelector('.fs-dnd-col-head')?.firstChild?.textContent?.trim() === t);
    if (!col) return { skipped: `no ${t} column on ${c}` };
    const head = col.querySelector('.fs-dnd-col-head');
    const btns = [...head.querySelectorAll('button')];
    if (btns.length < 2) return { cat: c, only: btns.length };
    const box = (e) => e.getBoundingClientRect();
    return {
      cat: c,
      labels: btns.map((b) => b.textContent.trim()),
      /* The gap BETWEEN the buttons — space-between put the whole header's
         slack there, which is exactly what "stranded in the middle" is. */
      gap: Math.round(box(btns[1]).left - box(btns[0]).right),
      /* …and the group as a whole is at the right edge, not the title's. */
      slackToRight: Math.round(box(head).right - box(btns[btns.length - 1]).right),
      grouped: Boolean(head.querySelector('.fs-dnd-col-head-actions')),
    };
  }, [cat, title]);
  heads.push(r);
}
for (const h of heads) {
  if (h.skipped) { console.log(`  SKIP — ${h.skipped}`); continue; }
  if (h.only) { console.log(`  SKIP ${h.cat} — one header button, nothing to sit beside`); continue; }
  ok(`${h.cat}: the header buttons are adjacent, not spread apart`,
    h.gap < 24, JSON.stringify(h));
  ok(`${h.cat}: …and the group sits at the right edge`,
    h.slackToRight < 24, JSON.stringify(h));
  ok(`${h.cat}: …wrapped so a third button would join them too`,
    h.grouped === true, JSON.stringify(h));
}

/* ── 2. each reset under its own section ─────────────────────────────────── */
console.log('\nthe Editor tab\'s resets sit under what they reset');
const editor = await page.evaluate(async () => {
  window.__scStore.getState().openPreferences('cz-elements');
  await new Promise((r) => setTimeout(r, 1500));
  const content = document.querySelector('.prefs-content');
  const box = (e) => e.getBoundingClientRect();
  const secs = [...content.querySelectorAll('section')].map((s) => ({
    heading: s.querySelector('h3')?.textContent.trim(),
    resets: [...s.querySelectorAll(':scope > .fs-tabbar button')].map((b) => b.textContent.trim()),
    top: Math.round(box(s).top),
  }));
  return {
    secs,
    allResets: [...content.querySelectorAll('.fs-tabbar button')].map((b) => b.textContent.trim()),
    bars: content.querySelectorAll('.fs-tabbar').length,
  };
});
/* Each reset is IN the section it names — the claim, and the thing a single
   bar at the bottom could never be. */
for (const [heading, label] of [
  ['Transitions', 'Reset Transitions'],
  ['Elements', 'Reset Elements'],
  ['Element Rules', 'Reset Element Rules'],
]) {
  const s = editor.secs.find((x) => x.heading === heading);
  ok(`“${label}” is inside the ${heading} section`,
    Boolean(s) && s.resets.includes(label), JSON.stringify(editor.secs));
}
/* Derek: "we do not need the 'Reset Mores and Continueds' button at all." */
ok('Reset Mores & Continueds is gone from the tab',
  !editor.allResets.some((l) => /Mores/i.test(l)), JSON.stringify(editor.allResets));
/* Removed from the REGISTRY, so it leaves Settings ▸ Defaults too. A reset
   living in one surface and not the other is the exact drift the one-registry
   design exists to prevent. */
const defaults = await page.evaluate(async () => {
  window.__scStore.getState().openPreferences('defaults');
  await new Promise((r) => setTimeout(r, 1200));
  return [...document.querySelectorAll('.prefs-content .fs-defaults-name')].map((n) => n.textContent.trim());
});
ok('…and from Settings ▸ Defaults, not just from the tab',
  defaults.length > 0 && !defaults.some((l) => /Mores/i.test(l)), JSON.stringify(defaults));
/* The ones that stayed must still be there — a sweep that deleted all four
   would satisfy every assertion above. */
ok('…while the other Editor resets still compile into Defaults',
  ['Reset Transitions', 'Reset Elements', 'Reset Element Rules']
    .every((l) => defaults.includes(l)), JSON.stringify(defaults));

/* ── 3. the Ribbon Toolbar tab, restructured ─────────────────────────────── */
/* ── 3 (REVERTED in v7.60) ───────────────────────────────────────────────
   This part drove the Ribbon Toolbar tab as Shown/Hidden columns: the Shown
   column being the token sequence, "+ Add" minting structural tokens, the
   section-title row field, the spacer and dropdown width fields, and the
   absence of the in-place bar editor.

   Derek: "revert the ribbon toolbar window back to before I asked you to split
   it into the shown+hidden columns." The tab is the palette-plus-live-bar
   editor again, so every assertion here describes a screen that no longer
   exists. Removed rather than left to fail or, worse, quietly rewritten to
   pass — a check whose subject was withdrawn should say so and stop, not
   linger asserting something adjacent.

   The tab's own behaviour is covered by the checks that always covered it:
   check-v683 (live on-ribbon editing, dropdown resize, dividers, alignment)
   and check-v716 (the editor renders at the same size as the live bar).

   The other three parts of this file stand — the greyed-menu-item fix, the
   header adders, and the Editor tab's per-section resets are all unrelated to
   the tab's shape and none of them was withdrawn. */


console.log('\nthe source side of what survived');
const src = (p) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8');
/* The section filter reads the SAME registry — the resets moved, the source
   of truth did not fork. */
const resets = src('components/customizeResets.tsx');
ok('the per-section resets still come from the one registry',
  /a\.tab === tab\s*\n?\s*&& \(section \? a\.section === section : !a\.section\)/.test(resets), '');
ok('…and each reset lands in exactly one place, never both',
  /section \? a\.section === section : !a\.section/.test(resets), '');
ok('Reset Mores & Continueds left the registry, not just the tab',
  !/moresContds/.test(resets), '');
/* v7.60: the ONE v7.58 change to the Customize dialog that survived the
   revert. Worth pinning in source as well as by geometry above — it is a
   single wrapper element, and a wholesale file restore is exactly the way it
   would quietly go missing again. */
ok('the column head still groups its actions',
  /fs-dnd-col-head-actions/.test(src('components/CustomizePanelsDialog.tsx')), '');
/* The CSS rule that made v7.06's tooltips inert. */
const css = readFileSync(new URL('../src/styles/screenplay/02-menubar.css', import.meta.url), 'utf8');
ok('a disabled menu item no longer opts out of the pointer',
  !/\.menu-dropdown-item\.disabled\s*\{[^}]*pointer-events:\s*none/.test(css), '');
/* All three renders of a menu item pass the tooltip through — it was on one
   of them, so an Align item could be given one and never show it. */
const mb = src('components/MenuBar.tsx');
ok('every render of a menu item passes its tooltip through',
  (mb.match(/title=\{(?:item|child)\.tooltip\}/g) || []).length === 3,
  `${(mb.match(/title=\{(?:item|child)\.tooltip\}/g) || []).length} of 3`);
ok('…and the shared sentence has one definition',
  (mb.match(/export const IN_DEVELOPMENT = /g) || []).length === 1
  && (mb.match(/'This feature is still in development\.'/g) || []).length === 1, '');

console.log(`\ncheck-v758: ${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail ? 1 : 0);
