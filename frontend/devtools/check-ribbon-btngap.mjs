import { settle, tokenDefault } from './driver.mjs';
// devtools/check-ribbon-btngap.mjs — v5.18, Derek: "for two row section, add
// bottom row button spacing and top row button spacing. currently 0 for button
// spacing still has a decent gap."
// The per-kind gap knob became per-ROW margins (negative-capable — at 0 the
// boxes already touch; what he saw was glyph air inside the boxes). Three boots:
//   A. defaults    — every adjacent pair renders whatever designTokens.ts says
//                    the default is, and an in-row user divider carries that
//                    default plus its own 6px, equally on both sides (parity).
//   B. four values — each knob moves ONLY its own row (8 / 0 / -6 overlap / 12).
//   C. legacy key  — a saved ribBtnGapUntitled: 9 seeds BOTH untitled rows.
import { chromium } from 'playwright-core';

const results = [];
const check = (n, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  results.push(ok);
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${n.padEnd(46)} got ${JSON.stringify(got)}${ok ? '' : `  want ${JSON.stringify(want)}`}`);
};

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });

const SEED = (opts) => {
  if (localStorage.getItem('__ribbtngap_seeded')) return;
  localStorage.clear();
  localStorage.setItem('__ribbtngap_seeded', '1');
  localStorage.setItem('opendraft:viewState', JSON.stringify({
    toolbarLeft: [
      'b:bold', ...(opts.divider ? ['d:x1'] : []), 'b:italic', 'r:t1', 'b:alignLeft', 'b:alignCenter',
      '2!d:d1',
      'st:Go', 'b:find', 'b:goto', 'r:t2', 'b:undo', 'b:redo',
      '2!d:d2',
      'b:copy',
    ],
    toolbarZonesSet: true,
    designVars: opts.designVars,
  }));
  for (const f of ['BigZone202', 'SepDividers214', 'SurfaceToggles234', 'LockResize255',
                   'ResetSizes267', 'TwoRows294', 'Ribbon295', 'RibbonSections296',
                   'CustomizeItem302', 'DropPanelToggles325']) {
    localStorage.setItem(`opendraft:toolbar${f}`, '1');
  }
};

async function boot(opts) {
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 900 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
  await page.addInitScript(SEED, opts);
  await page.goto('http://localhost:5199/', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.ProseMirror', { timeout: 25000 });
  for (let i = 0; i < 5; i++) { if (!(await page.$('.dialog-overlay'))) break; await page.keyboard.press('Escape'); await settle(page); }
  await page.waitForSelector('.toolbar-ribbon .rib-kind-titled', { timeout: 8000 });
  return { ctx, page };
}

// Box-edge distances between each row's adjacent children — margins are the
// spacing mechanism now, so rect deltas are the only honest measure.
const measure = (page) => page.evaluate(() => {
  const rowPairs = (row) => {
    const els = [...row.children].filter((c) => !c.classList.contains('rib-row-line'));
    const out = [];
    for (let i = 1; i < els.length; i++) {
      const a = els[i - 1].getBoundingClientRect(), b = els[i].getBoundingClientRect();
      out.push(Math.round((b.left - a.right) * 10) / 10);
    }
    return out;
  };
  const rows = (sel) => [...document.querySelector(sel).querySelectorAll('.rib-row')].map(rowPairs);
  const [tiTop, tiBot] = rows('.rib-kind-titled:not(.rib-single)');
  const [unTop, unBot] = rows('.rib-kind-untitled:not(.rib-single)');
  return { tiTop, tiBot, unTop, unBot };
});

// ── A. defaults + in-row divider parity ─────────────────────────────────────
/* v7.76: these four read the SHIPPED defaults out of designTokens.ts instead of
   restating them. They were written as literals — "old default 1", "7px both
   sides" — and Derek's preset moved three of the four (top-untitled 1→0,
   bottom-untitled 1→-1), so all three went red saying nothing more than "the
   number changed". The claim worth keeping is that whatever the default is, it
   is what the ROW ACTUALLY RENDERS: the knob reaches the pixels.
   The divider's +6px is not fitted to an observation — it is written into
   03-toolbar.css:684 as `calc(var(--rib-btn-gap-top-k) + 6px)`, the air the
   pre-ribbon toolbar gave a divider. Parity (equal on both sides) is asserted
   separately, because that is the half a one-sided margin rule would break. */
{
  const { ctx, page } = await boot({ divider: true, designVars: {} });
  const r = await measure(page);
  const DIVIDER_AIR = 6;                                  // 03-toolbar.css:684–685
  check('A: titled top pair renders its default', r.tiTop, [tokenDefault('ribBtnGapTopTitled')]);
  check('A: titled bottom pair renders its default', r.tiBot, [tokenDefault('ribBtnGapBottomTitled')]);
  check('A: untitled divider air = the default + 6px, both sides',
    r.unTop, [tokenDefault('ribBtnGapTopUntitled') + DIVIDER_AIR, tokenDefault('ribBtnGapTopUntitled') + DIVIDER_AIR]);
  check('A: …and the two sides match each other', r.unTop[0] === r.unTop[1], true);
  check('A: untitled bottom pair renders its default', r.unBot, [tokenDefault('ribBtnGapBottomUntitled')]);
  await ctx.close();
}

// ── B. per-row isolation, exact zero, negative overlap ──────────────────────
{
  const { ctx, page } = await boot({ designVars: {
    ribBtnGapTopTitled: 8, ribBtnGapBottomTitled: 0,
    ribBtnGapTopUntitled: -6, ribBtnGapBottomUntitled: 12,
  } });
  const r = await measure(page);
  check('B: titled TOP row reads its knob (8)', r.tiTop, [8]);
  check('B: titled BOTTOM row reads its knob (0)', r.tiBot, [0]);
  check('B: untitled TOP row overlaps (-6)', r.unTop, [-6]);
  check('B: untitled BOTTOM row reads its knob (12)', r.unBot, [12]);
  await page.screenshot({ path: new URL('./last-ribbon-btngap.png', import.meta.url).pathname, clip: { x: 0, y: 0, width: 700, height: 120 } });
  await ctx.close();
}

// ── C. legacy per-kind key migrates into both rows ──────────────────────────
{
  const { ctx, page } = await boot({ designVars: { ribBtnGapUntitled: 9 } });
  const r = await measure(page);
  check('C: legacy key seeds untitled TOP row (9)', r.unTop, [9]);
  check('C: legacy key seeds untitled BOTTOM row (9)', r.unBot, [9]);
  check('C: titled rows stay at their defaults',
    [r.tiTop, r.tiBot], [[tokenDefault('ribBtnGapTopTitled')], [tokenDefault('ribBtnGapBottomTitled')]]);
  await ctx.close();
}

await browser.close();
console.log(results.every(Boolean) ? 'ALL OK' : 'FAILURES');
process.exit(results.every(Boolean) ? 0 : 1);
