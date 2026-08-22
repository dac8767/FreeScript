/* check-v660 — Derek: "if an outline section is deleted and it had beats
   inside it, the beats should not be deleted. instead they should move to an
   Unsorted section (make it the furthest left column). no beats should ever
   be deleted unless they are individually deleted using the delete button on
   the beat itself."

   1 the section's trash button says so before you click it
   2 clicking it removes the SECTION and keeps every beat
   3 the freed beats show up as cards in the Unsorted column
   4 Unsorted is the furthest LEFT column on the board
   5 a second delete appends to the ones already waiting
   6 one undo puts the section and its beats back
   7 the beat's own delete button still deletes that one beat
   8 dragging a beat out of Unsorted into a real section still works */
import { launch, boot, seedScript, SCENES_4, settle } from './driver.mjs';

const { browser, page } = await launch({ width: 1500, height: 950 });
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓', m); } else { fail++; console.log('  ✗ FAIL', m); } };
const W = '.tool-window[data-tool="beatboard"]';

const state = () => page.evaluate(() => {
  const st = window.__scStore.getState();
  return {
    titles: st.beats.map((b) => b.title).sort(),
    cols: [...st.beatColumns].sort((a, b) => a.position - b.position).map((c) => c.title),
    loose: st.beats.filter((b) => !st.beatColumns.some((c) => c.id === b.columnId)).sort((a, b) => a.position - b.position).map((b) => b.title),
  };
});
/** The titles the Unsorted column is actually showing, in order. */
const unsortedCards = () => page.evaluate((w) => [...document.querySelectorAll(`${w} .beat-column-unsorted .beat-card`)]
  .map((c) => c.querySelector('.beat-card-title')?.value ?? ''), W);

try {
  await boot(page);
  await seedScript(page, SCENES_4);
  await page.evaluate(() => {
    window.__scStore.setState((s) => ({ toolSizes: { ...s.toolSizes, beatboard: { w: 1300, h: 760 } } }));
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
    const a = st.addBeatColumn('Act I', 10);
    const b = st.addBeatColumn('Act II', 20);
    st.addBeat('Opening Image', a);
    st.addBeat('Catalyst', a);
    st.addBeat('Midpoint', b);
  });
  await settle(page);

  /* ── 1: the tooltip tells the truth before the click ── */
  const tip = await page.evaluate((w) => document.querySelector(`${w} .beat-column-delete`)?.getAttribute('title') ?? '', W);
  /* v7.76: was `/Unsorted/ && /not deleted/i`. Derek's helper-text pass
     shortened this to "Delete section. Beats are not deleted" — the promise
     that matters is still there, the destination is not named any more. The
     behaviour is unchanged and step 2 below still proves the beats land in
     Unsorted, which is the assertion that would catch a real regression. */
  ok(/not deleted/i.test(tip), `the trash tooltip promises the beats survive ("${tip}")`);

  /* ── 2–4: delete Act I ── */
  await page.click(`${W} .beat-column-delete`);          // the first section's trash
  await settle(page);
  const after = await state();
  ok(after.cols.length === 1 && after.cols[0] === 'Act II', `the section is gone (${after.cols.join(', ') || 'none'})`);
  ok(after.titles.length === 3, `all three beats survive the section delete (${after.titles.length})`);
  ok(JSON.stringify(after.loose) === JSON.stringify(['Opening Image', 'Catalyst']),
    `its beats are Unsorted, in the order they were in (${after.loose.join(' / ')})`);
  const shown = await unsortedCards();
  ok(JSON.stringify(shown) === JSON.stringify(['Opening Image', 'Catalyst']),
    `and they RENDER as cards in the Unsorted column (${shown.join(' / ') || 'none'})`);

  const geo = await page.evaluate((w) => {
    const cols = [...document.querySelectorAll(`${w} .beat-board-columns > .beat-column`)];
    const un = document.querySelector(`${w} .beat-column-unsorted`);
    return {
      first: cols[0] === un,
      unLeft: un?.getBoundingClientRect().left ?? -1,
      nextLeft: cols.find((c) => c !== un)?.getBoundingClientRect().left ?? -1,
      label: un?.querySelector('.beat-column-unsorted-title')?.textContent ?? '',
    };
  }, W);
  ok(geo.first && geo.unLeft < geo.nextLeft,
    `Unsorted is the furthest LEFT column (${Math.round(geo.unLeft)} < ${Math.round(geo.nextLeft)})`);
  ok(geo.label === 'Unsorted', `it is labelled Unsorted, not Uncategorized ("${geo.label}")`);

  /* ── 5: a second delete appends after the ones already waiting ── */
  await page.click(`${W} .beat-column:not(.beat-column-unsorted) .beat-column-delete`);
  await settle(page);
  const both = await state();
  ok(both.cols.length === 0 && both.titles.length === 3, `the last section goes and still nothing is lost (${both.titles.length} beats)`);
  ok(JSON.stringify(both.loose) === JSON.stringify(['Opening Image', 'Catalyst', 'Midpoint']),
    `the newly freed beat lands after the ones already waiting (${both.loose.join(' / ')})`);

  /* ── 5b (v6.62): Derek deleted the second-to-last section and read the
     result as "the beats went into Act I". They hadn't — but the surviving
     section took flex:1 and wrapped its cards into a grid, which looks
     exactly like that. With Unsorted up, no section may stretch or wrap. ── */
  await page.evaluate(() => window.__scStore.getState().beatUndo());   // back to Act II + 2 loose
  await settle(page);
  const oneLeft = await page.evaluate((w) => {
    const cols = [...document.querySelectorAll(`${w} .beat-board-columns > .beat-column`)];
    const un = cols.find((c) => c.classList.contains('beat-column-unsorted'));
    const sec = cols.find((c) => !c.classList.contains('beat-column-unsorted'));
    const board = document.querySelector(`${w} .beat-board-columns`);
    return {
      cols: cols.length,
      boardW: Math.round(board?.getBoundingClientRect().width ?? -1),
      unW: Math.round(un?.getBoundingClientRect().width ?? -1),
      secW: Math.round(sec?.getBoundingClientRect().width ?? -1),
      wrapped: !!sec?.querySelector('.beat-column-cards-wrap'),
      inSection: sec?.querySelectorAll('.beat-card').length ?? -1,
      inUnsorted: un?.querySelectorAll('.beat-card').length ?? -1,
    };
  }, W);
  /* Against the SPACE IT COULD TAKE, not against Unsorted's width.
     v7.70: Unsorted is user-resizable and remembers that width, and the
     shipped defaults now carry Derek's 331px — so "as wide as Unsorted"
     started failing on a column that had not stretched at all. What
     "stays a normal column" means is that it did not take the free space:
     a flex:1 section would fill nearly all of it. */
  const free = oneLeft.boardW - oneLeft.unW;
  ok(oneLeft.cols === 2 && free > oneLeft.secW * 1.5 && oneLeft.secW < free * 0.7,
    `the last section stays a normal column beside Unsorted (${oneLeft.secW} of ${free}px free)`);
  ok(!oneLeft.wrapped, 'its cards stay a single list — no grid that reads as "they all landed here"');
  ok(oneLeft.inSection === 1 && oneLeft.inUnsorted === 2,
    `and the cards are where the store says: 1 in the section, 2 unsorted (${oneLeft.inSection}/${oneLeft.inUnsorted})`);
  await page.evaluate(() => window.__scStore.getState().beatRedo());
  await settle(page);

  /* ── 6: one undo ── */
  await page.evaluate(() => window.__scStore.getState().beatUndo());
  await settle(page);
  const undone = await state();
  ok(undone.cols.join() === 'Act II' && undone.loose.length === 2,
    `one undo puts the section back with its beat (${undone.cols.join()}, ${undone.loose.length} loose)`);

  /* ── 7: the beat's OWN delete button is still the one door that deletes ── */
  const before = (await state()).titles.length;
  await page.click(`${W} .beat-column-unsorted .beat-card .beat-card-delete`);
  await settle(page);
  const gone = await state();
  ok(gone.titles.length === before - 1 && !gone.titles.includes('Opening Image'),
    `the card's own delete button deletes that one beat (${before} → ${gone.titles.length})`);

  /* ── 8: an Unsorted beat can still be put back into a section ── */
  await page.evaluate(() => {
    const st = window.__scStore.getState();
    const loose = st.beats.find((b) => !st.beatColumns.some((c) => c.id === b.columnId));
    st.updateBeat(loose.id, { columnId: st.beatColumns[0].id, position: 5 });
  });
  await settle(page);
  const home = await state();
  ok(home.loose.length === 0, `dragging the last one into a section empties Unsorted (${home.loose.length} left)`);
  const stillThere = await page.evaluate((w) => !!document.querySelector(`${w} .beat-column-unsorted`), W);
  ok(!stillThere, 'and the Unsorted column disappears when it is empty');

} catch (e) {
  console.log('PROBE ERROR:', e.message);
  fail++;
} finally { await browser.close(); }
console.log(`\ncheck-v660: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
