/* check-v750 — Derek, pointing at Format ▸ Script Format / Template: "this is
 * the window that should be duplicated in the setting > page setup tab. use
 * the window shown in the screenshot, and add the view button. keep the
 * shown/hidden section below this."
 *
 * "Duplicated" is what this must NOT be, and that is the thing worth checking.
 * Copying the markup would satisfy the screenshot today and drift apart by
 * next month — which is not a hypothetical here: the tab and the dialog HAD
 * each grown their own row, and they had already diverged, the dialog showing
 * each template's mode and marking which one the open script uses, the tab
 * showing neither. So the assertions below are mostly about SAMENESS, and they
 * are written to fail if the two lists are ever drawn by two functions again:
 * every card is read out of both surfaces and compared field by field.
 *
 * What legitimately differs is asserted too, in both directions — a difference
 * that quietly disappears is as much a bug as one that quietly appears:
 *
 *   · the tab has View, because it is the only place with a page setup to open;
 *     the dialog must not grow one, having nowhere to send it.
 *   · both lists' rows are a CHOICE — click one, then Apply. The tab's were
 *     inert when this check was written, on my reasoning that a management
 *     list has nothing to select FOR; Derek corrected that in v7.51 and it now
 *     applies templates too. The rule was never about which list it is: a row
 *     must not highlight with nothing to act on the highlight, so the row and
 *     its Apply are checked as a pair.
 *
 * (Until v7.81 the Shown/Hidden columns had to sit below all of it — Derek
 * then retired the picker filter, so their absence is asserted instead.) The
 * half of Derek's message it would be easiest to satisfy by accident and lose
 * by accident too.
 */
import { readFileSync } from 'node:fs';
import { launch, boot, settle } from './driver.mjs';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  PASS ${name}`); }
  else { fail++; console.log(`  FAIL ${name} ${extra}`); }
};

const { browser, page } = await launch();
await boot(page);

/* Read every card out of whichever list is on screen, in order. */
const READ_CARDS = `(root) => [...root.querySelectorAll('.template-select-item')].map((c) => ({
  name: c.querySelector('.template-select-item-name')?.childNodes[0]?.textContent.trim(),
  current: Boolean(c.querySelector('.template-select-current-badge')),
  mode: c.querySelector('.template-select-mode-badge')?.textContent.trim(),
  desc: c.querySelector('.template-select-item-desc')?.textContent.trim(),
  btns: [...c.querySelectorAll('button')].map((b) => b.textContent.trim()),
}))`;

console.log('\nthe Page Setup tab shows the window\'s list');
await page.evaluate(() => window.__scStore.getState().openPreferences('page'));
await page.waitForSelector('.pst-list', { timeout: 8000 });
await settle(page);
await page.waitForTimeout(400);

const tab = await page.evaluate(`(${READ_CARDS})(document.querySelector('.pst-list'))`);
const tabShape = await page.evaluate(() => {
  const list = document.querySelector('.pst-list');
  const cols = document.querySelector('.fs-dnd-cols');
  return {
    cats: [...list.querySelectorAll('.template-select-category')].map((c) => c.textContent.trim()),
    listBottom: Math.round(list.getBoundingClientRect().bottom),
    colsTop: Math.round(cols?.getBoundingClientRect().top ?? 0),
    createBtn: [...document.querySelectorAll('.prefs-content button')]
      .some((b) => b.textContent.trim() === '+ Create Template'),
    // Duplicate is on every row now, so the dropdown that did the same job is
    // gone rather than kept as a second way to do one thing.
    basePicker: Boolean(document.querySelector('.pst-baseselect'))
      || [...document.querySelectorAll('.prefs-content button')]
        .some((b) => /New Template/.test(b.textContent)),
    // the dialog caps its list and scrolls; inside a tab that already scrolls
    // the cap hides the User Defined section behind a gesture nothing marks
    clipped: list.scrollHeight > list.clientHeight + 2,
  };
});
ok('every template is listed as a card', tab.length >= 6, `${tab.length} cards`);
ok('…under the window\'s two headings',
  tabShape.cats[0] === 'Script Formats' && tabShape.cats.includes('User Defined'),
  JSON.stringify(tabShape.cats));
ok('…each carrying its mode and its description',
  tab.every((c) => c.mode && c.desc), JSON.stringify(tab[0]));
ok('…and the one that the open script uses is marked current',
  tab.filter((c) => c.current).length === 1, JSON.stringify(tab.map((c) => [c.name, c.current])));
ok('every card offers View', tab.every((c) => c.btns.includes('View')), JSON.stringify(tab[0]?.btns));
ok('the window\'s + Create Template came too', tabShape.createBtn === true, JSON.stringify(tabShape));
/* Derek: "keep the shown/hidden section below this." */
/* v7.81, Derek retired the New Script Picker columns entirely — what was
   "still below the list" is now "not there at all". */
ok('the Shown/Hidden columns are gone from the tab',
  tabShape.colsTop === 0, JSON.stringify(tabShape));
/* The one deliberate deviation from the window, and the reason it is one. */
ok('the list is not clipped inside its own scroller here',
  tabShape.clipped === false, JSON.stringify(tabShape));
/* Duplicate is on every row now, so the base-picker dropdown that did the same
   job is gone — not kept as a second way to do one thing. */
ok('the retired base-picker row is really gone from the tab',
  tabShape.basePicker === false, JSON.stringify(tabShape));

/* v7.50 asserted the OPPOSITE of what follows, and the correction is worth
   keeping visible. I had made these rows inert on the reasoning that the tab
   was a management list where a selection meant nothing. Derek: "the window
   lacks the ability to select a template and apply it, like the other window
   has." So it is a chooser as well, from v7.51.

   The rule underneath did not change, only which side of it this list is on: a
   row must never highlight with nothing to act on the highlight. So what is
   checked here is the PAIR — the row selects, AND there is an Apply that
   consumes the selection. Either one alone is the dead affordance. (What the
   Apply actually does is check-v751's job.) */
const clicked = await page.evaluate(async () => {
  const card = document.querySelectorAll('.pst-list .template-select-item')[1];
  card.click();
  await new Promise((r) => setTimeout(r, 250));
  return {
    selected: card.classList.contains('selected'),
    anySelected: document.querySelectorAll('.pst-list .template-select-item.selected').length,
    apply: [...document.querySelectorAll('.pst-newrow button')]
      .filter((b) => /Apply to Script/.test(b.textContent))
      .map((b) => ({ disabled: b.disabled })),
  };
});
ok('clicking a row in the tab selects it', clicked.selected === true, JSON.stringify(clicked));
ok('…exactly one at a time', clicked.anySelected === 1, JSON.stringify(clicked));
ok('…and there is an Apply for that selection to feed',
  clicked.apply.length === 1 && clicked.apply[0].disabled === false, JSON.stringify(clicked));

await page.evaluate(() => window.__scStore.getState().closePreferences?.());
await page.waitForTimeout(400);

console.log('\nthe Format window shows the same cards');
const dlg = await page.evaluate(async () => {
  [...document.querySelectorAll('[class*=menu-item],[role=menuitem]')]
    .find((i) => i.textContent.trim() === 'Format').click();
  await new Promise((r) => setTimeout(r, 400));
  const item = [...document.querySelectorAll('.menu-dropdown-item')]
    .find((i) => /Script Format|Formatting Template/i.test(i.textContent));
  if (!item) return { skipped: 'no Script Format item in the Format menu' };
  item.click();
  await new Promise((r) => setTimeout(r, 800));
  return { open: Boolean(document.querySelector('.template-select-list')) };
});
if (dlg.skipped) {
  console.log(`  SKIP the Format window — ${dlg.skipped}`);
} else {
  ok('the Script Format / Template window opens', dlg.open === true, JSON.stringify(dlg));

  const win = await page.evaluate(`(${READ_CARDS})(document.querySelector('.template-select-list'))`);

  /* THE POINT OF ALL OF THIS. Same templates, same names, same modes, same
     descriptions, same current marker — because it is the same component. If
     anyone reintroduces a second row renderer, this is what catches it. */
  const strip = (c) => ({ name: c.name, current: c.current, mode: c.mode, desc: c.desc });
  const tabCore = tab.map(strip);
  const winCore = win.map(strip);
  ok('the two lists hold the same cards, field for field',
    JSON.stringify(tabCore) === JSON.stringify(winCore),
    `tab=${JSON.stringify(tabCore.slice(0, 2))} window=${JSON.stringify(winCore.slice(0, 2))}`);

  /* The differences, asserted in BOTH directions. */
  ok('the window has no View — it has nowhere to send one',
    win.every((c) => !c.btns.includes('View')), JSON.stringify(win[0]?.btns));
  ok('…but the same Duplicate the tab has',
    win.every((c) => c.btns.includes('Duplicate')), JSON.stringify(win[0]?.btns));

  const winSel = await page.evaluate(async () => {
    const cards = [...document.querySelectorAll('.template-select-list .template-select-item')];
    cards[1].click();
    await new Promise((r) => setTimeout(r, 250));
    return { selected: cards[1].classList.contains('selected') };
  });
  ok('a row in the window IS a choice, and paints as one',
    winSel.selected === true, JSON.stringify(winSel));

  await page.evaluate(async () => {
    [...document.querySelectorAll('.template-select-actions button')]
      .find((b) => b.textContent.trim() === 'Cancel')?.click();
    await new Promise((r) => setTimeout(r, 300));
  });
}

console.log('\none component, not two');
const card = readFileSync(new URL('../src/components/TemplateCard.tsx', import.meta.url), 'utf8');
const tabSrc = readFileSync(new URL('../src/components/PageSetupTab.tsx', import.meta.url), 'utf8');
const dlgSrc = readFileSync(new URL('../src/components/TemplateSelectDialog.tsx', import.meta.url), 'utf8');
ok('both surfaces render TemplateCard',
  /<TemplateCard/.test(tabSrc) && /<TemplateCard/.test(dlgSrc), '');
/* The tab's own row markup is retired rather than left lying about — a second
   renderer nobody calls is a second renderer somebody will call. */
ok('the tab\'s old row markup is gone, not just unused',
  !/pst-listrow|pst-default-badge|pst-row-actions/.test(tabSrc), '');
ok('…and its CSS went with it',
  !/^\.pst-listrow/m.test(readFileSync(new URL('../src/styles/screenplay/22-tools-extra.css', import.meta.url), 'utf8')), '');
/* Same rule the v7.49 Cancel follows: the affordance follows the handler. */
ok('View appears only where a handler was given',
  /\{onView && \(/.test(card), '');
ok('a row is clickable only where a selection means something',
  /const rowClick = onSelect$/m.test(card) && /onSelect \? '' : ' template-select-item-static'/.test(card), '');
/* v7.52: the guard that keeps a BUTTON press from also selecting the row lives
   on the row, where it can look at what was pressed. It used to be a
   stopPropagation on the actions container — which is the full width of the
   card, so the ~1,150px of empty strip beside the buttons swallowed clicks and
   the bottom of every card read as dead. */
ok('…and the button guard is not a blanket stopPropagation on the actions row',
  !/template-select-item-actions" onClick=\{\(e\) => e\.stopPropagation\(\)\}/.test(card), '');
ok('the tab does not keep a second renderer around unused',
  !/const actionRow|fmt-card-info/.test(tabSrc), '');

console.log(`\ncheck-v750: ${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail ? 1 : 0);
