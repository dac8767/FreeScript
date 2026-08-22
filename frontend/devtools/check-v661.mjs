/* check-v661 — Derek: "the unsorted section should be the same width by
   default as the other sections. allow resizing of the column widths by
   dragging the edge."

   1 every column — Unsorted included — starts at the same width
   2 the right edge is a real target: ~10px of col-resize, not the 3px strip
     the old right:-3px handle left after the column's overflow clipped it
   3 the edge shows itself on hover
   4 dragging a section's edge resizes THAT column and leaves the rest alone
   5 the new width is on the column record (so it saves with the script)
   6 dragging Unsorted's edge works too, and its width persists as a view
     preference (there is no column record to put it on)
   7 the floor holds — a drag far to the left can't collapse a column */
import { launch, boot, seedScript, SCENES_4, settle } from './driver.mjs';

const { browser, page } = await launch({ width: 1500, height: 950 });
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓', m); } else { fail++; console.log('  ✗ FAIL', m); } };
const W = '.tool-window[data-tool="beatboard"]';

const widths = () => page.evaluate((w) => [...document.querySelectorAll(`${w} .beat-board-columns > .beat-column`)]
  .map((c) => [c.classList.contains('beat-column-unsorted') ? 'Unsorted' : c.querySelector('.beat-column-title-input')?.value, Math.round(c.getBoundingClientRect().width)]), W);
/** The column's right edge, and a y safely inside it. */
const edgeOf = (sel) => page.evaluate((s) => {
  const c = document.querySelector(s);
  const r = c.getBoundingClientRect();
  return { right: r.right, y: r.top + Math.min(120, r.height / 2), width: Math.round(r.width) };
}, sel);
async function dragEdge(sel, dx) {
  const e = await edgeOf(sel);
  const x = e.right - 4;
  await page.mouse.move(x, e.y);
  await page.mouse.down();
  await page.mouse.move(x + 1, e.y);
  for (let i = 1; i <= 8; i++) await page.mouse.move(x + (dx * i) / 8, e.y);
  await page.mouse.up();
  await settle(page);
  return e.width;
}

try {
  await boot(page);
  await seedScript(page, SCENES_4);
  await page.evaluate(() => {
    window.__scStore.setState((s) => ({ toolSizes: { ...s.toolSizes, beatboard: { w: 1200, h: 700 } } }));
    const st = window.__scStore.getState();
    st.setToolMode('beatboard', 'floating');
    st.openTool('beatboard');
  });
  await page.waitForSelector(`${W} [data-ctl="view"]`, { timeout: 8000 });
  await page.click(`${W} [data-ctl="view"]`);
  await page.click('.tool-ctl-menu .tool-ctl-menu-item:has-text("Sections")');
  await settle(page);
  await page.evaluate(() => {
    const st = window.__scStore.getState();
    st.setBeatColumns([]); st.setBeats([]);
    st.addOutlineTab();
    st.setOutlineUnsortedWidth(0);
    const a = st.addBeatColumn('Act I', 40);
    const b = st.addBeatColumn('Act II', 40);
    st.addBeat('In Act I', a);
    st.addBeat('In Act II', b);
    st.addBeat('Loose', 'gone');          // puts a beat in Unsorted
  });
  await settle(page);

  /* ── 1: one default width for all three ── */
  const start = await widths();
  ok(start.length === 3 && start[0][0] === 'Unsorted', `Unsorted plus two sections are on the board (${start.map((c) => c[0]).join(', ')})`);
  ok(new Set(start.map((c) => c[1])).size === 1,
    `every column starts at the same width (${start.map((c) => `${c[0]} ${c[1]}`).join(' · ')})`);

  /* ── 2–3: the edge is grabbable and shows itself ── */
  const e = await edgeOf(`${W} .beat-column-unsorted`);
  const hits = await page.evaluate(([right, y]) => [2, 4, 6, 8].map((d) => {
    const el = document.elementFromPoint(right - d, y);
    return el && el.classList.contains('beat-column-resize-handle') ? d : null;
  }), [e.right, e.y]);
  ok(hits.every((h) => h !== null), `the whole edge strip is the resize target (hits at ${hits.join('/')}px in)`);
  const cursor = await page.evaluate(([right, y]) => getComputedStyle(document.elementFromPoint(right - 4, y)).cursor, [e.right, e.y]);
  ok(cursor === 'col-resize', `and it wears the col-resize cursor (${cursor})`);
  /* v7.76: this used to require the handle to carry a tooltip saying "width".
     Derek's helper-text pass BLANKED it — one of the 45 he cleared — and the
     blanks were then baked into the source, so there is no title attribute on
     the handle at all now. That is his call, not a regression: the two
     assertions above already prove the strip is grabbable and wears the
     col-resize cursor, which is what tells a writer what it does. What is
     still worth asserting is that it did not come back as an EMPTY title,
     which is the shape a blanking override leaves behind and which reads to a
     screen reader as an unlabelled control. */
  const tip = await page.evaluate(([right, y]) => document.elementFromPoint(right - 4, y).getAttribute('title'), [e.right, e.y]);
  ok(tip === null, `the handle carries no tooltip, not an empty one (${JSON.stringify(tip)})`);
  const glowBefore = await page.evaluate(([right, y]) =>
    getComputedStyle(document.elementFromPoint(right - 4, y), '::after').opacity, [e.right, e.y]);
  await page.mouse.move(e.right - 4, e.y);
  // the tint fades in over .12s — wait for it to arrive rather than catching
  // it mid-transition
  let glowAfter = '0';
  await page.waitForFunction(([right, y]) =>
    Number(getComputedStyle(document.elementFromPoint(right - 4, y), '::after').opacity) > 0.3,
  [e.right, e.y], { timeout: 3000 }).catch(() => {});
  glowAfter = await page.evaluate(([right, y]) =>
    getComputedStyle(document.elementFromPoint(right - 4, y), '::after').opacity, [e.right, e.y]);
  ok(Number(glowBefore) === 0 && Number(glowAfter) > 0.3, `the edge lights up on hover (${glowBefore} → ${glowAfter})`);

  /* ── 4–5: a section resizes, alone, and the width is on the record ── */
  const act1 = `${W} .beat-column:not(.beat-column-unsorted)`;
  const was = await dragEdge(act1, 110);
  const grown = await widths();
  ok(grown[1][1] > was + 80, `dragging Act I's edge widened it (${was} → ${grown[1][1]})`);
  ok(grown[0][1] === start[0][1] && grown[2][1] === start[2][1],
    `and left Unsorted and Act II alone (${grown[0][1]} / ${grown[2][1]})`);
  const stored = await page.evaluate(() => window.__scStore.getState().beatColumns.map((c) => Math.round(c.width)));
  ok(stored[0] > 0 && stored[1] === 0, `the width is on the section's record, so it saves with the script (${stored.join(', ')})`);

  /* ── 6: Unsorted resizes too, and persists as a view preference ── */
  const unWas = await dragEdge(`${W} .beat-column-unsorted`, 90);
  const unNow = (await widths())[0][1];
  ok(unNow > unWas + 60, `dragging Unsorted's edge widened it too (${unWas} → ${unNow})`);
  const pref = await page.evaluate(() => window.__scStore.getState().outlineUnsortedWidth);
  ok(Math.abs(pref - unNow) <= 2, `its width is kept as a view preference (${Math.round(pref)})`);
  // it survives the column unmounting and coming back (drag the beat home, undo)
  await page.evaluate(() => {
    const st = window.__scStore.getState();
    const loose = st.beats.find((b) => !st.beatColumns.some((c) => c.id === b.columnId));
    st.updateBeat(loose.id, { columnId: st.beatColumns[0].id, position: 9 });
  });
  await settle(page);
  await page.evaluate(() => window.__scStore.getState().beatUndo());
  await settle(page);
  const back = (await widths()).find((c) => c[0] === 'Unsorted');
  ok(back && Math.abs(back[1] - unNow) <= 2, `and it comes back at that width when the column returns (${back ? back[1] : 'gone'})`);

  /* ── 7: the floor ── */
  await dragEdge(act1, -600);
  const floored = (await widths())[1][1];
  ok(floored >= 200 && floored <= 210, `a hard drag left stops at the 200px floor (${floored})`);

} catch (e) {
  console.log('PROBE ERROR:', e.message);
  fail++;
} finally { await browser.close(); }
console.log(`\ncheck-v661: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
