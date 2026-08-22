/* check-v776 — Derek's Design values and helper text are IN THE CODE.
 *
 *   "take these settings and add them directly into the app code"
 *
 * The two windows are leaving the release, so the values cannot stay as
 * settings. Design's 81 numbers are the tokens' own defaults and the CSS
 * fallbacks; the 141 helper-text edits are the source strings themselves.
 *
 * WHAT MAKES THIS CHECKABLE, and what makes it easy to fake: a fresh profile
 * must now hold NO overrides at all and still look exactly as it did. So the
 * assertions are in two halves that have to hold TOGETHER —
 *   • the override maps are empty (nothing is being applied at runtime), and
 *   • the app still renders his numbers and his words.
 * Either half alone passes on a mistake: empty maps alone would also be true of
 * having simply thrown his settings away.
 *
 * The blanked tooltips are the sharpest case. He blanked 45 of them, and an
 * override of "" and a REMOVED title attribute look identical on screen — but
 * only one of them survives the override map going away.
 */
import { readFileSync } from 'node:fs';
import { launch, boot, settle } from './driver.mjs';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  PASS ${name}`); }
  else { fail++; console.log(`  FAIL ${name} ${extra}`); }
};

const BUNDLE = JSON.parse(readFileSync(new URL('../src/data/defaultPreset.json', import.meta.url), 'utf8'));
const TOKENS = readFileSync(new URL('../src/design/designTokens.ts', import.meta.url), 'utf8');

/* ── the shipped bundle no longer carries either ─────────────────────────── */
console.log('\nneither rides in the shipped preset any more');
ok('no design part', !('design' in BUNDLE.parts), JSON.stringify(Object.keys(BUNDLE.parts)));
ok('no helper text part', !('helpertext' in BUNDLE.parts), JSON.stringify(Object.keys(BUNDLE.parts)));
ok('…and the checklist agrees with the parts',
  JSON.stringify(BUNDLE.includes) === JSON.stringify(Object.keys(BUNDLE.parts)),
  JSON.stringify(BUNDLE.includes));
/* The viewState blob is what actually seeds them — dropping only the parts
   would have left every override in place anyway. */
const VS = JSON.parse(BUNDLE.parts.settings['opendraft:viewState']);
ok('…nor inside the view state blob, which is what seeds',
  !('designVars' in VS) && !('helperTextOverrides' in VS) && !('helperTextHidden' in VS),
  JSON.stringify(['designVars', 'helperTextOverrides', 'helperTextHidden'].filter((k) => k in VS)));
/* And the rest of his preset is untouched — this was a surgical removal. */
ok('the five workspaces are still there',
  Object.keys(BUNDLE.parts.workspaces.workspaces).length === 5, '');
ok('…and his annotation presets', BUNDLE.parts.annotations.length === 6, '');

/* ── the token defaults ARE his numbers ──────────────────────────────────── */
console.log('\nthe design values are the tokens\' own defaults');
const DEF = (id) => {
  const i = TOKENS.indexOf(`id: '${id}'`);
  return i < 0 ? null : Number(TOKENS.slice(i).match(/def:\s*(-?[\d.]+)/)[1]);
};
/* A spread: a big one, a small one, the one v7.32's void was about, and the
   three NEGATIVE gaps — the first negative defaults this file has held, and
   the reason its own fallback-matching test could not see them. */
const WANT = {
  editorMainPadTop: 42, menuDropdownMinW: 325, charCardMinH: 480, toolWinRadius: 12,
  ribBtnGapBottomUntitled: -1, ribRowGapTitled: -2, ribRowGapUntitled: -3,
};
const wrong = Object.entries(WANT).filter(([id, v]) => DEF(id) !== v);
ok('every sampled token carries his value', wrong.length === 0,
  JSON.stringify(wrong.map(([id, v]) => `${id}: ${DEF(id)} ≠ ${v}`)));

const { browser, page } = await launch({ width: 1500, height: 950 });
await boot(page);
await settle(page);

/* ── a fresh profile applies NOTHING, and still looks like his app ───────── */
console.log('\na fresh install holds no overrides and still looks the same');
const live = await page.evaluate(() => {
  const s = window.__scStore.getState();
  const root = document.documentElement;
  const main = document.querySelector('.editor-main');
  return {
    designVars: Object.keys(s.designVars).length,
    htOverrides: Object.keys(s.helperTextOverrides).length,
    htHidden: s.helperTextHidden.length,
    /* Read the INLINE property — applyDesignVars writes there. Empty means
       nothing is being overridden and the CSS fallback is what paints. */
    inlinePadTop: root.style.getPropertyValue('--dz-editor-main-pad-top'),
    /* …and the painted result, which is the half that proves the fallback
       carries his number rather than the old one. */
    padTop: main ? getComputedStyle(main).paddingTop : null,
  };
});
ok('no design overrides at all', live.designVars === 0, `${live.designVars}`);
ok('no helper-text overrides either', live.htOverrides === 0 && live.htHidden === 0,
  JSON.stringify([live.htOverrides, live.htHidden]));
ok('…nothing written onto :root', live.inlinePadTop === '', JSON.stringify(live.inlinePadTop));
/* THE PAIR THAT MATTERS. Empty maps alone would also be true of having thrown
   his settings away; this is the half that says they arrived. */
ok('…and the page still sits at his 42px, from the CSS itself',
  live.padTop === '42px', JSON.stringify(live.padTop));

/* ── the helper text reads as he wrote it ────────────────────────────────── */
console.log('\nthe tooltips say what he made them say');
const tips = await page.evaluate(async () => {
  const S = () => window.__scStore.getState();
  S().setToolbarEditing(false);
  await new Promise((r) => setTimeout(r, 400));
  const all = [...document.querySelectorAll('[title]')].map((e) => e.getAttribute('title'));
  const find = (t) => all.includes(t);
  return {
    /* rewritten — the shorter wording he chose */
    dragResize: find('Drag to resize'),
    /* the old, longer strings must be gone from the DOM entirely */
    oldDragResize: find('Drag to resize this dropdown'),
    oldLocked: all.some((t) => /Sizing is locked — click to unlock/.test(t ?? '')),
    /* BLANKED: no title attribute at all, not an empty one. An override of ""
       and a removed attribute look identical on screen; only the removal
       survives the override map going away. */
    emptyTitles: all.filter((t) => t === '').length,
    total: all.length,
  };
});
ok('a rewritten tooltip reads his words', tips.dragResize === true, JSON.stringify(tips));
ok('…and the app\'s old wording is nowhere in the DOM',
  tips.oldDragResize === false && tips.oldLocked === false, JSON.stringify(tips));
ok('…while a blanked one leaves NO empty title behind',
  tips.emptyTitles === 0, `${tips.emptyTitles} of ${tips.total}`);

/* The catalog is generated FROM the source, so it is the reading that proves
   the strings really moved rather than being masked at runtime. */
const CAT = JSON.parse(readFileSync(new URL('../src/data/helperTextCatalog.json', import.meta.url), 'utf8'));
const texts = new Set(CAT.map((c) => c.text));
ok('the catalog lists his wording', texts.has('Drag to resize') && texts.has('Hide annotations'), '');
ok('…and not the app\'s old wording',
  !texts.has('Drag to resize this dropdown') && !texts.has('Hide annotations on the script'), '');
/* v7.76: the harvester used to record the raw source characters, so a literal
   spelled with an escape was catalogued with a backslash in it — and an
   override keyed on that could never match what the DOM shows. */
ok('…and no entry holds a raw source escape',
  !CAT.some((c) => /\\[unrt]/.test(c.text)),
  JSON.stringify(CAT.filter((c) => /\\[unrt]/.test(c.text)).map((c) => c.text.slice(0, 40))));

await browser.close();
console.log(`\ncheck-v776: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
