/* check-v777 — the ruler's grey margin bands, and the Page Setup door that
 * wrote into the void.
 *
 * Derek: "the grayed out sections on the ruler (which shows the margins) should
 * adjust when the page settings and margin sizes adjust."
 *
 * THE RULERS WERE NOT THE FAULT, and proving that is half of this file. The
 * bands are painted onto a canvas, so they are measured the only honest way —
 * by reading the pixels back — against every page setting there is: left and
 * right margins, top and bottom margins, and page size. All of them track.
 *
 * What did not move was the PAGE. Settings ▸ Page Setup ▸ [a row] ▸ View opens
 * a full page of margin fields for a TEMPLATE, and saving wrote the template's
 * stored layout and stopped there — so editing the margins of the template your
 * script is already using changed nothing on screen and still reported "Page
 * setup saved". From a writer's seat that is indistinguishable from a ruler
 * that refuses to follow.
 *
 * So the second half drives THE REAL DIALOG — opened from the tab, typed into,
 * saved with its own button. A store-level assertion would have passed on a
 * dialog wired to nothing, which is the exact shape of the bug being fixed.
 *
 * And the other direction is asserted too, because "apply it to the script" is
 * only right for the template the script is using: editing a format you are not
 * writing in must leave the draft alone.
 */
import { launch, boot, settle, zoom100 } from './driver.mjs';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  PASS ${name}`); }
  else { fail++; console.log(`  FAIL ${name} ${extra}`); }
};

const { browser, page } = await launch({ width: 2400, height: 1100 });
await boot(page);
await settle(page);
await zoom100(page);                       // his defaults ship at 140%
await page.evaluate(() => window.__scStore.setState({ showRulers: true }));
await settle(page);
await page.waitForSelector('.fs-ruler-h', { timeout: 8000 });

/** The shaded runs on a ruler canvas, in CSS px, widest first.
 *  Read below the tick marks so the numerals and ticks are not mistaken for
 *  shading; anything under 4px is a stray antialiased edge. */
const bands = (axis) => page.evaluate((ax) => {
  const c = document.querySelector(ax === 'h' ? '.fs-ruler-h' : '.fs-ruler-v');
  if (!c) return null;
  const ctx = c.getContext('2d');
  const dpr = c.width / c.getBoundingClientRect().width;
  const line = ax === 'h'
    ? ctx.getImageData(0, Math.floor(c.height * 0.75), c.width, 1).data
    : ctx.getImageData(Math.floor(c.width * 0.75), 0, 1, c.height).data;
  const n = ax === 'h' ? c.width : c.height;
  const runs = [];
  for (let i = 0; i < n; i++) {
    if (line[i * 4 + 3] === 0) continue;
    const last = runs[runs.length - 1];
    if (last && i === last.to + 1) last.to = i; else runs.push({ from: i, to: i });
  }
  return runs.map((g) => ({ from: g.from / dpr, w: (g.to - g.from + 1) / dpr }))
    .filter((g) => g.w >= 4)
    .map((g) => ({ from: Math.round(g.from), w: Math.round(g.w) }));
}, axis);

const pageBox = () => page.evaluate(() => {
  const pg = document.querySelector('.page');
  const cs = getComputedStyle(pg);
  const r = pg.getBoundingClientRect();
  return {
    padL: parseFloat(cs.paddingLeft), padR: parseFloat(cs.paddingRight),
    padT: parseFloat(cs.paddingTop), w: Math.round(r.width), h: Math.round(r.height),
  };
});
const setLayout = async (patch) => {
  await page.evaluate((p) => {
    const s = window.__scStore.getState();
    s.setPageLayout({ ...s.pageLayout, ...p });
  }, patch);
  await settle(page);
};

/* ── 1: the bands are the margins, at every setting ───────────────────────
   Against the PAGE'S OWN PADDING, never against a remembered pixel count —
   padding is what a margin physically is here, so the two agreeing is the
   claim. A hardcoded 144 would have passed while both were wrong together. */
console.log('\nthe grey bands are the document\'s margins');
await setLayout({ leftMargin: 1.5, rightMargin: 0.7, topMargin: 72, bottomMargin: 72, pageWidth: 8.5, pageHeight: 11 });
let box = await pageBox();
let h = await bands('h');
ok('there are exactly two shaded runs — one per side', h.length === 2, JSON.stringify(h));
ok('…the left one is the left margin wide', Math.abs(h[0].w - box.padL) <= 2, `${h[0]?.w} vs ${box.padL}`);
ok('…and the right one is the right margin wide', Math.abs(h[1].w - box.padR) <= 2, `${h[1]?.w} vs ${box.padR}`);
ok('…and they are not the same width, so neither is a coincidence',
  Math.abs(h[0].w - h[1].w) > 20, JSON.stringify(h.map((b) => b.w)));

console.log('\nand they follow every page setting that moves a margin');
await setLayout({ leftMargin: 2.5, rightMargin: 0.4 });
box = await pageBox(); h = await bands('h');
ok('wider left margin → wider left band',
  Math.abs(h[0].w - box.padL) <= 2 && h[0].w > 200, `${h[0]?.w} vs ${box.padL}`);
ok('narrower right margin → narrower right band',
  Math.abs(h[1].w - box.padR) <= 2 && h[1].w < 50, `${h[1]?.w} vs ${box.padR}`);

await setLayout({ leftMargin: 1.5, rightMargin: 1.0, topMargin: 144, bottomMargin: 36 });
box = await pageBox();
const v = await bands('v');
ok('a taller top margin → a taller band on the vertical ruler',
  v.length > 0 && Math.abs(v[0].w - box.padT) <= 2, `${v[0]?.w} vs ${box.padT}`);

/* Page SIZE moves the page without touching a margin — the bands must stay the
   margins rather than scaling with the sheet. */
const beforeSize = await bands('h');
await setLayout({ pageWidth: 5.83, pageHeight: 8.27 });
const smaller = await pageBox();
const afterSize = await bands('h');
ok('a smaller page really is smaller', smaller.w < 700, `${smaller.w}px wide`);
ok('…and the bands stay the MARGINS, unchanged by the sheet size',
  afterSize[0].w === beforeSize[0].w && Math.abs(afterSize[0].w - smaller.padL) <= 2,
  JSON.stringify([beforeSize[0]?.w, afterSize[0]?.w, smaller.padL]));
await setLayout({ pageWidth: 8.5, pageHeight: 11, topMargin: 72, bottomMargin: 72 });

/** Type a new Left margin into the open template Page Setup and press its own
 *  button. By the field's LABEL ("Left (in)") — an earlier cut scanned rows for
 *  the word "left" and matched an outer container, so it typed into Top and
 *  then asserted that Left had not changed, which it had not. */
const typeLeftAndApply = (value) => page.evaluate(async (v) => {
  const dlg = document.querySelector('.page-setup-dialog');
  if (!dlg) return { ok: false, why: 'no dialog' };
  /* The field's own text, wherever the markup hangs it — some rows wrap the
     input in a <label>, others sit it beside a sibling span. */
  const labelOf = (i) => (i.closest('label') ?? i.parentElement)?.textContent?.trim() ?? '';
  const nums = [...dlg.querySelectorAll('input[type="number"]')];
  const input = nums.find((i) => /^Left\b/i.test(labelOf(i)));
  if (!input) return { ok: false, why: `no Left field among ${JSON.stringify(nums.map(labelOf))}` };
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(input, String(v));
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
  input.blur();
  await new Promise((r) => setTimeout(r, 300));
  const apply = [...dlg.querySelectorAll('button')]
    .find((b) => /^(apply|save|ok)$/i.test((b.textContent || '').trim()));
  if (!apply) return { ok: false, why: `no apply button (${[...dlg.querySelectorAll('button')].map((b) => b.textContent.trim()).join('|')})` };
  apply.click();
  await new Promise((r) => setTimeout(r, 700));
  return { ok: true, typed: input.value };
}, value);

/* ── 2: the template door, driven through its real dialog ─────────────────
   Settings ▸ Page Setup ▸ [row] ▸ View. Everything below is clicks and typing;
   nothing reaches into the store to do the work the dialog is supposed to do. */
console.log('\nediting the margins of the template THIS script uses moves the script');
await page.evaluate(() => window.__scStore.getState().openPreferences('page'));
await page.waitForSelector('.pst-list', { timeout: 8000 }).catch(() => {});
await settle(page);
const tabUp = await page.$('.pst-list');
ok('the Page Setup tab is open, with its template list', Boolean(tabUp), '');

if (tabUp) {
  /* The row the script is actually using — the card marks it, and that mark is
     what decides whether saving should touch the draft. */
  const activeName = await page.evaluate(() => {
    const card = [...document.querySelectorAll('.pst-list .template-select-item')]
      .find((c) => c.querySelector('.template-select-current-badge'));
    return card?.querySelector('.template-select-item-name')?.childNodes[0]?.textContent.trim() ?? null;
  });
  console.log(`     the script's template reads as: ${JSON.stringify(activeName)}`);

  /* By the CURRENT badge, not by a name — the built-ins' display names are not
     their ids (the script's is "Film Script", whose id is industry-standard),
     and this check is about "the template this script uses" either way. */
  const openViewFor = async (wantCurrent) => {
    const cards = await page.$$('.pst-list .template-select-item');
    for (const c of cards) {
      const isCurrent = Boolean(await c.$('.template-select-current-badge'));
      if (isCurrent !== wantCurrent) continue;
      const btns = await c.$$('button');
      for (const b of btns) {
        if (/^View$/i.test(((await b.textContent()) || '').trim())) {
          await b.click(); await settle(page); return true;
        }
      }
    }
    return false;
  };
  const opened = await openViewFor(true);
  await page.waitForSelector('.page-setup-dialog', { timeout: 6000 }).catch(() => {});
  ok('View opens that template\'s page setup', opened && Boolean(await page.$('.page-setup-dialog')), '');

  /* Type into the real field and press the dialog's own button. */
  const typedSave = await typeLeftAndApply(2.75);
  ok('the Left field takes a new value and Apply is pressed', typedSave.ok === true, JSON.stringify(typedSave));
  await settle(page);

  const afterSave = await page.evaluate(() => ({
    doc: window.__scStore.getState().pageLayout.leftMargin,
    padL: parseFloat(getComputedStyle(document.querySelector('.page')).paddingLeft),
  }));
  const bandsAfter = await bands('h');
  /* THE WHOLE POINT. Before this change the template store took the number and
     the document kept its old one, so nothing on screen moved. */
  ok('…and the SCRIPT takes the new margin', afterSave.doc === 2.75, `${afterSave.doc}`);
  ok('…the page really re-lays out to it', Math.abs(afterSave.padL - 2.75 * 96) <= 2, `${afterSave.padL}px`);
  ok('…and the ruler band follows the page',
    Math.abs(bandsAfter[0].w - afterSave.padL) <= 2, `${bandsAfter[0]?.w} vs ${afterSave.padL}`);

  /* The other direction: a template the script is NOT using must not reflow the
     draft. Same dialog, same Save, opposite expectation. */
  console.log('\nand a template the script is NOT using leaves the draft alone');
  /* Apply closes the dialog, but its overlay is still mounted for a frame and
     Playwright's hit-testing sees it — the second View click landed on the
     overlay and timed out until this wait. */
  await page.waitForSelector('.page-setup-dialog', { state: 'detached', timeout: 6000 }).catch(() => {});
  await settle(page);
  const otherOpened = await openViewFor(false);
  await page.waitForSelector('.page-setup-dialog', { timeout: 6000 }).catch(() => {});
  if (otherOpened && await page.$('.page-setup-dialog')) {
    const before = await page.evaluate(() => window.__scStore.getState().pageLayout.leftMargin);
    const typed2 = await typeLeftAndApply(0.9);
    await settle(page);
    const after = await page.evaluate(() => window.__scStore.getState().pageLayout.leftMargin);
    ok('the other template\'s Apply was pressed too', typed2.ok === true, JSON.stringify(typed2));
    ok('…and the open script did NOT move', after === before, `${before} → ${after}`);
  } else {
    console.log('     (no second template row offered View — skipped)');
  }
}

await browser.close();
console.log(`\ncheck-v777: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
